import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildDashboard } from '../assets/dashboard.js';
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
        'Build a Grafana dashboard from minimal inputs. Returns the ' +
        "dashboard as JSON suitable for posting to Grafana's HTTP API " +
        'or writing to a provisioning file.',
      inputSchema: {
        title: z.string().describe('The dashboard title shown in Grafana.'),
      },
    },
    ({ title }) => {
      const dashboard = buildDashboard({ title });
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
