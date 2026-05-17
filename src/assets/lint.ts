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

import { type Dict, asArray, asDict, asString } from './_internal.js';

// ---- Public types ---------------------------------------------------------

/**
 * The umbrella style-guide shape, as persisted in the skill markdown's
 * JSON block. Currently has `panels` only; future revisions add
 * `dashboards`, `alertRules`, etc. — purely additive.
 */
export interface GrafanaStyleGuide {
  /** Optional schema URL for versioning the wire format. Advisory only. */
  $schema?: string;
  /** Panel-level rules (per-type + cross-type units / descriptions). */
  panels?: PanelStyleGuide;
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

export function lintPanel(panel: unknown, guide: PanelStyleGuide): LintResult {
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

  const issues: LintIssue[] = [];
  const push = (i: LintIssue): void => {
    if (issues.length < MAX_ISSUES) issues.push(i);
  };

  // Cross-type rules apply to every panel regardless of `type`.
  if (guide.units) checkUnits(p, guide.units, push);
  if (guide.descriptions) checkDescription(p, guide.descriptions, push);

  // Per-type rules fire only when the panel's `type` matches the rule's section.
  const type = asString(p.type);
  if (type === 'timeseries' && guide.timeseries?.legend) {
    checkTimeseriesLegend(p, guide.timeseries.legend, push);
  }

  if (issues.length >= MAX_ISSUES) {
    return { issues, truncated: true };
  }
  return { issues };
}
