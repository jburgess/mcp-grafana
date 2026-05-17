import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildDashboard, type PanelInput } from '../assets/dashboard.js';
import { insertPanel, type InsertPosition } from '../assets/insert.js';
import { inspectDashboard } from '../assets/inspect.js';
import { movePanel } from '../assets/move.js';
import {
  buildRowPanel,
  buildStatPanel,
  buildStateTimelinePanel,
  buildTablePanel,
  buildTimeseriesPanel,
} from '../assets/panel.js';
import { findPanels } from '../assets/find.js';
import { lintDashboard, lintPanel } from '../assets/lint.js';
import { removePanel } from '../assets/remove.js';
import { renameVariable } from '../assets/rename.js';
import { updatePanel } from '../assets/update.js';
import { validateDashboard, validatePanel } from '../assets/validate.js';
import { parsePrometheusText } from '../ingest/prometheus.js';
import { DashboardRegistry } from './registry.js';
import { registerMarkdownResources } from './resources.js';

const PACKAGE_NAME = 'mcp-grafana';

// Read the version from package.json at module load. Layout invariant:
// this file is at src/mcp/server.ts in source and dist/mcp/server.js after
// build, so `../../package.json` resolves to the project (or installed
// package) root in both cases. Avoids the historical bug of a hardcoded
// '0.0.0' drifting from the real version.
const PACKAGE_VERSION = (() => {
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
})();

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: PACKAGE_NAME, version: PACKAGE_VERSION });

  // Per-session dashboard resource registry — see src/mcp/registry.ts.
  // One Map per McpServer instance, and createMcpServer is called per
  // session, so the registry's per-session contract is automatic; no
  // teardown hook needed. Used by the dashboard_load / _export / _close
  // tools (issue #65 item 1) and, later, by the registry-aware variants
  // of the read and write tools (items 2 and 3).
  const registry = new DashboardRegistry();

  server.registerTool(
    'grafana_dashboard_load',
    {
      description:
        'Read a Grafana dashboard JSON file from disk, parse it, and ' +
        'register it in the session-scoped dashboard registry. Returns ' +
        '`{ uri }` — a `mcp://grafana/session/dashboard/<n>` URI you can ' +
        'pass to read/write tools (once they accept it) instead of the ' +
        'full dashboard JSON. The JSON does NOT enter the LLM context; ' +
        'only the URI does.\n\n' +
        'Use this for any audit / build workflow that touches a large ' +
        'dashboard — a 15k-line node-exporter dashboard is ~50–70k ' +
        'tokens, and inline-passing it through every tool call compounds ' +
        'that cost. The registry keeps one parsed copy in server memory.\n\n' +
        'Lifecycle: the registry lives as long as the MCP session — fresh ' +
        'on session start, gone when the session ends. Call ' +
        'grafana_dashboard_close to free a slot early. To get the JSON ' +
        'back into context (e.g. to hand to the host\'s Write tool), use ' +
        'grafana_dashboard_export.',
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe(
            'Filesystem path to a JSON dashboard file. Absolute paths ' +
              'honoured verbatim; relative paths resolved against the ' +
              "server's current working directory.",
          ),
      },
    },
    ({ path }) => {
      const result = registry.loadFromPath(path);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ errors: [result.error] }) }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ uri: result.uri }) }],
      };
    },
  );

  server.registerTool(
    'grafana_dashboard_export',
    {
      description:
        'Retrieve the dashboard JSON registered at a session URI. ' +
        'Returns the full dashboard object — use this only when you need ' +
        'to hand the JSON back to the caller (e.g. to write it to disk ' +
        "via the host's Write tool, or to POST to Grafana's HTTP API). " +
        'Per AGENTS.md §1.8 this server never writes to disk.\n\n' +
        'For inspection without pulling the full JSON, use ' +
        'grafana_dashboard_inspect — it returns bounded structured views ' +
        'at three detail levels and is what most workflow steps want.\n\n' +
        'The returned dashboard is a deep clone of the registry copy; ' +
        'mutating it has no effect on the registry. To modify the ' +
        'registered dashboard in place, use the write tools with a ' +
        '`dashboardUri` argument (added in subsequent PRs of #65).',
      inputSchema: {
        uri: z
          .string()
          .min(1)
          .describe('A registry URI returned by grafana_dashboard_load.'),
      },
    },
    ({ uri }) => {
      const result = registry.export(uri);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ errors: [result.error] }) }],
        };
      }
      return {
        content: [
          { type: 'text', text: JSON.stringify({ dashboard: result.dashboard }) },
        ],
      };
    },
  );

  server.registerTool(
    'grafana_dashboard_close',
    {
      description:
        'Remove the dashboard registered at the given session URI, ' +
        'freeing the slot before the session ends. Idempotent: closing ' +
        'an unknown or already-closed URI returns `removed: false` ' +
        'rather than erroring. Use this for long-running sessions that ' +
        'load many dashboards and want to bound memory. Sessions that ' +
        'load a few dashboards and exit do not need to call this — the ' +
        'whole registry goes away when the session ends.',
      inputSchema: {
        uri: z
          .string()
          .min(1)
          .describe('A registry URI returned by grafana_dashboard_load.'),
      },
    },
    ({ uri }) => {
      const result = registry.close(uri);
      if (!result.ok) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ errors: [result.error] }) }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ removed: result.removed }) }],
      };
    },
  );

  server.registerTool(
    'grafana_dashboard_build',
    {
      description:
        'Build a Grafana dashboard from a title and an optional array of ' +
        'panel JSON objects (typically the output of ' +
        'grafana_timeseries_panel_build). Returns the dashboard as JSON ' +
        "suitable for posting to Grafana's HTTP API or writing to a " +
        'provisioning file. The result passes grafana_dashboard_validate ' +
        'without further wiring.\n\n' +
        'Auto-id: panels missing a numeric `id` (or carrying `id: 0`, the ' +
        "Foundation SDK's default-init value) are assigned sequential " +
        'integer ids starting at `max(existing ids) + 1` (or 1 when no ' +
        'panel carries one). Legacy row-nested children (`row.panels[]`) ' +
        'are walked too, so a row whose children lack ids gets each child ' +
        "id'd without colliding with the row itself. Explicit numeric ids " +
        'are preserved. Non-numeric ids (e.g. `id: "foo"`) are not valid ' +
        "per Grafana's schema and are overwritten with a fresh integer " +
        'rather than passed through. Matches grafana_dashboard_panel_insert\'s ' +
        'id semantics. Pre-built panel JSON passed in is deep-cloned — ' +
        'the input objects are never mutated.',
      inputSchema: {
        title: z.string().describe('The dashboard title shown in Grafana.'),
        panels: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'Optional array of panel JSON objects to include in the ' +
              'dashboard. Each element is a panel as produced by a panel-build ' +
              'tool (e.g., grafana_timeseries_panel_build). Layout (gridPos) ' +
              'is assigned by the dashboard builder if not present on the panel; ' +
              'missing panel `id`s are auto-assigned (see tool description).',
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
        'grafana_dashboard_build or grafana_dashboard_panel_insert. ' +
        'Supports multiple targets on the same chart (e.g., rate alongside ' +
        '5xx error rate).\n\n' +
        'What the output INCLUDES (caller-supplied): title, optional ' +
        'description, optional unit, and one target per entry in `targets` ' +
        '(each with expr and optional legendFormat / refId). Plus SDK ' +
        "defaults: `type: 'timeseries'`, `transparent: false`, " +
        "`repeatDirection: 'h'` — all harmless to leave as-is.\n\n" +
        'What the output OMITS (and where to set each):\n' +
        '- `id` — auto-assigned by grafana_dashboard_build or ' +
        'grafana_dashboard_panel_insert (max(existing) + 1). Do NOT hand-set.\n' +
        '- `gridPos` — auto-assigned by grafana_dashboard_build; set ' +
        'explicitly via the `position` arg of grafana_dashboard_panel_insert ' +
        '(modes: append / gridPos / after / inRow).\n' +
        '- `datasource` (panel-level and per-target) — patch via ' +
        'grafana_dashboard_panel_update after the panel is in a dashboard. ' +
        'Without it Grafana will use the dashboard default; if there is no ' +
        'default it will not query anything.\n' +
        '- Legend (placement, displayMode, calcs) and tooltip — see the ' +
        'mcp://grafana/skills/grafana-style-guide.md resource for the ' +
        'convention (default: `placement: right`, `displayMode: table`, ' +
        '`calcs: [mean, lastNotNull, max]`); apply via ' +
        'grafana_dashboard_panel_update or surface gaps via grafana_panel_lint.',
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
    'grafana_row_panel_build',
    {
      description:
        'Build a Grafana row panel (`"type": "row"`) — the collapsible ' +
        'section header used to group panels into named segments. ' +
        'Returns the row panel as JSON suitable for the `panels` array of ' +
        'grafana_dashboard_build, or for grafana_dashboard_panel_insert.\n\n' +
        'Rows are structural — they carry no query targets and are not a ' +
        'data visualisation. Use this distinct from grafana_timeseries_panel_build ' +
        '(or other data-bearing panel builders) to produce the section ' +
        'headers in a multi-section dashboard. Using a timeseries panel as ' +
        'a stand-in produces wrong JSON and defeats Grafana\'s ' +
        'collapsible-section feature.\n\n' +
        'When passed to grafana_dashboard_build, the row is laid out as a ' +
        'full-width section header (24-cell wide, 1-cell tall), not a 12×8 ' +
        'grid cell. Panel `id` is auto-assigned by grafana_dashboard_build, ' +
        'same as for regular panels.',
      inputSchema: {
        title: z
          .string()
          .min(1)
          .describe('The row title shown on the section header. Must be non-empty.'),
        collapsed: z
          .boolean()
          .optional()
          .describe(
            'When true, the row starts collapsed (children hidden, click to ' +
              'expand). Omit for the SDK default (false / expanded).',
          ),
      },
    },
    (input) => {
      const row = buildRowPanel(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(row) }],
      };
    },
  );

  server.registerTool(
    'grafana_stat_panel_build',
    {
      description:
        'Build a Grafana stat panel (`"type": "stat"`) for single-value ' +
        'KPI displays — current error rate, SLO status, active alerts ' +
        'count. Returns the panel as JSON suitable for ' +
        'grafana_dashboard_build or grafana_dashboard_panel_insert.\n\n' +
        'Use this distinct from grafana_timeseries_panel_build for ' +
        'single-value reads: stat reduces a series to one number via ' +
        '`reduceOptions`, timeseries plots the whole series. The wrong ' +
        'choice produces a chart where a KPI was meant, or a number ' +
        'where a trend was meant.\n\n' +
        '`graphMode` defaults to `\'area\'` (filled sparkline behind the ' +
        'number). The default keeps every freshly-built stat panel ' +
        'compliant with the `panels.stat.requiresComparison` lint rule — ' +
        'a stat without a sparkline is the "aggregate ≠ summary" failure ' +
        'mode (a number with no trend context is a snapshot, not ' +
        'monitoring). Callers who genuinely want a bare KPI opt out ' +
        'explicitly via `graphMode: \'none\'` (the linter will then ' +
        'flag it; intended).',
      inputSchema: {
        title: z
          .string()
          .min(1)
          .describe('The panel title shown above the stat. Must be non-empty.'),
        description: z
          .string()
          .optional()
          .describe('Panel description shown in the info tooltip.'),
        unit: z
          .string()
          .optional()
          .describe(
            'Display unit code (e.g., "percentunit", "reqps", "bytes"). ' +
              'See Grafana unit-format docs for the full list.',
          ),
        graphMode: z
          .enum(['area', 'line', 'none'])
          .optional()
          .describe(
            'Sparkline mode behind the number. Defaults to "area" ' +
              '(filled sparkline). Pass "none" to drop the sparkline ' +
              'entirely — the panels.stat.requiresComparison lint rule ' +
              'will flag the result; that is intentional.',
          ),
        reduceCalc: z
          .string()
          .optional()
          .describe(
            'Reduction calculation applied to each series before display ' +
              '(e.g., "lastNotNull", "mean", "max"). Defaults to ' +
              '"lastNotNull" — the right choice for current-state KPI ' +
              'reads, and Grafana\'s own canonical stat-panel default. ' +
              'The SDK\'s raw default is `calcs: []` which renders no ' +
              'value, so the builder fills "lastNotNull" rather than ' +
              'producing a stat that shows nothing.',
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
          .describe(
            'One or more query targets. A single reduced expression is the ' +
              'common case; multi-target stat panels render only the first ' +
              "series's reduced value by default.",
          ),
      },
    },
    (input) => {
      const panel = buildStatPanel(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(panel) }],
      };
    },
  );

  server.registerTool(
    'grafana_table_panel_build',
    {
      description:
        'Build a Grafana table panel (`"type": "table"`) for ranked or ' +
        'enumerated data — top-N endpoints by latency, per-service ' +
        'error counts, service inventory. Returns the panel as JSON ' +
        'suitable for grafana_dashboard_build or ' +
        'grafana_dashboard_panel_insert.\n\n' +
        'Use this distinct from grafana_timeseries_panel_build (which ' +
        'plots series over time) and grafana_stat_panel_build (which ' +
        'reduces to a single value). The right table query usually ' +
        'returns one row per entity (instance, endpoint, service) — ' +
        'e.g. `topk(10, sum by (endpoint) (rate(http_requests_total[5m])))`.\n\n' +
        'Column-level configuration (sort, footer, cell display mode, ' +
        'per-column thresholds) is intentionally out of scope here — ' +
        'apply via grafana_dashboard_panel_update after the panel is ' +
        'in a dashboard, or shape the data via Grafana transformations.\n\n' +
        'The output omits `id`, `gridPos`, and `datasource` — same pattern ' +
        'as grafana_timeseries_panel_build. `id` and `gridPos` are ' +
        'auto-assigned by grafana_dashboard_build / ' +
        'grafana_dashboard_panel_insert; `datasource` is patched via ' +
        'grafana_dashboard_panel_update after the panel is placed.',
      inputSchema: {
        title: z
          .string()
          .min(1)
          .describe('The panel title shown above the table. Must be non-empty.'),
        description: z
          .string()
          .optional()
          .describe('Panel description shown in the info tooltip.'),
        unit: z
          .string()
          .optional()
          .describe(
            'Display unit code for numeric columns (e.g., "short", ' +
              '"reqps", "bytes"). See Grafana unit-format docs.',
          ),
        filterable: z
          .boolean()
          .optional()
          .describe(
            'When true, enables per-column filter UI in the table ' +
              'header. Useful for service-inventory or top-N tables. ' +
              'Omit to leave at the SDK default (no filter UI).',
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
          .describe(
            'One or more query targets — typically a single ranked or ' +
              'enumerated expression returning one row per entity.',
          ),
      },
    },
    (input) => {
      const panel = buildTablePanel(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(panel) }],
      };
    },
  );

  server.registerTool(
    'grafana_state_timeline_panel_build',
    {
      description:
        'Build a Grafana state-timeline panel (`"type": "state-timeline"`) ' +
        'for categorical health / status signals across a time window — ' +
        'UP/DOWN/DEGRADED, OK/WARNING/CRITICAL. Shows discrete state ' +
        'transitions as coloured bands.\n\n' +
        'Use this distinct from grafana_timeseries_panel_build for ' +
        'categorical signals: timeseries applies numerical interpolation ' +
        'and continuous axes to data that is inherently discrete and ' +
        'non-numerical — a fidelity loss. State-timeline is the correct ' +
        'visualisation for the discrete case (and is also distinct from ' +
        'a status-history grid, which is a discrete-time matrix and is ' +
        'out of scope for this builder).\n\n' +
        'The output omits `id`, `gridPos`, and `datasource` — same pattern ' +
        'as the other panel builders. `id` and `gridPos` are auto-assigned ' +
        'by grafana_dashboard_build / grafana_dashboard_panel_insert; ' +
        '`datasource` is patched via grafana_dashboard_panel_update.',
      inputSchema: {
        title: z
          .string()
          .min(1)
          .describe('The panel title shown above the timeline. Must be non-empty.'),
        description: z
          .string()
          .optional()
          .describe('Panel description shown in the info tooltip.'),
        mergeValues: z
          .boolean()
          .optional()
          .describe(
            'When true, contiguous samples carrying the same value are ' +
              'merged into one band — useful for sparse-event status ' +
              'signals (one wide UP segment, not 30 one-minute UP segments).',
          ),
        rowHeight: z
          .number()
          .optional()
          .describe(
            'Row height as a fraction of the lane (0..1). Smaller values ' +
              'stack more service rows in less vertical space; useful for ' +
              'overview dashboards with many services.',
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
          .describe(
            'One or more query targets — typically a categorical status ' +
              'signal such as `up{job="..."}` or a derived health expression.',
          ),
      },
    },
    (input) => {
      const panel = buildStateTimelinePanel(input);
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
        'Empty-string descriptions count as missing. ' +
        'Safe for arbitrarily large dashboards.\n' +
        '- detail="panels": per-panel rows (id, title, type, description, ' +
        'unit, gridPos, datasource, target count, and each panel\'s targets ' +
        'with expr/legendFormat/refId/hide; expr is capped at 512 chars and ' +
        'tagged with truncated:true when cut — detect via the truncated flag, ' +
        'not the trailing "…", which can occur in legitimate text. ' +
        'Truncation is lossy: do not echo a truncated expr back into a write ' +
        'tool without re-reading the source dashboard. hide:true marks ' +
        'temporarily-disabled targets — useful so audit consumers do not ' +
        'conflate hidden queries with active ones. Use for audit workflows.\n' +
        '- detail="conventions": style/layout patterns (panel-size histogram, ' +
        'top units, top panel types, variables, row count, plus stat-panel ' +
        'graphMode/colorMode histograms so KPI-with-trend dashboards aren\'t ' +
        'mistaken for flat KPI dashboards). Use when building a new ' +
        'dashboard meant to match an existing one.',
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
    'grafana_dashboard_panel_update',
    {
      description:
        'Apply a JSON Merge Patch (RFC 7396) to a specific panel in a ' +
        'dashboard, identified by its id. Use this to fix small things ' +
        'on a single panel — add a description, change a unit, drop a ' +
        'legend format — without rebuilding the whole panel from scratch ' +
        '(which would lose fields the panel-build tools do not surface, ' +
        'like color, thresholds, overrides).\n\n' +
        'Patch semantics (RFC 7396):\n' +
        '- patch fields with values OVERWRITE the panel\'s fields.\n' +
        '- null in the patch CLEARS the corresponding field.\n' +
        '- nested objects DEEP-MERGE recursively.\n' +
        '- arrays REPLACE wholesale (no element-wise merge).\n\n' +
        'Targets row-nested panels too — the panelId lookup walks ' +
        'row.panels[]. Updating a row panel itself (by its id) works the ' +
        'same way. Returns { dashboard?, errors[] }: dashboard is the ' +
        'modified copy (original not mutated) on success, errors is ' +
        'populated on failure (unknown panelId, non-object patch, etc.).',
      inputSchema: {
        dashboard: z
          .record(z.string(), z.unknown())
          .describe('The dashboard JSON containing the panel to patch. Not mutated.'),
        panelId: z
          .union([z.number(), z.string()])
          .describe(
            'The id of the panel to patch. Looked up across top-level ' +
              'panels and row-nested panels.',
          ),
        patch: z
          .record(z.string(), z.unknown())
          .describe(
            'JSON Merge Patch (RFC 7396) object. Top-level must be an ' +
              'object. See the tool description for the merge rules.',
          ),
      },
    },
    ({ dashboard, panelId, patch }) => {
      const result = updatePanel(dashboard, panelId, patch);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'grafana_dashboard_panel_move',
    {
      description:
        'Move a panel (or row, since a row IS a panel) within a dashboard ' +
        'to a new position. Same `to` shape as grafana_dashboard_panel_insert ' +
        '(append / gridPos / after / inRow), so the LLM uses one positional ' +
        'API for both insert and move.\n\n' +
        'Special case for rows: when a row in modern format (no nested ' +
        'row.panels[]) is moved, its trailing siblings in the top-level ' +
        'array — the panels that implicitly belong to it by ordering — ' +
        'are carried along. Legacy rows always carry their nested children. ' +
        'You cannot move a row INTO another row (rows do not nest); the ' +
        'tool returns an error if `to.mode` is "inRow" for a row.\n\n' +
        'Returns { dashboard?, errors[] }: dashboard is the modified copy ' +
        '(original not mutated) on success, errors is populated on failure ' +
        '(unknown panelId, illegal target like row-in-row).',
      inputSchema: {
        dashboard: z
          .record(z.string(), z.unknown())
          .describe('The dashboard JSON containing the panel to move. Not mutated.'),
        panelId: z
          .union([z.number(), z.string()])
          .describe(
            'The id of the panel (or row) to move. Looked up across ' +
              'top-level and row-nested panels.',
          ),
        to: z
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
          .describe(
            'Where to place the panel. Same shape as ' +
              'grafana_dashboard_panel_insert\'s position arg.',
          ),
      },
    },
    ({ dashboard, panelId, to }) => {
      const result = movePanel(dashboard, panelId, to as InsertPosition);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'grafana_dashboard_panel_remove',
    {
      description:
        'Remove a panel from a dashboard by id. Behaviors by panel kind:\n' +
        '- Regular panel (top-level or row-nested): removed from its container.\n' +
        '- Legacy row (has `panels[]`): row AND its nested children are removed ' +
        'together (children only existed inside the row).\n' +
        '- Modern row (no `panels[]`): the row is removed; trailing siblings are ' +
        'PROMOTED to no-row status — they keep their gridPos but lose their ' +
        'implicit row affiliation. Matches "delete the section header but ' +
        'keep the charts under it" intent.\n\n' +
        'Returns { dashboard?, errors[] }: dashboard is the modified copy ' +
        '(original not mutated) on success, errors is populated on failure ' +
        '(unknown panelId).',
      inputSchema: {
        dashboard: z
          .record(z.string(), z.unknown())
          .describe('The dashboard JSON containing the panel to remove. Not mutated.'),
        panelId: z
          .union([z.number(), z.string()])
          .describe('The id of the panel (or row) to remove.'),
      },
    },
    ({ dashboard, panelId }) => {
      const result = removePanel(dashboard, panelId);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'grafana_dashboard_variable_rename',
    {
      description:
        'Atomically rename a templating variable across a Grafana dashboard. ' +
        'Updates the variable definition itself (templating.list[i].name, and ' +
        'its `label` when label exactly matches oldName), every reference in ' +
        'other variables\' query/definition fields (including nested ' +
        'query.datasource.uid and current.text/value chained defaults), every ' +
        'panel target (expr/query/rawQuery), datasource references (string ' +
        'and object.uid forms — both panel-level and per-target), panel and ' +
        'row titles and descriptions, and the panel/row `repeat` field. Walks ' +
        'legacy row.panels[] recursively.\n\n' +
        'Why this exists: shell-out renames ("iterate variables, sed every ' +
        'panel") routinely mangle the `\\$` escape and silently break dozens ' +
        'of expressions — only validation later catches the dangling refs. ' +
        'An atomic primitive sidesteps the entire class of bug.\n\n' +
        'All four Grafana interpolation syntaxes are recognized and the form ' +
        'is preserved: $name → $new, ${name} → ${new}, ${name:csv} → ' +
        '${new:csv}, [[name]] → [[new]], [[name:csv]] → [[new:csv]]. ' +
        'Word-boundary aware: $foo does NOT match inside $foobar.\n\n' +
        'NOT covered (deferred): dashboard.annotations, dashboard.links, ' +
        'panel.links, templating.list[i].regex / .options[], ' +
        'panel.transformations, and panel.fieldConfig.overrides. Less common ' +
        'in real dashboards; run grafana_dashboard_validate after the rename ' +
        'to catch dangling refs in the covered query/datasource fields.\n\n' +
        'Returns { dashboard?, errors[], rewrites, locations[] }. On success, ' +
        'dashboard is the modified deep clone (original not mutated), rewrites ' +
        'is the count of textual changes, and locations is the JSONPath list ' +
        'of every change site in walk order (templating first, then panels in ' +
        'array order). On failure (unknown oldName, newName collides with an ' +
        'existing variable, newName not a valid Grafana variable name), ' +
        'dashboard is absent and errors is populated. Renaming to the same ' +
        'name is a no-op success with rewrites=0.',
      inputSchema: {
        dashboard: z
          .record(z.string(), z.unknown())
          .describe('The dashboard JSON containing the variable to rename. Not mutated.'),
        oldName: z
          .string()
          .describe(
            'The current name of the templating variable. Must exist in ' +
              'templating.list[].name; otherwise an error is returned.',
          ),
        newName: z
          .string()
          .describe(
            'The new name for the variable. Must match Grafana\'s variable ' +
              'naming rule [a-zA-Z_][a-zA-Z0-9_]* and must not collide with ' +
              'an existing variable name in templating.list.',
          ),
      },
    },
    ({ dashboard, oldName, newName }) => {
      const result = renameVariable(dashboard, oldName, newName);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'grafana_panel_lint',
    {
      description:
        'Lint a single Grafana panel JSON against a style guide and return ' +
        'style issues with `warn` or `info` severity (never `error` — ' +
        'schema-validity errors are grafana_panel_validate\'s job).\n\n' +
        'The styleGuide input is either a full GrafanaStyleGuide umbrella ' +
        '({ $schema?, panels: { timeseries?, units?, descriptions? } }) or ' +
        'the panels slice directly ({ timeseries?, units?, descriptions? }) ' +
        '— the tool unwraps the umbrella by extracting `.panels` when ' +
        'that key is present. There is no built-in default; opinion lives ' +
        'in skills/grafana-style-guide.md (served as MCP resource ' +
        'mcp://grafana/skills/grafana-style-guide.md) and the caller passes ' +
        'it in.\n\n' +
        'Currently fires: panels.units.allowList, panels.units.deny, ' +
        'panels.descriptions.required (empty-string description counts as ' +
        'missing), panels.timeseries.legend.placement / displayMode / calcs ' +
        '(calcs accepts `string[]` for set-equal match — order-insensitive, ' +
        'the common case — or `{ expected: [...], match: "exact" | "set" }` ' +
        'to opt into order-sensitivity), panels.stat.requiresComparison ' +
        '(fires on stat panels with `options.graphMode === "none"` or absent — ' +
        'the sparkline is the deterministic comparison signal). Rule ids ' +
        'are JSONPath-style dotted paths into the umbrella; the rule ' +
        'namespace is additive — future panel types (table, gauge, heatmap) ' +
        'and future cross-type families grow by addition.\n\n' +
        'Malformed styleGuide inputs (non-object, both umbrella and slice ' +
        'keys at once, `panels` set to a non-object) produce a single ' +
        'issue with ruleId `panels.shape` and severity warn rather than ' +
        'silently returning no issues — so a broken guide is visible, not ' +
        'invisible.\n\n' +
        'Returns { issues: [{ path, ruleId, severity, message }], truncated? }. ' +
        '`path` is a JSONPath into the panel (e.g. ' +
        '`$.fieldConfig.defaults.unit`), `ruleId` is the dotted path into ' +
        'the umbrella StyleGuide (e.g. `panels.units.allowList`). On ' +
        'lint of a standalone panel, issues do not carry `panelId` / ' +
        '`panelTitle` (the caller already knows which panel they passed). ' +
        'When called via `grafana_dashboard_lint` the per-panel-rule ' +
        'issues do carry both fields. issues[] is capped at 100; ' +
        '`truncated: true` indicates more existed.\n\n' +
        'This tool does NOT auto-apply to panel-build output and does NOT ' +
        'reject panels that violate the guide. It reports; the caller (or ' +
        'their LLM) decides.',
      inputSchema: {
        panel: z
          .record(z.string(), z.unknown())
          .describe('The Grafana panel JSON to lint.'),
        styleGuide: z
          .record(z.string(), z.unknown())
          .describe(
            'Either a GrafanaStyleGuide umbrella ({ panels: { ... } }) or ' +
              'the PanelStyleGuide slice directly ({ timeseries?, units?, ' +
              'descriptions? }). When `panels` is present at the top level, ' +
              'the tool unwraps to that slice.',
          ),
      },
    },
    ({ panel, styleGuide }) => {
      // `lintPanel` does its own umbrella-vs-slice unwrap, malformed-input
      // detection, and edge-case handling — see resolveSlice in lint.ts.
      // The tool only forwards the raw inputs.
      const result = lintPanel(panel, styleGuide);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'grafana_dashboard_lint',
    {
      description:
        'Lint a Grafana dashboard against a style guide. Thin aggregator ' +
        'over grafana_panel_lint — walks every panel (top-level and ' +
        'legacy row-nested), runs the panel-slice rules against each, ' +
        'and adds dashboard-level rules that can\'t be checked per-panel.\n\n' +
        'Dashboard-level rules currently surfaced (all configurable in ' +
        'the GrafanaStyleGuide\'s `dashboards` section):\n' +
        '- dashboards.panels.duplicateTitles — fires for any non-row panel ' +
        'title shared by more than one panel. Rows are excluded — section ' +
        'markers often share titles legitimately across a dashboard. ' +
        'Accepts `true`, `false`, or `{ except: ["Title", ...] }` to exempt ' +
        'intentional duplicates (e.g. a KPI stat sharing a title with its ' +
        'timeseries trend).\n' +
        '- dashboards.variables.hiddenButReferenced — fires when a templating ' +
        'variable with `hide: 2` (both label and value hidden) is ' +
        'interpolated in a panel or row title. Renders without context — ' +
        'the viewer sees the value with no label.\n' +
        '- dashboards.variables.emptyDefault — fires when a templating ' +
        'variable\'s `current.value` is absent or empty string. Panels ' +
        'using it may render with no selection on first load.\n' +
        '- dashboards.panels.maxRepeat — fires when a `repeat by ' +
        '$variable` panel\'s variable cardinality exceeds the configured ' +
        'threshold. Accepts `number` or `{ max: number }`. Mitigates the ' +
        'per-device-page anti-pattern (200 panels per row, one per device). ' +
        'Default threshold lives in the skill prose only (~10) per §1.8.\n' +
        '- dashboards.links.preservesVariables — fires when an internal ' +
        'dashboard-to-dashboard link (`/d/`, `/dashboard/` paths) drops ' +
        'EVERY referenced templating variable. Partial drops (per-pod → ' +
        'per-cluster drill-up) are intentional and not flagged.\n\n' +
        'Issue paths are rebased onto the dashboard\'s panel-index shape ' +
        '(`panels[N].fieldConfig.defaults.unit`) so consumers can group ' +
        'issues by panel. Panel-scoped findings also carry `panelId` ' +
        'and `panelTitle` (when set) so callers can act on them directly ' +
        'via panel_update / panel_find / inspect — every other tool ' +
        'keys by id, not by JSON path. Dashboard-scoped findings ' +
        '(`dashboards.*` rules) omit those fields. Panel-level issues ' +
        'come first in the list, then dashboard-level issues. ' +
        'Heuristic / taste-laden rules (title-query mismatch, naming ' +
        'inconsistency, unit-suggestion heuristics) live in the ' +
        'skill\'s prose rather than this tool — see ' +
        'mcp://grafana/skills/grafana-style-guide.md.\n\n' +
        'Returns the same { issues, truncated? } shape as ' +
        'grafana_panel_lint. When `truncated: true`, more than 100 ' +
        'issues existed; fix the most common rule violations first to ' +
        'clear the cap, or re-run on a subset of panels by first ' +
        'calling grafana_dashboard_inspect detail:"panels" and ' +
        'lint-ing each panel via grafana_panel_lint. styleGuide ' +
        'accepts the umbrella ({ panels: {...}, dashboards: {...} }) ' +
        'or the panel slice directly (in which case dashboard-level ' +
        'rules can\'t fire).',
      inputSchema: {
        dashboard: z
          .record(z.string(), z.unknown())
          .describe('The Grafana dashboard JSON to lint.'),
        styleGuide: z
          .record(z.string(), z.unknown())
          .describe(
            'GrafanaStyleGuide umbrella ({ panels?, dashboards? }) or ' +
              'PanelStyleGuide slice. Dashboard-level rules only fire when ' +
              'the umbrella form is used.',
          ),
      },
    },
    ({ dashboard, styleGuide }) => {
      const result = lintDashboard(dashboard, styleGuide);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.registerTool(
    'grafana_dashboard_panel_find',
    {
      description:
        'Find panel ids in a dashboard matching a closed-set filter. ' +
        'Typical use: precursor to a bulk operation — list every ' +
        'timeseries panel with unit "short" whose query uses rate(), ' +
        'then pipe the ids into a write tool.\n\n' +
        'Filter fields (AND semantics; all supplied fields must match):\n' +
        '- type: exact match on panel.type (timeseries, stat, row, etc.)\n' +
        '- unit: exact match on panel.fieldConfig.defaults.unit\n' +
        '- hasUnit: when true, panel has a non-empty unit; when false, ' +
        'panel has none (null / undefined / empty-string all count as ' +
        'missing). Row panels excluded entirely. Use this when the ' +
        'audit pattern needs "panels with no unit set" — the `unit` ' +
        'field only does exact-string match.\n' +
        '- hasDescription: when true, panel has a non-empty description; ' +
        'when false, panel has none (empty-string counts as missing, ' +
        'matching grafana_dashboard_inspect and grafana_panel_lint). ' +
        'Row panels are excluded entirely from this filter.\n' +
        '- queryMatches: JavaScript regex pattern (as a string). At ' +
        'least one of the panel\'s targets[].expr / .query / .rawQuery ' +
        'must match. Pattern LENGTH is capped at 200 chars (not regex ' +
        'complexity — short pathological patterns like "^(a+)+$" can ' +
        'still backtrack catastrophically; avoid nested quantifiers). ' +
        'Invalid regex syntax also returns an error.\n\n' +
        'Backslash-escape tip for JSON callers: a regex like rate\\( ' +
        'must be JSON-encoded as "queryMatches": "rate\\\\(" (two ' +
        'backslashes in the JSON string land as one in the compiled ' +
        'regex). Forgetting the double-escape returns zero matches.\n\n' +
        'Empty filter ({}) matches every panel. Unrecognised filter ' +
        'keys are rejected with a validation error (rather than ' +
        'silently ignored) — typo of queryMatches as "matches" would ' +
        'otherwise return "matches every panel" with no warning. ' +
        'Results are returned in dashboard walk order (top-level then ' +
        'legacy row.panels[] nested) so consumers can rely on stable ' +
        'ordering. Panels without an id are skipped — callers can\'t ' +
        'reference them downstream.\n\n' +
        'Returns { panelIds: (number|string)[], errors: [{path, message}] }. ' +
        'On any error (malformed dashboard, malformed regex, regex too ' +
        'long), panelIds is empty and errors carries the diagnostic.',
      inputSchema: {
        dashboard: z
          .record(z.string(), z.unknown())
          .describe('The Grafana dashboard JSON to search.'),
        // .strict() rejects unrecognised keys at the MCP boundary so
        // typos (e.g. `matches:` instead of `queryMatches:`) error
        // rather than silently return "matches every panel." This was
        // the original motivation for choosing a closed DSL.
        //
        // Drift discipline: this Zod schema, `ALLOWED_FILTER_KEYS` in
        // `src/assets/find.ts`, and the `PanelsFindFilter` interface
        // must be kept in lock-step. When adding a key, update all
        // three at once (and the tool description's filter-fields
        // bullet list above).
        filter: z
          .object({
            type: z.string().optional(),
            unit: z.string().optional(),
            hasUnit: z.boolean().optional(),
            hasDescription: z.boolean().optional(),
            queryMatches: z.string().optional(),
          })
          .strict()
          .describe(
            'Closed-set filter: { type?, unit?, hasUnit?, ' +
              'hasDescription?, queryMatches? }. Unrecognised keys error ' +
              'at the boundary. Empty object matches all panels.',
          ),
      },
    },
    ({ dashboard, filter }) => {
      // Zod's `.strict().optional()` shape produces fields whose
      // values are `T | undefined`, but `PanelsFindFilter`'s fields
      // under `exactOptionalPropertyTypes: true` are `T` (presence
      // implies non-undefined). They're shape-compatible at runtime;
      // the cast bridges the static distinction. findPanels narrows
      // internally so this is safe.
      const result = findPanels(dashboard, filter as Parameters<typeof findPanels>[1]);
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

  // Skill / guidance markdown resources are read-only and served at
  // mcp://grafana/<skills|docs/guidance>/<name>.md (see
  // docs/conventions/mcp-resource-uris.md). Per AGENTS.md §1.8 the
  // project does not expose a write tool for these paths.
  registerMarkdownResources(server);

  return server;
}
