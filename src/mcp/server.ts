import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildDashboard, type PanelInput } from '../assets/dashboard.js';
import { insertPanel, type InsertPosition } from '../assets/insert.js';
import { inspectDashboard } from '../assets/inspect.js';
import { buildTimeseriesPanel } from '../assets/panel.js';
import { validateDashboard, validatePanel } from '../assets/validate.js';
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
    'grafana_dashboard_validate',
    {
      description:
        'Validate a Grafana dashboard JSON before writing it out or posting ' +
        'it to Grafana. Checks required fields (dashboard.title; per-panel ' +
        'id; gridPos well-formedness), panel id uniqueness across all panels ' +
        '(including row-nested), and that variable references in panel ' +
        'queries and datasource refs resolve against the dashboard\'s ' +
        'declared templating variables (Grafana built-ins like ' +
        '$__rate_interval are allowed). Returns ' +
        '{ valid: boolean, errors: [{ path, message }] }. The errors array ' +
        'is capped at 100 entries with truncated:true if exceeded; even ' +
        'truncated, valid is still meaningful.',
      inputSchema: {
        dashboard: z
          .record(z.string(), z.unknown())
          .describe('Grafana dashboard JSON object to validate.'),
      },
    },
    ({ dashboard }) => {
      const result = validateDashboard(dashboard);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'grafana_panel_validate',
    {
      description:
        'Validate a single Grafana panel JSON. Without dashboard context, ' +
        'runs schema checks only (id required, gridPos well-formed). With ' +
        'optional dashboard context, also checks that variable references ' +
        'in queries and datasource refs resolve against the dashboard\'s ' +
        'declared templating variables. Use this before inserting a newly ' +
        'built panel into an existing dashboard. Returns ' +
        '{ valid: boolean, errors: [{ path, message }] } with paths rooted ' +
        'at "$" (the panel itself).',
      inputSchema: {
        panel: z
          .record(z.string(), z.unknown())
          .describe('Grafana panel JSON to validate.'),
        dashboard: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Optional dashboard JSON for reference-integrity checks. When ' +
              'provided, the panel\'s variable refs are checked against this ' +
              "dashboard's templating.list. Omit to do schema-only validation.",
          ),
      },
    },
    ({ panel, dashboard }) => {
      const result = validatePanel(panel, dashboard);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'grafana_dashboard_panel_insert',
    {
      description:
        'Insert a panel into an existing Grafana dashboard at a chosen ' +
        'position. Use this after building a panel via ' +
        'grafana_timeseries_panel_build to add it to a dashboard loaded ' +
        'from JSON — without reconstructing the whole dashboard.\n\n' +
        'Position modes:\n' +
        '- {mode:"append"} (default): place at the bottom of the dashboard, ' +
        'top-level. Auto-computes gridPos from existing panels\' bottom.\n' +
        '- {mode:"gridPos", x, y, w, h}: explicit placement, honored ' +
        'verbatim.\n' +
        '- {mode:"after", panelId: N}: directly below the named panel, in ' +
        'its container (top-level OR inside a row.panels[]).\n' +
        '- {mode:"inRow", rowId: N}: make the panel a child of the named ' +
        'row. Handles both legacy (row.panels[]) and modern (siblings ' +
        'ordered in the top-level panels[] array) row formats.\n\n' +
        'Returns { dashboard?, errors[] }. On success, dashboard is the ' +
        'modified copy (original not mutated) and errors is empty. On ' +
        'failure (unknown panelId/rowId, non-row in inRow mode, etc.), ' +
        'dashboard is absent and errors contains diagnostics. If the ' +
        'incoming panel has no id, the next free id (max + 1 across the ' +
        'full panel tree) is assigned.',
      inputSchema: {
        dashboard: z
          .record(z.string(), z.unknown())
          .describe('The dashboard JSON to insert into. Not mutated.'),
        panel: z
          .record(z.string(), z.unknown())
          .describe(
            'The panel JSON to insert. Typically the output of a panel-build ' +
              "tool. If it has no id, one is auto-assigned. Its gridPos's w/h " +
              'are honored when present; x/y are recomputed unless mode="gridPos".',
          ),
        position: z
          .discriminatedUnion('mode', [
            z.object({ mode: z.literal('append') }),
            z.object({
              mode: z.literal('gridPos'),
              x: z.number(),
              y: z.number(),
              w: z.number(),
              h: z.number(),
            }),
            z.object({
              mode: z.literal('after'),
              panelId: z.union([z.number(), z.string()]),
            }),
            z.object({
              mode: z.literal('inRow'),
              rowId: z.union([z.number(), z.string()]),
            }),
          ])
          .optional()
          .describe(
            'Where to place the panel. Defaults to {mode:"append"}. See the ' +
              'tool description for what each mode does.',
          ),
      },
    },
    ({ dashboard, panel, position }) => {
      const result = insertPanel(dashboard, panel, position as InsertPosition | undefined);
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
