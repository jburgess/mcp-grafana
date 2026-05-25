/**
 * Example: audit an existing (messy) dashboard and produce a prioritised
 * review, then fix one finding and verify it cleared.
 *
 * Runnable demonstration of `docs/guidance/audit-review.md` (served at
 * `mcp://grafana/docs/guidance/audit-review.md`). The flow:
 *
 *   inspectDashboard(summary)            ← orient
 *     → lintDashboard(styleGuide)        ← structural findings (the tools)
 *     → prioritise: warn before info     ← the judgement (the recipe)
 *     → updatePanel(fix)                 ← apply one fix
 *     → lintDashboard again              ← verify it cleared
 *
 * The dashboard below is deliberately messy — it plants issues across
 * several rules so the audit has something to find. The prioritisation
 * (warn-before-info) is the recipe's judgement, demonstrated here for one
 * input the way an LLM reading the guidance would do it; it is NOT a
 * general `audit()` function, and there is no `grafana_dashboard_audit`
 * tool (orchestration + prioritisation stay in the markdown the model
 * reads — AGENTS.md §1.8). This file exists so CI proves the chain
 * composes and the fix→verify loop actually clears the finding.
 */

import {
  inspectDashboard,
  lintDashboard,
  updatePanel,
  type DashboardSummary,
  type GrafanaStyleGuide,
  type LintIssue,
  type LintResult,
} from '../src/index.js';

/**
 * A dashboard with planted problems:
 *  - panel 1: no `datasource` (silent-broken, warn) + `rate(...)` with no
 *    range vector (promqlSemantic, warn)
 *  - panel 2: stat with no `graphMode` (requiresComparison, info) and no
 *    `description` (descriptions.required, info)
 *  - a trailing empty row (orphanRow, info)
 *  - an unreferenced templating variable (unreferenced, info)
 */
export const MESSY_DASHBOARD: Record<string, unknown> = {
  title: 'API service',
  templating: {
    list: [
      { name: 'datasource', type: 'datasource', current: { value: 'prometheus' } },
      // Declared but never interpolated anywhere → unreferenced.
      { name: 'unused_region', type: 'query', current: { value: 'us-east' } },
    ],
  },
  panels: [
    {
      id: 1,
      type: 'timeseries',
      title: 'Request rate',
      description: 'Requests per second by status.',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      // Missing `datasource` (warn) AND rate() with no range (warn).
      targets: [{ refId: 'A', expr: 'rate(http_requests_total)' }],
    },
    {
      id: 2,
      type: 'stat',
      title: 'Error ratio',
      // No `description` (info) and no `options.graphMode` (info).
      fieldConfig: { defaults: { unit: 'percentunit' } },
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
      datasource: { uid: '$datasource', type: 'prometheus' },
      targets: [
        {
          refId: 'A',
          expr: 'sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))',
        },
      ],
    },
    // Trailing empty row → orphanRow (info).
    { id: 3, type: 'row', title: 'Resources', gridPos: { x: 0, y: 8, w: 24, h: 1 } },
  ],
};

/**
 * The style guide the audit runs against — the structural rules a team
 * would realistically turn on.
 */
function styleGuide(): GrafanaStyleGuide {
  return {
    panels: {
      units: { allowList: ['reqps', 'percentunit', 'short', 's', 'bytes'] },
      descriptions: { required: true },
      stat: { requiresComparison: true },
      targets: { promqlValid: true, promqlSemantic: true },
    },
    dashboards: {
      panels: { duplicateTitles: true, datasourceDeclared: true, orphanRow: true },
      variables: { unreferenced: true },
    },
  };
}

export interface AuditResult {
  summary: DashboardSummary;
  before: LintResult;
  /** before.issues split by severity — warn (silent failures) first. */
  report: { warn: LintIssue[]; info: LintIssue[] };
  /** The panel whose datasource we patched to demonstrate fix→verify. */
  fixedPanelId: number;
  after: LintResult;
}

export function main(): AuditResult {
  const sg = styleGuide();

  // Step 1 — orient.
  const summary = inspectDashboard(MESSY_DASHBOARD, { detail: 'summary' }) as DashboardSummary;

  // Step 2 — lint for structural findings.
  const before = lintDashboard(MESSY_DASHBOARD, sg);

  // Step 3 — prioritise (the recipe's judgement): warn before info,
  // each bucket ordered by panel for grouping.
  const byPanel = (a: LintIssue, b: LintIssue): number =>
    String(a.panelId ?? '').localeCompare(String(b.panelId ?? ''));
  const report = {
    warn: before.issues.filter((i) => i.severity === 'warn').sort(byPanel),
    info: before.issues.filter((i) => i.severity === 'info').sort(byPanel),
  };

  // Step 4 — fix the highest-priority silent-failure (the missing
  // datasource on panel 1) and verify it cleared.
  const fixedPanelId = 1;
  const fixed = updatePanel(MESSY_DASHBOARD, fixedPanelId, {
    datasource: { uid: '$datasource', type: 'prometheus' },
  });
  const after = lintDashboard(fixed.dashboard ?? MESSY_DASHBOARD, sg);

  return { summary, before, report, fixedPanelId, after };
}
