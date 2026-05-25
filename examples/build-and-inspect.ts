/**
 * Example: build a multi-panel dashboard from scratch and inspect the
 * result.
 *
 * Mirrors the README's Quickstart with one addition — calls
 * `inspectDashboard` to show what the resulting JSON looks like at
 * the summary level. The smallest end-to-end flow that exercises:
 *
 *   buildRowPanel + buildStatPanel + buildTimeseriesPanel
 *     →  buildDashboard  →  inspectDashboard
 *
 * The example demonstrates the project's two "set this explicitly"
 * conventions: section structure via row panels, and `datasource` on
 * every data-bearing panel (the silent-broken-dashboard failure mode
 * is otherwise easy to hit).
 *
 * Exercised by `test/examples/build-and-inspect.test.ts` on every CI
 * run — if the README's quickstart promise breaks, the test fails.
 *
 * In your own project, replace the relative `../src/index.js` import
 * below with the package name:
 *
 *   import {
 *     buildDashboard,
 *     buildRowPanel,
 *     buildStatPanel,
 *     buildTimeseriesPanel,
 *     inspectDashboard,
 *   } from '@jburgess-js/mcp-grafana';
 *
 * The relative import is used here because the example lives inside
 * the repo that ships the package.
 */

import {
  buildDashboard,
  buildRowPanel,
  buildStatPanel,
  buildTimeseriesPanel,
  inspectDashboard,
  type DashboardSummary,
} from '../src/index.js';

export interface BuildAndInspectResult {
  /**
   * The full dashboard JSON, ready to POST to Grafana's HTTP API or
   * to write into a provisioning file. Typed as the Foundation SDK's
   * Dashboard class on the way out; consumers can treat it as plain
   * JSON for serialization.
   */
  dashboard: ReturnType<typeof buildDashboard>;
  /** The summary view from inspectDashboard — title, uid, panel count, etc. */
  summary: DashboardSummary;
}

export function main(): BuildAndInspectResult {
  // Templating-variable datasource ref — resolves at render time so
  // the same dashboard works against dev / staging / prod Grafanas
  // without rebuilding. The dashboard would normally declare a
  // matching `$datasource` template variable; omitted here to keep
  // the example focused on the panel composition.
  const ds = { uid: '$datasource', type: 'prometheus' };

  const dashboard = buildDashboard({
    title: 'HTTP service',
    panels: [
      buildRowPanel({ title: 'Overview' }),
      buildStatPanel({
        title: 'Error rate (last 5m)',
        description: '5xx as a fraction of total requests.',
        unit: 'percentunit',
        targets: [
          {
            expr:
              'sum(rate(http_requests_total{status=~"5.."}[5m])) / ' +
              'sum(rate(http_requests_total[5m]))',
          },
        ],
        datasource: ds,
      }),
      buildRowPanel({ title: 'Request flow' }),
      buildTimeseriesPanel({
        title: 'HTTP requests',
        description: 'The total number of processed HTTP requests, by status class.',
        unit: 'reqps',
        targets: [
          {
            expr: 'sum(rate(http_requests_total[$__rate_interval])) by (status)',
            legendFormat: '{{ status }}',
          },
        ],
        datasource: ds,
      }),
    ],
  });

  const result = inspectDashboard(dashboard);
  // inspectDashboard's default detail level is 'summary' — narrow the
  // union return type so the caller gets a clean DashboardSummary.
  if (result.detail !== 'summary') {
    throw new Error(`expected summary detail, got ${result.detail}`);
  }

  return { dashboard, summary: result };
}
