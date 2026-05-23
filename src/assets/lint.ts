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
 *           ├── stat:       StatPanelStyle       (per-type rules)
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

import {
  type Dict,
  asArray,
  asDict,
  asNumber,
  asString,
  nonEmptyString,
  panelGridPos,
  panelId,
  walkPanelsDeep,
  walkPanelsWithPath,
} from './_internal.js';
import { validatePromql } from '../ingest/promql.js';

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
     * Controls `dashboards.panels.duplicateTitles` — fires when a
     * non-row, non-repeat panel title is shared by more than one
     * panel.
     *
     * - `true` — rule enabled, no exemptions (current behavior).
     * - `false` — rule disabled.
     * - `{ except: string[] }` — rule enabled; titles in `except`
     *   are exempted (intentional duplicates, e.g. KPI-stat-next-to-
     *   timeseries-trend pairs that share a title by convention).
     *   An empty `except` is equivalent to `true`.
     *
     * Rows are always excluded from the rule (section markers often
     * share titles legitimately). Panels using Grafana's `repeat:`
     * field are always excluded (repeat creates N runtime copies of
     * the source panel that share its title by design).
     *
     * Issue #44.2 added the `{ except }` form per the team-review
     * reshape (the simpler `sameTypeOnly` knob was rejected as
     * taste-laden — see research.md Entry 014's deferred extensions).
     */
    duplicateTitles?: boolean | { except?: string[] };
    /**
     * Controls `dashboards.panels.maxRepeat` — fires when a
     * `repeat by $variable` panel's variable cardinality exceeds the
     * configured threshold. Mitigates the Cacti-era per-device-page
     * anti-pattern (200 panels per row, one per device, useless as
     * monitoring).
     *
     * - `number` — the threshold (e.g. `10`).
     * - `{ max: number }` — same, explicit object form. Kept as an
     *   extension point for forthcoming per-rule fields (planned:
     *   `severity?: 'warn' | 'info'` to soften the rule on dashboards
     *   that have intentionally high cardinality, e.g. cluster
     *   overviews). Don't drop the form without picking a successor.
     *
     * Cardinality is read from the templating variable's `options[]`
     * length (excluding the synthetic `$__all` All option), falling
     * back to the size of `current.value` when it's an array (multi-
     * select), then to the `+` / `,` split of `current.text`. A
     * variable resolved to only `$__all` returns cardinality 0, not 1
     * — text fallback would otherwise mis-read `current.text: "All"`.
     * Variables not present in `dash.templating.list[]` produce a
     * structural finding (severity warn, path `panels[N].repeat`)
     * rather than silently passing.
     *
     * Issue #51. Per AGENTS.md §1.8, the default threshold lives in
     * the skill prose only (~10), not in code.
     */
    maxRepeat?: number | { max: number };
    /**
     * When true, fires `dashboards.panels.datasourceDeclared` for any
     * non-row panel without an explicit `datasource` field, OR with an
     * empty `datasource: {}` ref (no `uid` or `type`). Severity is
     * `warn`: a Grafana instance default may still cover the panel,
     * but relying on that is fragile (different envs, missing default,
     * panel cloned to a dashboard with a different default).
     *
     * Templating-variable datasource refs (`{ uid: '$datasource' }`)
     * pass — they resolve at render time and are the standard multi-
     * environment pattern. Row panels are excluded (rows don't query).
     *
     * Closes the team-retrospective "silent broken dashboard" finding:
     * the panel builders shipped earlier in the cycle had no
     * `datasource` input, so a build → dashboard_build → import flow
     * produced visually-fine dashboards that queried nothing. The
     * datasource input was added alongside this rule; the rule is the
     * machine-checked half of the same fix.
     */
    datasourceDeclared?: boolean;
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
     * When true, fires `dashboards.variables.emptyDefault` for
     * templating variables whose `current.value` is absent or empty
     * string. Only checks variable types where empty defaults are a
     * real load-time hazard: `query`, `datasource`, `interval`. Other
     * types (`custom`, `constant`, `textbox`, `adhoc`) can legitimately
     * have an empty default (textbox is blank by design; adhoc starts
     * with zero filters; custom / constant may expect a user choice).
     */
    emptyDefault?: boolean;
  };
  /**
   * Rules about dashboard / panel links. Issue #52 opened this sub-
   * group with `preservesVariables`.
   */
  links?: {
    /**
     * When true, fires `dashboards.links.preservesVariables` for any
     * internal dashboard-to-dashboard link (URL path `/d/` or
     * `/dashboard/`) that drops every referenced templating variable
     * from the source dashboard. Partial drops are intentional (a
     * per-pod → per-cluster drill-up drops `$pod` on purpose) and
     * not flagged; the rule fires only on links that drop ALL
     * variables — the canonical "user lands with empty selectors and
     * has to re-pick everything" footgun. External URLs (non-`/d/`
     * paths) are ignored.
     *
     * Scope: walks dashboard-header `dashboard.links[]` (the bar at
     * the top of the dashboard), per-panel `panel.links[]`, and the
     * per-panel `fieldConfig.defaults.links[]` (cell-level drill-down
     * URLs). Findings on per-panel links carry `panelId` /
     * `panelTitle`; findings on dashboard-header links omit them (no
     * single panel context). Built-in variables (`$__from`, `$__to`,
     * `$__user.login`) are ignored — they're not in
     * `dash.templating.list[]` so the rule doesn't enforce their
     * preservation.
     */
    preservesVariables?: boolean;
  };
  /**
   * Rules about dashboard layout / row composition. Issue #54 opened
   * this sub-group with `firstRowCategorical`.
   */
  layout?: {
    /**
     * Fires `dashboards.layout.firstRowCategorical` when an OVERVIEW
     * dashboard's first row (the "fold" — the top band of panels the
     * operator sees before scrolling) is composed of numeric / graph
     * panels (`stat`, `gauge`, `timeseries`, `barchart`, `bargauge`)
     * with no categorical-health panel (`state-timeline`, `alertlist`)
     * among them. This is the "wall of numbers" anti-pattern: the
     * operator's first question is *is anything red?*, not *what's the
     * value?* (skill `## Dashboards` → "Row sequence").
     *
     * **Scoping is mandatory and explicit.** There is no structural
     * "this is an overview dashboard" signal in Grafana JSON, and the
     * rule must NOT fire on drill-down / per-service / per-pod
     * dashboards, which legitimately open with timeseries (skill:
     * "Don't blindly apply the row-1 fold convention"). Grafana Labs'
     * own Mimir per-component writes/reads dashboards are exactly such
     * drill-downs. So the author supplies the scope:
     *
     * - `{ overviewTag: 'overview' }` — fire only on dashboards whose
     *   top-level `tags[]` contains the named tag. **Recommended:**
     *   `tags` is a native Grafana field, set per-dashboard, and
     *   survives JSON round-trips — a real structural signal, unlike
     *   free-form title text. The matching convention ("tag overview
     *   dashboards `overview`") lives in the skill's `## Dashboards`
     *   section.
     * - `true` — fire on EVERY dashboard. Only correct for a style
     *   guide scoped to a folder that contains nothing but overview
     *   dashboards; applied broadly it slanders drill-downs. Prefer
     *   the tag form.
     *
     * Detection (when in scope): among top-level non-row panels that
     * declare a `gridPos`, take the contiguous first-row slice (those
     * sharing the minimum `gridPos.y`), and fire when that slice
     * contains at least one numeric/graph panel and zero
     * categorical-health panels. A fold that contains a state-timeline
     * or alertlist passes; a text-only header fold (no numeric/graph
     * panels) does not fire. Panels without a `gridPos` (not yet laid
     * out) and legacy nested `row.panels[]` children are out of scope —
     * the fold is a top-level, positioned concept.
     *
     * Severity `warn`. Detection-only: the recommended fix
     * (`grafana_state_timeline_panel_build` + an alertlist on row 1,
     * numeric tiles deferred to row 2) is applied by the author / LLM,
     * not auto-fixed.
     */
    firstRowCategorical?: boolean | { overviewTag?: string };
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
  /** Rules specific to stat panels. Issue #53 opened this slice. */
  stat?: StatPanelStyle;
  // Future: table?, gauge?, heatmap? — additive only.

  /** Unit allow/deny rules. Apply uniformly across panel types. */
  units?: UnitStyleGuide;
  /** Description-required rule. Applies uniformly across panel types. */
  descriptions?: DescriptionStyleGuide;
  /** Per-target rules (PromQL syntax validation, etc.). */
  targets?: TargetsStyleGuide;
}

/**
 * Per-target rules. Currently only `promqlValid` — walks each
 * panel's `targets[].expr` and reports syntactically invalid PromQL
 * using the same Lezer grammar Grafana's PromQL editor uses
 * (`@prometheus-io/lezer-promql`). Only `expr` is checked; `query`
 * and `rawQuery` belong to non-Prometheus datasources (Loki, SQL)
 * and have different syntax.
 *
 * Semantic errors (`rate(foo)` without a range vector, wrong function
 * arity) are NOT caught here — that requires the heavier
 * `@prometheus-io/codemirror-promql` linter and is intentionally out
 * of scope for v0.
 */
export interface TargetsStyleGuide {
  /**
   * When true, fires `panels.targets.promqlValid` (severity `warn`)
   * for any target whose `expr` field fails to parse against the
   * PromQL grammar. The dashboard imports fine and the rest of the
   * panel renders; the broken target just produces "no data" at
   * query time. The warn severity matches `datasourceDeclared` —
   * both catch silent-failure modes that pass `validateDashboard`.
   */
  promqlValid?: boolean;
}

export interface TimeseriesPanelStyle {
  legend?: TimeseriesLegendStyle;
}

export interface TimeseriesLegendStyle {
  /** Expected placement value. Common: `right`, `bottom`, `hidden`. */
  placement?: string;
  /** Expected displayMode. Common: `table`, `list`, `hidden`. */
  displayMode?: string;
  /**
   * Expected calcs in the legend table. Two accepted shapes:
   *
   * - `string[]` — bare array. Treated as a **set** (order-insensitive
   *   match). New default; the common case is "the same set of
   *   aggregations should appear on every legend regardless of which
   *   column came first." Empty array `[]` means "expect no calcs."
   * - `{ expected: string[]; match: 'exact' | 'set' }` — explicit form.
   *   Opt into order-sensitivity with `match: 'exact'`; `match: 'set'`
   *   matches the bare-array semantics.
   *
   * Subset / superset modes are deliberately not supported — the
   * cross-set "which extras are OK?" question is taste-laden and
   * belongs in the skill, not in code (per AGENTS.md §1.8). To allow
   * a different set per dashboard family, fork the skill copy and
   * carry both.
   *
   * Issue #44.3: the original ship was order-sensitive without an
   * opt-out, which fired noisily on benign reorderings. See
   * research.md Entry 014's deferred extensions for the team review.
   */
  calcs?: string[] | { expected: string[]; match: 'exact' | 'set' };
}

/**
 * Rules specific to stat panels. Issue #53 opened this slice with
 * `requiresComparison`; issue #56 added `handlesUnknown` (originally
 * proposed as `unknownIsGrey` — reshaped during triage to drop the
 * colour-tolerance requirement when fixture evidence showed real
 * null-mapping JSON sets `result.text` and omits the `color` field
 * entirely).
 */
export interface StatPanelStyle {
  /**
   * When true, fires `panels.stat.requiresComparison` for stat panels
   * with `options.graphMode === 'none'` — i.e. the dashboard author
   * explicitly disabled the sparkline. The sparkline is the
   * deterministic "comparison signal" the team-review triage
   * (issue #50) settled on as the kernel of the aggregate-needs-
   * comparison rule. Previous-period delta and small-multiple
   * variants don't have a single JSON path; they stay in skill
   * prose for now.
   *
   * Absent `graphMode` is also flagged (Grafana 12's default is
   * `'area'` for new panels, but provisioned dashboards routinely
   * omit the field and inherit `'none'`). Set `graphMode: 'area'`
   * or `'line'` explicitly to opt in to the comparison.
   */
  requiresComparison?: boolean;
  /**
   * When true, fires `panels.stat.handlesUnknown` for stat panels with
   * no explicit handling for null / NaN values. Grafana-12's default
   * behaviour is to inherit the lowest threshold band's colour for
   * `null` — silently green (or red, on a reverse-coloured panel)
   * rather than the "no data" signal the operator expects.
   *
   * Passes when the panel carries either:
   *   - a `fieldConfig.defaults.mappings[]` entry with `type:
   *     'special'` and `options.match` in `'null' | 'nan' | 'null+nan'
   *     | 'empty'` (case-insensitive); or
   *   - a non-empty `fieldConfig.defaults.noValue` string.
   *
   * Does NOT check the colour the mapping paints null/NaN — the
   * fixture-dominant pattern (`result.text: 'N/A'` with no `color`)
   * makes a colour-equals-grey check overfit a pattern that doesn't
   * exist in the wild. The team-review triage reshaped the original
   * `unknownIsGrey` proposal to drop the colour-tolerance policy.
   * If a real bug surfaces (operator tripped by an explicitly
   * mis-coloured null), add a sharpened sub-rule then.
   */
  handlesUnknown?: boolean;
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
  /**
   * The id of the panel this finding scopes to, populated when the
   * finding's `path` resolves to a single panel. Lets callers act on
   * the result directly via `panel_update` / `panel_find` /
   * `inspect` — all of which key by id, not by JSON path. Absent
   * for dashboard-scoped findings (e.g.
   * `dashboards.variables.emptyDefault` resolves to a templating
   * variable, not a panel). Added per issue #44.
   */
  panelId?: number | string;
  /**
   * The title of the panel this finding scopes to, when present.
   * Companion to `panelId` — saves the caller a lookup when
   * composing a human-readable report. Absent for dashboard-scoped
   * findings, and absent for panel-scoped findings on panels that
   * have no title set.
   */
  panelTitle?: string;
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

// Set-equality for the bare-array calcs case (#44.3 default). Two
// arrays match if they contain the same multiset of elements — order
// irrelevant, duplicates counted. Duplicates are preserved (not
// deduped) so `['mean', 'mean']` !== `['mean']` — the legend column
// count is a meaningful difference even when order isn't.
function setsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const y of b) {
    const c = counts.get(y);
    if (c === undefined || c === 0) return false;
    counts.set(y, c - 1);
  }
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
    // Bare array = set semantics (new #44.3 default); explicit
    // { expected, match } opts into order-sensitivity via match: 'exact'.
    const expected = Array.isArray(guide.calcs) ? guide.calcs : guide.calcs.expected;
    const mode: 'exact' | 'set' = Array.isArray(guide.calcs) ? 'set' : guide.calcs.match;
    const matches = mode === 'exact' ? arraysEqual(actual, expected) : setsEqual(actual, expected);
    if (!matches) {
      const expectedStr = expected.map((c) => `"${c}"`).join(', ');
      const actualStr = actual.map((c) => `"${c}"`).join(', ');
      // Mention the "fork the skill" escape valve so users who hit this
      // for cross-set reasons (different families want different sets)
      // don't read the rule as a bug — the rule has no subset/superset
      // mode by design (AGENTS.md §1.8).
      const orderHint = mode === 'exact' ? ' (order-sensitive)' : ' (any order)';
      push({
        path: '$.options.legend.calcs',
        ruleId: 'panels.timeseries.legend.calcs',
        severity: 'info',
        message: `legend.calcs should be [${expectedStr}]${orderHint}; got [${actualStr}]. If different dashboard families need different sets, fork the skill copy and carry both.`,
      });
    }
  }
}

/**
 * Walks the panel's `targets[]` and validates any `expr` field
 * (Prometheus convention) against the PromQL grammar. Non-Prometheus
 * target fields (`query` for Loki, `rawQuery` for SQL) have
 * different syntax and are intentionally skipped — that's a separate
 * grammar to wire and the team has no demand signal yet.
 *
 * Emits one issue per broken target; severity `warn` (matches
 * `datasourceDeclared` — both catch silent-failure modes that pass
 * `validateDashboard` and only manifest at render time).
 */
function checkTargets(
  panel: Dict,
  guide: TargetsStyleGuide,
  push: (i: LintIssue) => void,
): void {
  if (guide.promqlValid !== true) return;
  const targets = asArray(panel.targets);
  for (let i = 0; i < targets.length; i++) {
    const target = asDict(targets[i]);
    if (!target) continue;
    const expr = asString(target.expr);
    if (expr === undefined) continue; // non-Prometheus target — skip
    const result = validatePromql(expr);
    if (result.valid) continue;
    const firstError = result.errors[0];
    push({
      path: `$.targets[${i}].expr`,
      ruleId: 'panels.targets.promqlValid',
      severity: 'warn',
      message:
        firstError !== undefined
          ? `PromQL syntax error in target.expr: ${firstError.message}`
          : 'PromQL syntax error in target.expr',
    });
  }
}

function checkStat(panel: Dict, guide: StatPanelStyle, push: (i: LintIssue) => void): void {
  if (guide.requiresComparison === true) {
    const graphMode = asString(asDict(panel.options)?.graphMode);
    // Fire when explicitly disabled (`'none'`) and when absent —
    // provisioned dashboards routinely omit `graphMode` and the
    // safer default is "require the author to opt in to the
    // comparison" rather than silently inheriting whatever Grafana's
    // current new-panel default happens to be.
    if (graphMode === undefined || graphMode === 'none') {
      push({
        path: '$.options.graphMode',
        ruleId: 'panels.stat.requiresComparison',
        severity: 'info',
        message: graphMode === undefined
          ? 'stat panel has no options.graphMode set — add `"graphMode": "area"` (or `"line"`) so the sparkline provides a comparison signal alongside the current value'
          : 'stat panel has options.graphMode: "none" — viewer sees only the current value with no trend context. Set to "area" or "line" to surface the comparison signal',
      });
    }
  }

  if (guide.handlesUnknown === true) {
    const defaults = asDict(asDict(panel.fieldConfig)?.defaults);
    if (!hasUnknownValueHandling(defaults)) {
      push({
        path: '$.fieldConfig.defaults',
        ruleId: 'panels.stat.handlesUnknown',
        severity: 'info',
        message:
          'stat panel has no explicit handling for null / NaN values — ' +
          'Grafana inherits the lowest threshold band\'s colour (silently ' +
          'green or red) rather than signalling "no data". Add either a ' +
          '`mappings[]` entry with `type: "special"` and `match: "null"` ' +
          '(or "nan" / "null+nan"), or set `noValue` to a non-empty string ' +
          '(e.g. "N/A").',
      });
    }
  }
}

/**
 * Returns true when the stat panel's `fieldConfig.defaults` carries an
 * explicit signal for what to show when the value is null / NaN. Two
 * accepted shapes:
 *   1. `mappings[]` contains a `{type: 'special', options: {match: ...}}`
 *      entry where `match` is one of `'null' | 'nan' | 'null+nan' |
 *      'empty'` (case-insensitive — Grafana's UI emits lowercase but
 *      hand-edited JSON varies).
 *   2. `noValue` is a non-empty string (the simpler escape hatch).
 *
 * Empty-string `noValue` does NOT count, per the project's nonEmptyString
 * convention (`src/assets/_internal.ts`).
 *
 * Does NOT inspect the colour of any matched mapping — the fixture-
 * dominant pattern (`node-exporter-full.json`) sets only `result.text`
 * and omits the `color` field entirely.
 */
function hasUnknownValueHandling(defaults: Dict | undefined): boolean {
  if (!defaults) return false;

  const noValue = nonEmptyString(defaults.noValue);
  if (noValue !== undefined) return true;

  const mappings = asArray(defaults.mappings);
  for (const raw of mappings) {
    const mapping = asDict(raw);
    if (!mapping) continue;
    if (asString(mapping.type) !== 'special') continue;
    const match = asString(asDict(mapping.options)?.match)?.toLowerCase();
    if (match === 'null' || match === 'nan' || match === 'null+nan' || match === 'empty') {
      return true;
    }
  }
  return false;
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
  const hasSliceKey =
    'timeseries' in sg || 'stat' in sg || 'units' in sg || 'descriptions' in sg;

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
          '(timeseries / stat / units / descriptions) keys at the top level — ' +
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
  if (slice.targets) checkTargets(p, slice.targets, push);

  // Per-type rules fire only when the panel's `type` matches the rule's section.
  const type = asString(p.type);
  if (type === 'timeseries' && slice.timeseries?.legend) {
    checkTimeseriesLegend(p, slice.timeseries.legend, push);
  }
  if (type === 'stat' && slice.stat) {
    checkStat(p, slice.stat, push);
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
 *   - dashboards.panels.maxRepeat
 *   - dashboards.variables.hiddenButReferenced
 *   - dashboards.variables.emptyDefault
 *   - dashboards.links.preservesVariables
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
  // duplicateTitles accepts `true`, `false`, or `{ except: [...] }`.
  // The rule fires for any truthy value; `{ except }` carries the
  // exemption list.
  const dt = dashboardSlice?.panels?.duplicateTitles;
  if (dt === true || (typeof dt === 'object' && dt !== null)) {
    const except = typeof dt === 'object' && Array.isArray(dt.except) ? dt.except : [];
    checkDuplicateTitles(dash, except, push);
  }
  if (dashboardSlice?.variables?.hiddenButReferenced === true) {
    checkHiddenButReferenced(dash, push);
  }
  if (dashboardSlice?.variables?.emptyDefault === true) {
    checkEmptyDefault(dash, push);
  }
  // maxRepeat accepts `number` or `{ max: number }`. The rule fires
  // for any panel whose variable cardinality exceeds the threshold.
  const mr = dashboardSlice?.panels?.maxRepeat;
  const maxRepeat =
    typeof mr === 'number' ? mr
    : typeof mr === 'object' && mr !== null && typeof mr.max === 'number' ? mr.max
    : undefined;
  if (maxRepeat !== undefined) {
    checkMaxRepeat(dash, maxRepeat, push);
  }
  if (dashboardSlice?.links?.preservesVariables === true) {
    checkLinksPreservesVariables(dash, push);
  }
  if (dashboardSlice?.panels?.datasourceDeclared === true) {
    checkDatasourceDeclared(dash, push);
  }
  // firstRowCategorical accepts `true` (fire on every dashboard) or
  // `{ overviewTag }` (fire only on dashboards carrying the tag). The
  // tag form is the recommended explicit scope; bare `true` is for
  // overview-only style-guide folders. See DashboardStyleGuide.layout.
  const frc = dashboardSlice?.layout?.firstRowCategorical;
  if (frc === true || (typeof frc === 'object' && frc !== null)) {
    const overviewTag =
      typeof frc === 'object' && frc !== null ? nonEmptyString(frc.overviewTag) : undefined;
    checkFirstRowCategorical(dash, overviewTag, push);
  }

  if (issues.length >= MAX_ISSUES) {
    return { issues, truncated: true };
  }
  return { issues };
}

// Runs lintPanel on one panel and rebases its `$`-rooted issue paths
// onto the panel's index in the dashboard. Skips structural panel
// issues for non-object inputs (the dashboard-level walker has already
// guarded those). Populates `panelId` / `panelTitle` on each issue
// per issue #44.1 — the dashboard walker has the panel context in
// hand here; consumers shouldn't have to re-walk the path to recover
// the id every tool downstream of lint keys by.
function appendPanelIssues(
  panel: Dict,
  panelSlice: PanelStyleGuide,
  panelPath: string,
  push: (i: LintIssue) => void,
): void {
  // Call lintPanel with the resolved slice; it will narrow internally
  // but we already vouched for the slice via resolveSlice above.
  const result = lintPanel(panel, panelSlice);
  const id = panelId(panel);
  // Use nonEmptyString — empty-string titles render identically to
  // absent in Grafana's UI and the glossary's LintIssue entry promises
  // panelTitle is absent when the panel has no title set. This is the
  // same "empty == missing" pattern checkDuplicateTitles uses below.
  const title = nonEmptyString(panel.title);
  for (const issue of result.issues) {
    // panels.shape (the panel-narrowing structural issue) shouldn't
    // occur here because we pass a dict, but skip defensively.
    if (issue.ruleId === 'panels.shape') continue;
    // The path rebase below assumes lintPanel's output paths are
    // rooted at `$` (the standalone-panel JSONPath root). Skip any
    // issue whose path violates that contract rather than producing
    // garbage like `panels[0]styleGuide.x`. Future lintPanel rules
    // that emit non-`$`-rooted paths (e.g. `$styleGuide.*`) flow
    // through this branch and are dropped here cleanly.
    if (!issue.path.startsWith('$')) continue;
    const rebased: LintIssue = {
      ...issue,
      path: issue.path === '$' ? panelPath : `${panelPath}${issue.path.slice(1)}`,
    };
    // Only set panelId / panelTitle if available — keep undefined
    // fields off the result object so JSON.stringify output stays
    // free of explicit `undefined` keys.
    if (id !== undefined) rebased.panelId = id;
    if (title !== undefined) rebased.panelTitle = title;
    push(rebased);
  }
}

// dashboards.panels.duplicateTitles — counts non-row panel titles
// across the full tree (top-level + legacy nested). Excludes:
//   - row panels (section markers; often share titles legitimately)
//   - panels with a `repeat:` field. Grafana's repeat feature
//     creates N runtime copies of the panel that share the source
//     panel's title by design — flagging the source as a duplicate
//     would fire on every repeat-using dashboard.
function checkDuplicateTitles(
  dash: Dict,
  except: string[],
  push: (i: LintIssue) => void,
): void {
  const exemptions = new Set(except);
  const titleToIds = new Map<string, Array<number | string>>();

  const visit = (panel: Dict): void => {
    if (asString(panel.type) === 'row') return;
    if (asString(panel.repeat) !== undefined) return;
    const title = asString(panel.title);
    if (title === undefined || title === '') return;
    const id = panel.id;
    if (typeof id !== 'number' && typeof id !== 'string') return;
    const existing = titleToIds.get(title);
    if (existing) existing.push(id);
    else titleToIds.set(title, [id]);
  };

  for (const panel of walkPanelsDeep(dash.panels)) {
    visit(panel);
  }

  for (const [title, ids] of titleToIds) {
    if (ids.length < 2) continue;
    if (exemptions.has(title)) continue;
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
// Some dashboard exports / round-trips coerce numeric fields to
// strings; tolerate hide: "2" as well as hide: 2. Empty strings are
// rejected explicitly because `Number("") === 0` would otherwise
// silently mean "visible" — an undeclared hide value should resolve
// to undefined, not 0.
function hideValueOf(v: Dict): number | undefined {
  const n = asNumber(v.hide);
  if (n !== undefined) return n;
  const s = asString(v.hide);
  if (s === undefined || s === '') return undefined;
  const parsed = Number(s);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function checkHiddenButReferenced(dash: Dict, push: (i: LintIssue) => void): void {
  const variables = asArray(asDict(dash.templating)?.list);
  // Capture both name and index so path is in the indexed form used
  // by every other rule (consistent with `emptyDefault`'s
  // `templating.list[N].current.value`); previously used JSONPath
  // filter syntax `[?(name="X")]` which no other path in this codebase
  // uses and which breaks consumers that parse paths as plain indexed
  // selectors.
  const hidden: Array<{ name: string; index: number }> = [];
  for (let i = 0; i < variables.length; i++) {
    const vd = asDict(variables[i]);
    if (!vd) continue;
    if (hideValueOf(vd) === 2) {
      const name = asString(vd.name);
      if (name) hidden.push({ name, index: i });
    }
  }
  if (hidden.length === 0) return;

  const titles: string[] = [];
  for (const panel of walkPanelsDeep(dash.panels)) {
    const t = asString(panel.title);
    if (t) titles.push(t);
  }

  for (const { name, index } of hidden) {
    // Match $name, ${name}, ${name:fmt}, [[name]], [[name:csv]] — same
    // syntaxes recognised by rename.ts and validate.ts.
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `\\$${safe}(?![a-zA-Z0-9_])|\\$\\{${safe}(:[^}]*)?\\}|\\[\\[${safe}(:[^\\]]*)?\\]\\]`,
    );
    for (const title of titles) {
      if (re.test(title)) {
        push({
          path: `templating.list[${index}].hide`,
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
// Only fires for variable types where an empty default is a real
// load-time hazard:
//   - `query`     — needs a selection to compose downstream queries
//   - `datasource`— needs a selection so panels resolve their data source
//   - `interval`  — needs a selection for time-range math
// Other types (`custom`, `constant`, `textbox`, `adhoc`) can legitimately
// ship with an empty default — `textbox` is typically blank by design;
// `adhoc` starts with zero filters; `constant` and `custom` may have
// no default if the dashboard expects the user to pick.
const EMPTY_DEFAULT_RISK_TYPES = new Set(['query', 'datasource', 'interval']);

function checkEmptyDefault(dash: Dict, push: (i: LintIssue) => void): void {
  const list = asArray(asDict(dash.templating)?.list);
  for (let i = 0; i < list.length; i++) {
    const v = asDict(list[i]);
    if (!v) continue;
    const type = asString(v.type);
    if (type === undefined || !EMPTY_DEFAULT_RISK_TYPES.has(type)) continue;
    const current = asDict(v.current);
    const value = current ? asString(current.value) : undefined;
    if (value === undefined || value === '') {
      const name = asString(v.name) ?? `[${i}]`;
      push({
        path: `templating.list[${i}].current.value`,
        ruleId: 'dashboards.variables.emptyDefault',
        severity: 'info',
        message: `variable "${name}" (type: ${type}) has no current.value default — panels using it may render with no selection on first load`,
      });
    }
  }
}

// dashboards.panels.maxRepeat — fires when a `repeat: $variable`
// panel's variable cardinality exceeds the configured threshold.
// Mitigates the Cacti-era per-device-page anti-pattern. Cardinality
// is read from the variable's `options[]` length, falling back to
// the `current.value` array length (for multi-select), then to the
// comma-separated `current.text` split — Grafana stores it in
// whichever shape, depending on variable type and provisioning.
function variableCardinality(v: Dict): number | undefined {
  const options = asArray(v.options);
  if (options.length > 0) {
    // Exclude the synthetic "All" option Grafana sometimes prepends
    // (it has `value: "$__all"`), which inflates cardinality by one
    // and isn't a real choice.
    let count = 0;
    let hadAll = false;
    for (const opt of options) {
      const o = asDict(opt);
      if (!o) continue;
      if (asString(o.value) === '$__all') {
        hadAll = true;
        continue;
      }
      count++;
    }
    if (count > 0) return count;
    // Options list contained only `$__all` (the user hasn't loaded /
    // resolved any real options yet, or there are genuinely none).
    // Cardinality is 0, not undefined — don't fall through to the
    // current.text/value path, which would mis-read `current.text:
    // "All"` as cardinality 1.
    if (hadAll) return 0;
  }
  const current = asDict(v.current);
  if (current) {
    // current.value == "$__all" is the same case as above (only the
    // All sentinel) — return 0, not 1.
    if (asString(current.value) === '$__all') return 0;
    const value = current.value;
    if (Array.isArray(value)) return value.length;
    const text = asString(current.text);
    if (text === 'All') return 0;
    if (text !== undefined && text !== '') {
      // Multi-select serialized as "a + b + c" or "a,b,c". Conservative
      // split: prefer "+ " separators (Grafana's display form), fall
      // back to "," for the provisioned form.
      if (text.includes(' + ')) return text.split(' + ').length;
      if (text.includes(',')) return text.split(',').length;
      return 1;
    }
  }
  return undefined;
}

function checkMaxRepeat(dash: Dict, max: number, push: (i: LintIssue) => void): void {
  const list = asArray(asDict(dash.templating)?.list);
  const varByName = new Map<string, Dict>();
  for (const item of list) {
    const v = asDict(item);
    if (!v) continue;
    const name = asString(v.name);
    if (name !== undefined) varByName.set(name, v);
  }

  const visit = (panel: Dict, pathPrefix: string): void => {
    const repeatVar = asString(panel.repeat);
    if (repeatVar === undefined) return;
    const v = varByName.get(repeatVar);
    if (!v) {
      // Variable referenced by `repeat:` doesn't exist in
      // templating.list[]. Emit one structural issue so the caller
      // sees the broken reference rather than silently skipping the
      // cardinality check.
      const id = panelId(panel);
      const title = nonEmptyString(panel.title);
      const issue: LintIssue = {
        path: `${pathPrefix}.repeat`,
        ruleId: 'dashboards.panels.maxRepeat',
        severity: 'warn',
        message: `panel.repeat references "$${repeatVar}" but no such variable in templating.list[] — cardinality cannot be checked`,
      };
      if (id !== undefined) issue.panelId = id;
      if (title !== undefined) issue.panelTitle = title;
      push(issue);
      return;
    }
    const card = variableCardinality(v);
    if (card === undefined) return; // unresolved — no opinion
    if (card <= max) return;
    const id = panelId(panel);
    const title = nonEmptyString(panel.title);
    const issue: LintIssue = {
      path: `${pathPrefix}.repeat`,
      ruleId: 'dashboards.panels.maxRepeat',
      severity: 'warn',
      message: `panel repeats by "$${repeatVar}" with cardinality ${card}, above the configured max of ${max} — consider a Top-N table, a state-timeline matrix, or a heatmap instead`,
    };
    if (id !== undefined) issue.panelId = id;
    if (title !== undefined) issue.panelTitle = title;
    push(issue);
  };

  for (const { panel, path } of walkPanelsWithPath(dash)) {
    visit(panel, path);
  }
}

// dashboards.panels.datasourceDeclared — fires on any non-row panel
// without an explicit datasource ref (or with an empty `{}` ref). The
// silent-broken-dashboard failure mode: without a datasource on a
// panel, Grafana falls back to the instance-wide default; if no
// default is set the panel queries nothing and renders blank. Walks
// top-level + legacy row.panels[] children.
function isUsableDatasourceRef(ds: unknown): boolean {
  // Legacy string form (e.g. `datasource: "Prometheus"`) is accepted
  // verbatim. Modern object form needs at least one of uid/type.
  if (typeof ds === 'string') return ds.length > 0;
  const d = asDict(ds);
  if (!d) return false;
  return nonEmptyString(d.uid) !== undefined || nonEmptyString(d.type) !== undefined;
}

function checkDatasourceDeclared(dash: Dict, push: (i: LintIssue) => void): void {
  const visit = (panel: Dict, pathPrefix: string): void => {
    // Rows don't query — exclude them entirely, same convention as
    // hasUnit / hasDescription / duplicateTitles. A row panel that
    // happens to carry a datasource is harmless and not flagged
    // either; the field just isn't used at render time.
    if (asString(panel.type) === 'row') return;

    if (isUsableDatasourceRef(panel.datasource)) return;

    const id = panelId(panel);
    const title = nonEmptyString(panel.title);
    const issue: LintIssue = {
      path: `${pathPrefix}.datasource`,
      ruleId: 'dashboards.panels.datasourceDeclared',
      severity: 'warn',
      message:
        'panel has no datasource ref — Grafana falls back to the ' +
        'instance default. If no default is set, the panel queries ' +
        'nothing. Set `datasource: { uid: "<your-ds-uid>", type: "..." }` ' +
        'or use a templating-variable ref like `{ uid: "$datasource" }` ' +
        'for multi-environment dashboards.',
    };
    if (id !== undefined) issue.panelId = id;
    if (title !== undefined) issue.panelTitle = title;
    push(issue);
  };

  for (const { panel, path } of walkPanelsWithPath(dash)) {
    visit(panel, path);
  }
}

// dashboards.layout.firstRowCategorical — fires when an overview
// dashboard's first row (the fold) is a wall of numbers/graphs with no
// categorical-health panel. Scoping is mandatory: see
// DashboardStyleGuide.layout.firstRowCategorical.
//
// Categorical-health panel types satisfy the fold (their presence
// passes the rule); numeric/graph types trigger it when no categorical
// panel is present. Other types (text, news, dashlist, …) are neutral —
// they neither satisfy nor trigger, so a text-only header fold does not
// fire.
const CATEGORICAL_FOLD_TYPES = new Set(['state-timeline', 'alertlist']);
const NUMERIC_FOLD_TYPES = new Set(['stat', 'gauge', 'timeseries', 'barchart', 'bargauge']);

function checkFirstRowCategorical(
  dash: Dict,
  overviewTag: string | undefined,
  push: (i: LintIssue) => void,
): void {
  // Scope gate. With a tag configured, fire only on dashboards that
  // carry it; a dashboard with no matching tag is (by the author's own
  // convention) not an overview dashboard and is skipped silently.
  if (overviewTag !== undefined) {
    const tags = asArray(dash.tags)
      .map((t) => asString(t))
      .filter((t): t is string => t !== undefined);
    if (!tags.includes(overviewTag)) return;
  }

  // The fold is a top-level, positioned concept. Consider only
  // top-level non-row panels that declare a gridPos; legacy nested
  // row.panels[] children and not-yet-laid-out panels are out of scope.
  const topPanels = asArray(dash.panels);
  const positioned: Array<{ panel: Dict; y: number; index: number }> = [];
  for (let i = 0; i < topPanels.length; i++) {
    const panel = asDict(topPanels[i]);
    if (!panel) continue;
    if (asString(panel.type) === 'row') continue;
    const gp = panelGridPos(panel);
    if (gp === undefined) continue;
    positioned.push({ panel, y: gp.y, index: i });
  }
  if (positioned.length === 0) return;

  const minY = Math.min(...positioned.map((p) => p.y));
  const fold = positioned.filter((p) => p.y === minY);

  let hasCategorical = false;
  let hasNumeric = false;
  for (const { panel } of fold) {
    const type = asString(panel.type);
    if (type === undefined) continue;
    if (CATEGORICAL_FOLD_TYPES.has(type)) hasCategorical = true;
    else if (NUMERIC_FOLD_TYPES.has(type)) hasNumeric = true;
  }

  // Pass when the fold already carries categorical health, or when it
  // has no numeric/graph panel to begin with (e.g. a text-only header).
  if (hasCategorical || !hasNumeric) return;

  const foldTypes = fold
    .map(({ panel }) => asString(panel.type))
    .filter((t): t is string => t !== undefined);
  push({
    path: 'panels',
    ruleId: 'dashboards.layout.firstRowCategorical',
    severity: 'warn',
    message:
      `overview dashboard's first row (the fold) is numeric/graph panels ` +
      `(${foldTypes.join(', ')}) with no categorical-health panel — the ` +
      `operator's first question is "is anything red?", not "what's the ` +
      `value?". Lead row 1 with a state-timeline (SLO/fleet status) + an ` +
      `alertlist; defer numeric tiles to row 2.`,
  });
}

// dashboards.links.preservesVariables — fires when an internal
// dashboard-to-dashboard link (URL path starts with /d/ or
// /dashboard/) drops EVERY referenced templating variable. Partial
// drops are intentional (per-pod → per-cluster drill-up drops $pod
// on purpose) and not flagged. External URLs are ignored.
const DASHBOARD_PATH_PREFIXES = ['/d/', '/dashboard/'];
function isInternalDashboardUrl(url: string): boolean {
  // Handle both absolute (`https://grafana.example.com/d/...`) and
  // relative (`/d/...`, `d/...`) URLs. Grafana stores both depending
  // on the dashboard author's habits.
  //
  // Parse the path properly rather than substring-matching — a URL
  // like `https://example.com/some-/d/-name/x` contains `/d/` but
  // points at an external service, and a substring match would
  // mis-flag it. Try `new URL` first for absolute URLs; fall back
  // to treating the whole string as a path for relative URLs.
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Relative URL (`/d/...`, `d/...`, `./d/...`). Strip leading `./`
    // for the prefix check; the leading `/` is preserved.
    pathname = url.startsWith('./') ? url.slice(1) : url;
  }
  for (const prefix of DASHBOARD_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

// Returns the set of templating variable names referenced by the URL
// (as `$var` or `${var}`). Only counts those that appear in `varNames`
// — i.e. variables actually defined on the source dashboard.
function variablesReferencedInUrl(url: string, varNames: Set<string>): Set<string> {
  const referenced = new Set<string>();
  // ${var} form first (it's a strict substring of $var).
  const bracedRe = /\$\{(\w+)(?::[^}]*)?\}/g;
  for (const m of url.matchAll(bracedRe)) {
    if (m[1] !== undefined && varNames.has(m[1])) referenced.add(m[1]);
  }
  const bareRe = /\$(\w+)/g;
  for (const m of url.matchAll(bareRe)) {
    if (m[1] !== undefined && varNames.has(m[1])) referenced.add(m[1]);
  }
  return referenced;
}

function checkLinksPreservesVariables(dash: Dict, push: (i: LintIssue) => void): void {
  const list = asArray(asDict(dash.templating)?.list);
  const varNames = new Set<string>();
  for (const item of list) {
    const v = asDict(item);
    if (!v) continue;
    const name = asString(v.name);
    if (name !== undefined) varNames.add(name);
  }
  // Rule no-ops when no templating variables are defined — nothing
  // for a link to drop.
  if (varNames.size === 0) return;

  const checkOneLink = (
    link: Dict,
    path: string,
    panelContext: { id?: number | string; title?: string } | null,
  ): void => {
    const url = asString(link.url);
    if (url === undefined || url === '') return;
    if (!isInternalDashboardUrl(url)) return;
    const referenced = variablesReferencedInUrl(url, varNames);
    if (referenced.size === varNames.size) return; // preserves all
    if (referenced.size > 0) return; // partial drop — intentional
    // referenced.size === 0 and varNames.size > 0 — link drops
    // every dashboard variable. Fire.
    const issue: LintIssue = {
      path,
      ruleId: 'dashboards.links.preservesVariables',
      severity: 'info',
      message: `drill-down link "${url}" drops every templating variable (${[...varNames].sort().map((n) => `$${n}`).join(', ')}) — viewer lands with empty selectors`,
    };
    if (panelContext?.id !== undefined) issue.panelId = panelContext.id;
    if (panelContext?.title !== undefined) issue.panelTitle = panelContext.title;
    push(issue);
  };

  // Dashboard-header links — these are the header-bar drill-downs the
  // dashboard author put at the top of the page, separate from any
  // panel. Common in node-exporter / community dashboards. No panel
  // context, so no panelId / panelTitle on the finding.
  const dashLinks = asArray(dash.links);
  for (let i = 0; i < dashLinks.length; i++) {
    const link = asDict(dashLinks[i]);
    if (link) checkOneLink(link, `links[${i}].url`, null);
  }

  const visit = (panel: Dict, pathPrefix: string): void => {
    const id = panelId(panel);
    const title = nonEmptyString(panel.title);
    const ctx: { id?: number | string; title?: string } = {};
    if (id !== undefined) ctx.id = id;
    if (title !== undefined) ctx.title = title;
    const arr1 = asArray(panel.links);
    for (let i = 0; i < arr1.length; i++) {
      const link = asDict(arr1[i]);
      if (link) checkOneLink(link, `${pathPrefix}.links[${i}].url`, ctx);
    }
    const defaults = asDict(asDict(panel.fieldConfig)?.defaults);
    if (defaults) {
      const arr2 = asArray(defaults.links);
      for (let i = 0; i < arr2.length; i++) {
        const link = asDict(arr2[i]);
        if (link) {
          checkOneLink(link, `${pathPrefix}.fieldConfig.defaults.links[${i}].url`, ctx);
        }
      }
    }
  };

  for (const { panel, path } of walkPanelsWithPath(dash)) {
    visit(panel, path);
  }
}
