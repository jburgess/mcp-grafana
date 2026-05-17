/**
 * Style-axis lint primitive for a single Grafana panel.
 *
 * `lintPanel(panel, guide: PanelStyleGuide)` checks a panel against a
 * style guide and returns issues with `warn` or `info` severity —
 * never `error`. Schema-validity errors are validateDashboard /
 * validatePanel's job (`./validate.ts`); style ≠ schema.
 *
 * Type layout per `research.md` Entry 013 and issue #25:
 *
 *   GrafanaStyleGuide (umbrella, wire format)
 *     └── panels: PanelStyleGuide (the slice this function consumes)
 *           ├── timeseries: TimeseriesPanelStyle (per-type rules)
 *           ├── units:      UnitStyleGuide        (cross-type: allow/deny)
 *           └── descriptions: DescriptionStyleGuide (cross-type: required?)
 *
 * Future panel-type slices (`stat`, `table`, `gauge`, `heatmap`) and
 * future umbrella siblings (`dashboards`, `alertRules`) are additive —
 * the rule-id namespace grows by addition, never by removal or rename.
 *
 * Rule identifiers are JSONPath-style dotted paths into the umbrella
 * — e.g. `panels.timeseries.legend.placement` references the field at
 * `umbrella.panels.timeseries.legend.placement`. They are NOT literal
 * flat keys with dots in them. This convention matches the
 * illustrative JSON block in `skills/grafana-style-guide.md`.
 *
 * Opinion lives in the skill markdown, not in code: `lintPanel`
 * requires a `guide` argument with no default and no fallback. The
 * project does not export a `defaultStyleGuide` constant — per the
 * §1.8 / Entry 013 rejected-alternatives list.
 */

import { type Dict, asArray, asDict, asNumber, asString } from './_internal.js';

// ---- Public types ---------------------------------------------------------

/**
 * The umbrella style-guide shape, as persisted in the skill markdown's
 * JSON block. Currently has `panels` only; future revisions add
 * `dashboards`, `alertRules`, etc. — purely additive.
 */
export interface GrafanaStyleGuide {
  /**
   * Optional schema URL for versioning the wire format. Advisory only.
   * Not currently hosted; see `research.md` Entry 013's open-questions
   * resolutions for the hosting decision. Skill JSON omits this field
   * until a stable hosting answer lands.
   */
  $schema?: string;
  /** Panel-level rules (per-type + cross-type units / descriptions). */
  panels?: PanelStyleGuide;
  /** Dashboard-level rules — checks that can't be made per-panel. */
  dashboards?: DashboardStyleGuide;
}

/**
 * Dashboard-level rules. Surfaces only structural / deterministic
 * checks here — heuristic, taste-laden rules (title-query mismatch,
 * naming inconsistency, threshold sanity) stay in the skill's prose
 * per AGENTS.md §1.8.
 */
export interface DashboardStyleGuide {
  panels?: {
    /**
     * When true, fires `dashboards.panels.duplicateTitles` for any
     * non-row panel title shared by more than one panel. Rows are
     * excluded — section markers often share titles legitimately
     * across a dashboard.
     */
    duplicateTitles?: boolean;
  };
  variables?: {
    /**
     * When true, fires `dashboards.variables.hiddenButReferenced` for
     * any templating variable whose `hide: 2` (both label and value
     * hidden in the UI) is interpolated in a panel or row title.
     * Renders as the literal value or "All" without context — the
     * common bug case from a real annotation session (issue #31).
     */
    hiddenButReferenced?: boolean;
    /**
     * When true, fires `dashboards.variables.emptyDefault` for any
     * templating variable whose `current.value` is absent or empty
     * string. Empty defaults often mean a panel renders with no
     * selection on first load.
     */
    emptyDefault?: boolean;
  };
}

/**
 * The slice `lintPanel` consumes — everything needed to lint one panel.
 * Per-panel-type rules live as siblings of the cross-type `units` and
 * `descriptions` rules. This keeps the primitive composable: as more
 * panel-types or cross-type rule families ship, they slot in here
 * without changing the function signature.
 */
export interface PanelStyleGuide {
  /** Rules specific to timeseries panels. */
  timeseries?: TimeseriesPanelStyle;
  // Future: stat?, table?, gauge?, heatmap? — additive only.

  /** Unit allow/deny rules. Apply uniformly across panel types. */
  units?: UnitStyleGuide;
  /** Description-required rule. Applies uniformly across panel types. */
  descriptions?: DescriptionStyleGuide;
}

export interface TimeseriesPanelStyle {
  legend?: TimeseriesLegendStyle;
}

export interface TimeseriesLegendStyle {
  /** Expected placement value. Common: `right`, `bottom`, `hidden`. */
  placement?: string;
  /** Expected displayMode. Common: `table`, `list`, `hidden`. */
  displayMode?: string;
  /** Expected calcs in the legend table (order-sensitive). */
  calcs?: string[];
}

export interface UnitStyleGuide {
  /** Panel's `fieldConfig.defaults.unit` MUST be in this list when set. */
  allowList?: string[];
  /** Panel's `fieldConfig.defaults.unit` MUST NOT be one of these. */
  deny?: string[];
}

export interface DescriptionStyleGuide {
  /** When true, panels missing a description (absent or `""`) fire. */
  required?: boolean;
}

export interface LintIssue {
  /** JSONPath into the panel — e.g. `$.fieldConfig.defaults.unit`, `$` for the panel itself. */
  path: string;
  /** Dotted path into the umbrella StyleGuide — e.g. `panels.units.allowList`. */
  ruleId: string;
  /**
   * Style-axis severity. `warn` for "consider fixing"; `info` for
   * "note for review." Never `error` — schema-validity errors are
   * `validateDashboard` / `validatePanel`'s territory.
   */
  severity: 'warn' | 'info';
  message: string;
}

export interface LintResult {
  issues: LintIssue[];
  /** `true` if `issues[]` was capped at MAX_ISSUES; more existed. */
  truncated?: true;
}

// ---- Implementation -------------------------------------------------------

const MAX_ISSUES = 100;

function asPlainDict(p: unknown): Dict | undefined {
  return asDict(p);
}

function panelUnit(panel: Dict): string | undefined {
  return asString(asDict(asDict(panel.fieldConfig)?.defaults)?.unit);
}

// Empty-string descriptions count as missing, matching inspectDashboard's
// rule (PR #32). Grafana's UI renders absent and "" identically.
function panelDescriptionMissing(panel: Dict): boolean {
  const d = asString(panel.description);
  return d === undefined || d === '';
}

function legendOptions(panel: Dict): Dict | undefined {
  return asDict(asDict(panel.options)?.legend);
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function checkUnits(panel: Dict, guide: UnitStyleGuide, push: (i: LintIssue) => void): void {
  const unit = panelUnit(panel);
  if (unit === undefined) return; // no opinion when unit is absent

  if (guide.allowList && guide.allowList.length > 0 && !guide.allowList.includes(unit)) {
    push({
      path: '$.fieldConfig.defaults.unit',
      ruleId: 'panels.units.allowList',
      severity: 'warn',
      message: `unit "${unit}" is not in the style guide's allow list (${guide.allowList.join(', ')})`,
    });
  }
  if (guide.deny && guide.deny.includes(unit)) {
    push({
      path: '$.fieldConfig.defaults.unit',
      ruleId: 'panels.units.deny',
      severity: 'warn',
      message: `unit "${unit}" is on the style guide's deny list — see the style guide for the recommended alternative`,
    });
  }
}

function checkDescription(
  panel: Dict,
  guide: DescriptionStyleGuide,
  push: (i: LintIssue) => void,
): void {
  // Rows are section markers, not visualizations — they don't need
  // descriptions. Matches inspect.ts's `panelsMissingDescription`
  // convention (excludes rows from the count).
  if (asString(panel.type) === 'row') return;
  if (guide.required === true && panelDescriptionMissing(panel)) {
    push({
      path: '$.description',
      ruleId: 'panels.descriptions.required',
      severity: 'info',
      message:
        'description is required by the style guide; use the metric HELP text where applicable',
    });
  }
}

function checkTimeseriesLegend(
  panel: Dict,
  guide: TimeseriesLegendStyle,
  push: (i: LintIssue) => void,
): void {
  const legend = legendOptions(panel);

  if (guide.placement !== undefined) {
    const actual = asString(legend?.placement);
    if (actual !== guide.placement) {
      push({
        path: '$.options.legend.placement',
        ruleId: 'panels.timeseries.legend.placement',
        severity: 'info',
        message: `legend.placement should be "${guide.placement}"; got ${actual === undefined ? '(unset)' : `"${actual}"`}`,
      });
    }
  }

  if (guide.displayMode !== undefined) {
    const actual = asString(legend?.displayMode);
    if (actual !== guide.displayMode) {
      push({
        path: '$.options.legend.displayMode',
        ruleId: 'panels.timeseries.legend.displayMode',
        severity: 'info',
        message: `legend.displayMode should be "${guide.displayMode}"; got ${actual === undefined ? '(unset)' : `"${actual}"`}`,
      });
    }
  }

  if (guide.calcs !== undefined) {
    const actual = asArray(legend?.calcs).map((c) => asString(c) ?? '');
    if (!arraysEqual(actual, guide.calcs)) {
      push({
        path: '$.options.legend.calcs',
        ruleId: 'panels.timeseries.legend.calcs',
        severity: 'info',
        message: `legend.calcs should be [${guide.calcs.map((c) => `"${c}"`).join(', ')}]; got [${actual.map((c) => `"${c}"`).join(', ')}]`,
      });
    }
  }
}

/**
 * Resolve any plausible `styleGuide` input — full umbrella, panel
 * slice, malformed shapes — into a clean `PanelStyleGuide`. Used by
 * both the library entry (`lintPanel`) and the MCP tool so both go
 * through one canonical resolver with one set of edge-case rules.
 *
 * Returns either the unwrapped slice, the input itself when it
 * already looks like a slice, or a structural-issue marker the
 * caller can surface to the user.
 *
 * Disambiguation: if the input has BOTH a `panels` key AND any
 * slice-shaped key (`timeseries` / `units` / `descriptions`) at the
 * top level, that's an ambiguous shape — we treat the input as
 * malformed rather than silently picking one and dropping the other.
 */
function resolveSlice(
  styleGuide: unknown,
): { slice: PanelStyleGuide } | { issue: LintIssue } {
  const sg = asDict(styleGuide);
  if (!sg) {
    return {
      issue: {
        path: '$styleGuide',
        ruleId: 'panels.shape',
        severity: 'warn',
        message: 'styleGuide must be a JSON object — see docs/conventions/mcp-resource-uris.md for the GrafanaStyleGuide shape',
      },
    };
  }

  const hasPanelsKey = 'panels' in sg;
  const hasSliceKey = 'timeseries' in sg || 'units' in sg || 'descriptions' in sg;

  // Ambiguous: both umbrella and slice keys present at top level. Refuse
  // to silently drop the slice keys. A user who hits this likely intended
  // one shape and put a stray key from the other in by accident.
  if (hasPanelsKey && hasSliceKey) {
    return {
      issue: {
        path: '$styleGuide',
        ruleId: 'panels.shape',
        severity: 'warn',
        message:
          'styleGuide has both umbrella-form `panels` and slice-form ' +
          '(timeseries / units / descriptions) keys at the top level — ' +
          'pick one shape',
      },
    };
  }

  if (hasPanelsKey) {
    const panelsValue = sg.panels;
    const inner = asDict(panelsValue);
    if (!inner) {
      return {
        issue: {
          path: '$styleGuide.panels',
          ruleId: 'panels.shape',
          severity: 'warn',
          message: 'styleGuide.panels must be a JSON object (got null, array, or non-object)',
        },
      };
    }
    return { slice: inner as PanelStyleGuide };
  }

  // No `panels` key — treat the input itself as the slice. This is the
  // direct-slice call path. An empty object `{}` is a valid "no opinion"
  // slice — no issues fire because every rule section is absent.
  return { slice: sg as PanelStyleGuide };
}

export function lintPanel(panel: unknown, guide: unknown): LintResult {
  const p = asPlainDict(panel);
  if (!p) {
    return {
      issues: [
        {
          path: '$',
          ruleId: 'panels.shape',
          severity: 'warn',
          message: 'panel must be a JSON object',
        },
      ],
    };
  }

  // Narrow the guide before reading anything off it. Library callers
  // bypass the MCP tool's record-shape gate, so `guide` is `unknown`
  // here and may be null, a number, or an array. resolveSlice owns
  // every edge case.
  const resolved = resolveSlice(guide);
  if ('issue' in resolved) {
    return { issues: [resolved.issue] };
  }
  const slice = resolved.slice;

  const issues: LintIssue[] = [];
  const push = (i: LintIssue): void => {
    if (issues.length < MAX_ISSUES) issues.push(i);
  };

  // Cross-type rules apply to every panel regardless of `type`.
  if (slice.units) checkUnits(p, slice.units, push);
  if (slice.descriptions) checkDescription(p, slice.descriptions, push);

  // Per-type rules fire only when the panel's `type` matches the rule's section.
  const type = asString(p.type);
  if (type === 'timeseries' && slice.timeseries?.legend) {
    checkTimeseriesLegend(p, slice.timeseries.legend, push);
  }

  if (issues.length >= MAX_ISSUES) {
    return { issues, truncated: true };
  }
  return { issues };
}

// ---- lintDashboard --------------------------------------------------------

/**
 * Thin aggregator over `lintPanel`. Walks every panel in the dashboard
 * (top-level + legacy row.panels[]) and runs the panel-slice rules
 * against each, then applies dashboard-level rules that can't be
 * checked per-panel.
 *
 * Per the issue #31 team-review reshape: this is a "thin aggregator
 * over small detector primitives" — taste-laden rules from the
 * original wishlist (title-query mismatch, unit-mismatch heuristics,
 * naming inconsistency) live in the skill's prose; this aggregator
 * surfaces only structural, deterministic checks that an LLM
 * couldn't reliably do from text alone.
 *
 * Dashboard-level rules currently surfaced:
 *   - dashboards.panels.duplicateTitles
 *   - dashboards.variables.hiddenButReferenced
 *   - dashboards.variables.emptyDefault
 *
 * Issue-result paths are rebased onto the dashboard's panel-index
 * shape (`panels[N].fieldConfig.defaults.unit`), not the standalone
 * panel shape (`$.fieldConfig.defaults.unit`), so consumers can group
 * issues by panel.
 */
export function lintDashboard(dashboard: unknown, guide: unknown): LintResult {
  const dash = asDict(dashboard);
  if (!dash) {
    return {
      issues: [
        {
          path: '$',
          ruleId: 'dashboards.shape',
          severity: 'warn',
          message: 'dashboard must be a JSON object',
        },
      ],
    };
  }

  // Resolve the guide once up front so the per-panel walk doesn't fire
  // the same `panels.shape` issue N times for a malformed guide. Re-use
  // the same resolveSlice the panel-level entry uses so the
  // umbrella-vs-slice unwrap rules stay consistent across both entries.
  const resolved = resolveSlice(guide);
  if ('issue' in resolved) {
    return { issues: [resolved.issue] };
  }
  const panelSlice = resolved.slice;
  // The umbrella's dashboards section is separate from the panel slice.
  // If the caller passed the slice directly (no `panels` key), they
  // can't configure dashboard-level rules — that's OK; those rules
  // simply don't fire.
  const guideObj = asDict(guide);
  const dashboardSlice: DashboardStyleGuide | undefined =
    guideObj && asDict(guideObj.dashboards)
      ? (guideObj.dashboards as DashboardStyleGuide)
      : undefined;

  const issues: LintIssue[] = [];
  const push = (i: LintIssue): void => {
    if (issues.length < MAX_ISSUES) issues.push(i);
  };

  // ---- Panel-level walk (top-level + legacy row.panels[]) ----
  const topPanels = asArray(dash.panels);
  for (let i = 0; i < topPanels.length; i++) {
    const panel = asDict(topPanels[i]);
    if (!panel) continue;
    appendPanelIssues(panel, panelSlice, `panels[${i}]`, push);

    if (asString(panel.type) === 'row') {
      const nested = asArray(panel.panels);
      for (let j = 0; j < nested.length; j++) {
        const np = asDict(nested[j]);
        if (!np) continue;
        appendPanelIssues(np, panelSlice, `panels[${i}].panels[${j}]`, push);
      }
    }
  }

  // ---- Dashboard-level rules ----
  if (dashboardSlice?.panels?.duplicateTitles === true) {
    checkDuplicateTitles(dash, push);
  }
  if (dashboardSlice?.variables?.hiddenButReferenced === true) {
    checkHiddenButReferenced(dash, push);
  }
  if (dashboardSlice?.variables?.emptyDefault === true) {
    checkEmptyDefault(dash, push);
  }

  if (issues.length >= MAX_ISSUES) {
    return { issues, truncated: true };
  }
  return { issues };
}

// Runs lintPanel on one panel and rebases its `$`-rooted issue paths
// onto the panel's index in the dashboard. Skips structural panel
// issues for non-object inputs (the dashboard-level walker has already
// guarded those).
function appendPanelIssues(
  panel: Dict,
  panelSlice: PanelStyleGuide,
  panelPath: string,
  push: (i: LintIssue) => void,
): void {
  // Call lintPanel with the resolved slice; it will narrow internally
  // but we already vouched for the slice via resolveSlice above.
  const result = lintPanel(panel, panelSlice);
  for (const issue of result.issues) {
    // panels.shape (the panel-narrowing structural issue) shouldn't
    // occur here because we pass a dict, but skip defensively.
    if (issue.ruleId === 'panels.shape') continue;
    push({
      ...issue,
      path: issue.path === '$' ? panelPath : `${panelPath}${issue.path.slice(1)}`,
    });
  }
}

// dashboards.panels.duplicateTitles — counts non-row panel titles
// across the full tree (top-level + legacy nested). Row panels are
// excluded; section markers often share titles legitimately.
function checkDuplicateTitles(dash: Dict, push: (i: LintIssue) => void): void {
  const titleToIds = new Map<string, Array<number | string>>();

  const visit = (panel: Dict): void => {
    if (asString(panel.type) === 'row') return;
    const title = asString(panel.title);
    if (title === undefined || title === '') return;
    const id = panel.id;
    if (typeof id !== 'number' && typeof id !== 'string') return;
    const existing = titleToIds.get(title);
    if (existing) existing.push(id);
    else titleToIds.set(title, [id]);
  };

  for (const raw of asArray(dash.panels)) {
    const p = asDict(raw);
    if (!p) continue;
    visit(p);
    if (asString(p.type) === 'row') {
      for (const nestedRaw of asArray(p.panels)) {
        const np = asDict(nestedRaw);
        if (np) visit(np);
      }
    }
  }

  for (const [title, ids] of titleToIds) {
    if (ids.length < 2) continue;
    push({
      path: 'panels',
      ruleId: 'dashboards.panels.duplicateTitles',
      severity: 'info',
      message: `${ids.length} panels share the title "${title}" (panel ids ${ids.join(', ')}) — consider differentiating`,
    });
  }
}

// dashboards.variables.hiddenButReferenced — a variable with hide:2
// (both label and value hidden in the UI) interpolated in a panel or
// row title renders without context, leaving the viewer to guess what
// the value is. Structural check — string match for the variable's
// interpolation syntaxes in titles only.
function checkHiddenButReferenced(dash: Dict, push: (i: LintIssue) => void): void {
  const variables = asArray(asDict(dash.templating)?.list);
  const hiddenNames: string[] = [];
  for (const v of variables) {
    const vd = asDict(v);
    if (!vd) continue;
    if (asNumber(vd.hide) === 2) {
      const name = asString(vd.name);
      if (name) hiddenNames.push(name);
    }
  }
  if (hiddenNames.length === 0) return;

  const titles: string[] = [];
  for (const raw of asArray(dash.panels)) {
    const p = asDict(raw);
    if (!p) continue;
    const t = asString(p.title);
    if (t) titles.push(t);
    if (asString(p.type) === 'row') {
      for (const nestedRaw of asArray(p.panels)) {
        const np = asDict(nestedRaw);
        if (!np) continue;
        const nt = asString(np.title);
        if (nt) titles.push(nt);
      }
    }
  }

  for (const name of hiddenNames) {
    // Match $name, ${name}, ${name:fmt}, [[name]], [[name:csv]] — same
    // syntaxes recognised by rename.ts and validate.ts.
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `\\$${safe}(?![a-zA-Z0-9_])|\\$\\{${safe}(:[^}]*)?\\}|\\[\\[${safe}(:[^\\]]*)?\\]\\]`,
    );
    for (const title of titles) {
      if (re.test(title)) {
        push({
          path: `templating.list[?(name="${name}")].hide`,
          ruleId: 'dashboards.variables.hiddenButReferenced',
          severity: 'warn',
          message: `variable "${name}" has hide:2 but is interpolated in a panel or row title — the viewer sees the value without context (e.g. "${title}")`,
        });
        break;
      }
    }
  }
}

// dashboards.variables.emptyDefault — `current.value` is absent or "".
function checkEmptyDefault(dash: Dict, push: (i: LintIssue) => void): void {
  const list = asArray(asDict(dash.templating)?.list);
  for (let i = 0; i < list.length; i++) {
    const v = asDict(list[i]);
    if (!v) continue;
    const current = asDict(v.current);
    const value = current ? asString(current.value) : undefined;
    if (value === undefined || value === '') {
      const name = asString(v.name) ?? `[${i}]`;
      push({
        path: `templating.list[${i}].current.value`,
        ruleId: 'dashboards.variables.emptyDefault',
        severity: 'info',
        message: `variable "${name}" has no current.value default — panels using it may render with no selection on first load`,
      });
    }
  }
}
