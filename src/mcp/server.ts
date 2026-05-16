import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildDashboard, type PanelInput } from '../assets/dashboard.js';
import { inspectDashboard } from '../assets/inspect.js';
import { buildTimeseriesPanel } from '../assets/panel.js';
import { parsePrometheusText } from '../ingest/prometheus.js';

const PACKAGE_NAME = 'mcp-grafana';
const PACKAGE_VERSION = '0.0.0';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: PACKAGE_NAME, version: PACKAGE_VERSION });

  server.registerTool(
    'grafana_dashboard_build',
    {
      description:
        'Build a Grafana dashboard from a title and an optional array of ' +
        'panel JSON objects (typically the output of ' +
        'grafana_timeseries_panel_build). Returns the dashboard as JSON ' +
        "suitable for posting to Grafana's HTTP API or writing to a " +
        'provisioning file.',
      inputSchema: {
        title: z.string().describe('The dashboard title shown in Grafana.'),
        panels: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'Optional array of panel JSON objects to include in the ' +
              'dashboard. Each element is a panel as produced by a panel-build ' +
              'tool (e.g., grafana_timeseries_panel_build). Layout (gridPos) ' +
              'is assigned by the dashboard builder if not present on the panel.',
          ),
      },
    },
    ({ title, panels }) => {
      const dashboard = buildDashboard({
        title,
        panels: panels as PanelInput[] | undefined,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(dashboard) }],
      };
    },
  );

  server.registerTool(
    'grafana_timeseries_panel_build',
    {
      description:
        'Build a Grafana timeseries panel from a title and one or more ' +
        'Prometheus query targets. Returns the panel as JSON suitable for ' +
        'inclusion in a Grafana dashboard. Supports multiple targets on the ' +
        'same chart (e.g., rate alongside 5xx error rate).',
      inputSchema: {
        title: z.string().describe('The panel title shown above the chart.'),
        description: z
          .string()
          .optional()
          .describe('Panel description shown in the info tooltip; use the metric HELP text where applicable.'),
        unit: z
          .string()
          .optional()
          .describe(
            'Display unit code (e.g., "reqps", "bytes", "seconds", "percentunit"). ' +
              'See Grafana unit-format docs for the full list.',
          ),
        targets: z
          .array(
            z.object({
              expr: z.string().describe('A PromQL expression.'),
              legendFormat: z
                .string()
                .optional()
                .describe('Legend format string; can reference {{label}} placeholders.'),
              refId: z
                .string()
                .optional()
                .describe('Reference id (A, B, C, …) for cross-query references.'),
            }),
          )
          .min(1)
          .describe('One or more query targets to plot on the same chart.'),
      },
    },
    (input) => {
      const panel = buildTimeseriesPanel(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(panel) }],
      };
    },
  );

  server.registerTool(
    'grafana_dashboard_inspect',
    {
      description:
        'Inspect an existing Grafana dashboard JSON and return a structured ' +
        'view at one of three detail levels. Use this before adding panels, ' +
        'auditing, or cloning a dashboard so the LLM does not have to parse ' +
        'the raw dashboard JSON itself.\n\n' +
        '- detail="summary" (default): bounded headline view (title, uid, ' +
        'panel count, variable names, datasource refs, layout bounds, ' +
        'count of panels missing a description, top naming-prefix patterns). ' +
        'Safe for arbitrarily large dashboards.\n' +
        '- detail="panels": per-panel rows (id, title, type, description, ' +
        'unit, gridPos, datasource, target count). Use for audit workflows.\n' +
        '- detail="conventions": style/layout patterns (panel-size histogram, ' +
        'top units, top panel types, variables, row count). Use when ' +
        'building a new dashboard meant to match an existing one.',
      inputSchema: {
        dashboard: z
          .record(z.string(), z.unknown())
          .describe(
            'Grafana dashboard JSON object, e.g. loaded from a .json file or ' +
              "exported from Grafana's share/export menu.",
          ),
        detail: z
          .enum(['summary', 'panels', 'conventions'])
          .optional()
          .describe(
            'Which detail level to return. Defaults to "summary" (bounded). ' +
              'Pick "panels" for audit workflows; "conventions" for cloning style.',
          ),
      },
    },
    ({ dashboard, detail }) => {
      const result = inspectDashboard(dashboard, detail !== undefined ? { detail } : {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'prometheus_metric_parse',
    {
      description:
        'Parse Prometheus exposition-format text (the body of a /metrics ' +
        'endpoint) into structured metric definitions. Each result has the ' +
        'metric name, type (counter / gauge / histogram / summary / untyped), ' +
        'optional HELP text, a labels map (label name → distinct sorted values ' +
        'seen across samples), and the raw samples. Useful for an LLM to reason ' +
        'about a service\'s metrics before composing a Grafana dashboard.',
      inputSchema: {
        text: z
          .string()
          .describe(
            'Prometheus exposition-format text, typically the response body ' +
              'from a /metrics endpoint.',
          ),
      },
    },
    ({ text }) => {
      const metrics = parsePrometheusText(text);
      return {
        content: [{ type: 'text', text: JSON.stringify(metrics) }],
      };
    },
  );

  return server;
}
