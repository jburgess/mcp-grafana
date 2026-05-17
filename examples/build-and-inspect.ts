/**
 * Example: build a dashboard from scratch and inspect the result.
 *
 * Mirrors the README's Quickstart with one addition — calls
 * `inspectDashboard` to show what the resulting JSON looks like at
 * the summary level. This is the smallest end-to-end flow:
 *
 *   buildTimeseriesPanel  →  buildDashboard  →  inspectDashboard
 *
 * Exercised by `test/examples/build-and-inspect.test.ts` on every CI
 * run — if the README's quickstart promise breaks, the test fails.
 *
 * In your own project, replace the relative `../src/index.js` import
 * below with the package name:
 *
 *   import { buildDashboard, buildTimeseriesPanel, inspectDashboard }
 *     from '@jburgess/mcp-grafana';
 *
 * The relative import is used here because the example lives inside
 * the repo that ships the package.
 */

import {
  buildDashboard,
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
  const requests = buildTimeseriesPanel({
    title: 'HTTP requests',
    description: 'The total number of processed HTTP requests, by status class.',
    unit: 'reqps',
    targets: [
      {
        expr: 'sum(rate(http_requests_total[$__rate_interval])) by (status)',
        legendFormat: '{{ status }}',
      },
    ],
  });

  const dashboard = buildDashboard({
    title: 'HTTP service',
    panels: [requests],
  });

  const result = inspectDashboard(dashboard);
  // inspectDashboard's default detail level is 'summary' — narrow the
  // union return type so the caller gets a clean DashboardSummary.
  if (result.detail !== 'summary') {
    throw new Error(`expected summary detail, got ${result.detail}`);
  }

  return { dashboard, summary: result };
}
