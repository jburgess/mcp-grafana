/**
 * Example: scaffold a committable dashboard from a Prometheus `/metrics`
 * scrape.
 *
 * Runnable demonstration of `docs/guidance/scaffold-from-metrics.md`
 * (served at `mcp://grafana/docs/guidance/scaffold-from-metrics.md`).
 * The flow:
 *
 *   parsePrometheusText(/metrics)        ← deterministic facts (the tool)
 *     → classify each metric by type/labels/name
 *     → map to RED panels per skills/grafana-style-guide/SKILL.md (the opinion)
 *     → buildStateTimeline/Stat/Timeseries + buildDashboard
 *     → lintDashboard  (self-check; asserts clean below)
 *
 * IMPORTANT: the metric→panel mapping in `main()` is ONE worked
 * application of the recipe for this specific input, the way an LLM
 * reading the guidance + skill would compose it. It is NOT a general
 * `scaffold()` function — choosing panels from arbitrary metrics is
 * judgement that lives in the markdown the model reads, not in code
 * (AGENTS.md §1.8). This file exists so CI proves the primitives compose
 * as the recipe claims and the result lints clean.
 */

import {
  buildDashboard,
  buildRowPanel,
  buildStatPanel,
  buildStateTimelinePanel,
  buildTimeseriesPanel,
  lintDashboard,
  parsePrometheusText,
  type GrafanaStyleGuide,
  type LintResult,
  type PrometheusMetric,
} from '../src/index.js';

/**
 * A representative request-driven HTTP service exposition: a request
 * counter with a `status` label (RED rate + errors), a latency histogram
 * (RED duration), a resource gauge (USE), and a `0/1` health gauge
 * (categorical fold). Enough shape to exercise every classification branch
 * in the recipe's Step 1.
 */
export const SAMPLE_METRICS = [
  '# HELP up 1 if the target is reachable.',
  '# TYPE up gauge',
  'up{job="api"} 1',
  '# HELP http_requests_total Total HTTP requests.',
  '# TYPE http_requests_total counter',
  'http_requests_total{method="GET",status="200"} 17034',
  'http_requests_total{method="GET",status="500"} 12',
  'http_requests_total{method="POST",status="200"} 4120',
  '# HELP http_request_duration_seconds Request duration.',
  '# TYPE http_request_duration_seconds histogram',
  'http_request_duration_seconds_bucket{le="0.1"} 18000',
  'http_request_duration_seconds_bucket{le="0.5"} 21000',
  'http_request_duration_seconds_bucket{le="+Inf"} 21166',
  'http_request_duration_seconds_sum 8123.4',
  'http_request_duration_seconds_count 21166',
  '# HELP process_resident_memory_bytes Resident memory in bytes.',
  '# TYPE process_resident_memory_bytes gauge',
  'process_resident_memory_bytes{job="api"} 734003200',
  '',
].join('\n');

export interface ScaffoldResult {
  /** The metric families parsed from the scrape (the deterministic facts). */
  metrics: PrometheusMetric[];
  /** The scaffolded dashboard JSON, ready to commit / POST to Grafana. */
  dashboard: ReturnType<typeof buildDashboard>;
  /** The style guide it was checked against. */
  styleGuide: GrafanaStyleGuide;
  /** Result of linting the scaffold against `styleGuide` — expected clean. */
  lint: LintResult;
}

/**
 * The style guide the scaffold targets. Mirrors the rules a team would
 * realistically turn on; the recipe's Step 2 defaults are chosen to
 * satisfy each of these out of the box.
 */
function styleGuide(): GrafanaStyleGuide {
  return {
    panels: {
      units: { allowList: ['percentunit', 'reqps', 's', 'bytes', 'short'] },
      descriptions: { required: true },
      stat: { requiresComparison: true },
      targets: { promqlValid: true },
    },
    dashboards: {
      panels: { duplicateTitles: true, datasourceDeclared: true },
      // The fold rule is opt-in and tag-scoped; the scaffold tags the
      // dashboard `overview` and leads row 1 with a state-timeline, so
      // this enforces (and passes) the project's flagship layout rule.
      layout: { firstRowCategorical: { overviewTag: 'overview' } },
    },
  };
}

export function main(): ScaffoldResult {
  // Step 0 — parse the scrape into deterministic facts. (In an MCP
  // session this is `prometheus_metric_parse`.)
  const metrics = parsePrometheusText(SAMPLE_METRICS);

  // Every data-bearing panel resolves its datasource at render time via a
  // templating variable — the standard multi-environment pattern.
  const ds = { uid: '$datasource', type: 'prometheus' };

  // Step 1+2 — classify and map. Spelled out per metric so the example
  // reads as "here is the decision the recipe prescribes", not a loop
  // hiding the judgement.

  // `up` (gauge, 0/1) → categorical health → the fold (row 1).
  const healthPanel = buildStateTimelinePanel({
    title: 'Service health',
    description: 'Target reachability (`up`) over time — the fold answers "is anything red?".',
    targets: [{ expr: 'up{job="api"}', legendFormat: '{{job}}' }],
    datasource: ds,
  });

  // `http_requests_total` (counter with a `status` label) → RED rate + errors.
  const errorRatioPanel = buildStatPanel({
    title: 'Error ratio (5m)',
    description: '5xx responses as a fraction of all requests.',
    unit: 'percentunit',
    targets: [
      {
        expr:
          'sum(rate(http_requests_total{status=~"5.."}[5m])) ' +
          '/ sum(rate(http_requests_total[5m]))',
      },
    ],
    datasource: ds,
  });
  const requestRatePanel = buildTimeseriesPanel({
    title: 'Request rate by status',
    description: 'Requests per second, split by HTTP status class.',
    unit: 'reqps',
    targets: [
      {
        expr: 'sum by (status) (rate(http_requests_total[$__rate_interval]))',
        legendFormat: '{{status}}',
      },
    ],
    datasource: ds,
  });

  // `http_request_duration_seconds_bucket` (histogram) → RED duration.
  const latencyPanel = buildTimeseriesPanel({
    title: 'Latency (p50 / p90 / p99)',
    description: 'Request-duration quantiles from the histogram buckets.',
    unit: 's',
    targets: [
      {
        expr: 'histogram_quantile(0.50, sum by (le) (rate(http_request_duration_seconds_bucket[$__rate_interval])))',
        legendFormat: 'p50',
      },
      {
        expr: 'histogram_quantile(0.90, sum by (le) (rate(http_request_duration_seconds_bucket[$__rate_interval])))',
        legendFormat: 'p90',
      },
      {
        expr: 'histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[$__rate_interval])))',
        legendFormat: 'p99',
      },
    ],
    datasource: ds,
  });

  // `process_resident_memory_bytes` (resource gauge) → USE utilisation.
  const memoryPanel = buildTimeseriesPanel({
    title: 'Resident memory',
    description: 'Process resident set size.',
    unit: 'bytes',
    targets: [{ expr: 'process_resident_memory_bytes{job="api"}', legendFormat: '{{job}}' }],
    datasource: ds,
  });

  // Step 3 — compose in row sequence: categorical-health fold first, then
  // RED, then resources. `overview` tag opts the dashboard into the
  // first-row-categorical layout rule.
  const dashboard = buildDashboard({
    title: 'API service — overview',
    tags: ['overview'],
    panels: [
      healthPanel,
      buildRowPanel({ title: 'Requests, errors, latency (RED)' }),
      errorRatioPanel,
      requestRatePanel,
      latencyPanel,
      buildRowPanel({ title: 'Resources (USE)' }),
      memoryPanel,
    ],
  });

  // Step 4 — self-check. The recipe's defaults are chosen so this is clean.
  const sg = styleGuide();
  const lint = lintDashboard(dashboard as unknown as Record<string, unknown>, sg);

  return { metrics, dashboard, styleGuide: sg, lint };
}
