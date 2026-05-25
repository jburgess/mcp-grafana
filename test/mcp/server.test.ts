import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../../src/mcp/server.js';

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function textContentOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error('expected content array on tool result');
  }
  const first = content[0] as { type?: string; text?: string } | undefined;
  if (first?.type !== 'text' || typeof first.text !== 'string') {
    throw new Error('expected text content from tool');
  }
  return first.text;
}

describe('mcp server', () => {
  it('grafana_dashboard_build returns a dashboard whose title matches the input', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_build',
      arguments: { title: 'My Dashboard' },
    });

    const dashboard = JSON.parse(textContentOf(result)) as { title: string };
    expect(dashboard.title).toBe('My Dashboard');
  });

  it('grafana_dashboard_build passes through dashboard tags', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_build',
      arguments: { title: 'API service — overview', tags: ['overview'] },
    });

    const dashboard = JSON.parse(textContentOf(result)) as { tags?: string[] };
    expect(dashboard.tags).toContain('overview');
  });

  it('prometheus_metric_parse returns the parsed metric for the http_requests_total example', async () => {
    const client = await connectedClient();
    const text = [
      '# HELP http_requests_total The total number of processed HTTP requests.',
      '# TYPE http_requests_total counter',
      'http_requests_total{method="GET", status="200"} 15302',
      'http_requests_total{method="GET", status="404"} 14',
      'http_requests_total{method="POST", status="200"} 452',
      '',
    ].join('\n');

    const result = await client.callTool({
      name: 'prometheus_metric_parse',
      arguments: { text },
    });

    const metrics = JSON.parse(textContentOf(result)) as Array<{
      name: string;
      type: string;
      help?: string;
      labels: Record<string, string[]>;
    }>;

    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.name).toBe('http_requests_total');
    expect(metrics[0]?.type).toBe('counter');
    expect(metrics[0]?.help).toBe('The total number of processed HTTP requests.');
    expect(metrics[0]?.labels).toEqual({
      method: ['GET', 'POST'],
      status: ['200', '404'],
    });
  });

  it('prometheus_metric_parse reads exposition text from a file `path`', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'mcp-grafana-metrics-'));
    const file = join(dir, 'metrics.txt');
    writeFileSync(
      file,
      ['# TYPE up gauge', 'up{job="api"} 1', ''].join('\n'),
      'utf8',
    );

    const client = await connectedClient();
    const result = await client.callTool({
      name: 'prometheus_metric_parse',
      arguments: { path: file },
    });
    const metrics = JSON.parse(textContentOf(result)) as Array<{ name: string; type: string }>;
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.name).toBe('up');
    expect(metrics[0]?.type).toBe('gauge');
  });

  it('prometheus_metric_parse errors when neither text nor path is given', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'prometheus_metric_parse', arguments: {} });
    const parsed = JSON.parse(textContentOf(result)) as { errors?: string[] };
    expect(parsed.errors?.[0]).toMatch(/EXACTLY ONE/);
  });

  it('prometheus_metric_parse errors when both text and path are given', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'prometheus_metric_parse',
      arguments: { text: '# TYPE up gauge\nup 1\n', path: '/tmp/whatever.txt' },
    });
    const parsed = JSON.parse(textContentOf(result)) as { errors?: string[] };
    expect(parsed.errors?.[0]).toMatch(/EXACTLY ONE/);
  });

  it('prometheus_metric_parse returns an error for an unreadable file path', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'prometheus_metric_parse',
      arguments: { path: '/no/such/metrics-file.txt' },
    });
    const parsed = JSON.parse(textContentOf(result)) as { errors?: string[] };
    expect(parsed.errors?.[0]).toMatch(/could not read metrics file/);
  });

  it('grafana_timeseries_panel_build builds a panel with multiple targets', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_timeseries_panel_build',
      arguments: {
        title: 'HTTP rate vs errors',
        unit: 'reqps',
        targets: [
          { expr: 'sum(rate(http_requests_total[$__rate_interval]))', legendFormat: 'all' },
          {
            expr: 'sum(rate(http_requests_total{status=~"5.."}[$__rate_interval]))',
            legendFormat: 'errors',
          },
        ],
      },
    });

    const panel = JSON.parse(textContentOf(result)) as {
      title: string;
      targets: Array<{ expr: string; legendFormat: string }>;
    };
    expect(panel.title).toBe('HTTP rate vs errors');
    expect(panel.targets).toHaveLength(2);
    expect(panel.targets[0]?.legendFormat).toBe('all');
    expect(panel.targets[1]?.expr).toContain('status=~"5.."');
  });

  it('grafana_dashboard_build accepts a panels array (panel JSON from grafana_timeseries_panel_build)', async () => {
    const client = await connectedClient();

    const panelResult = await client.callTool({
      name: 'grafana_timeseries_panel_build',
      arguments: {
        title: 'HTTP requests',
        targets: [{ expr: 'rate(http_requests_total[$__rate_interval])' }],
      },
    });
    const panel = JSON.parse(textContentOf(panelResult)) as Record<string, unknown>;

    const dashboardResult = await client.callTool({
      name: 'grafana_dashboard_build',
      arguments: {
        title: 'My Dashboard',
        panels: [panel],
      },
    });

    const dashboard = JSON.parse(textContentOf(dashboardResult)) as {
      title: string;
      panels?: Array<{ title?: string }>;
    };
    expect(dashboard.title).toBe('My Dashboard');
    expect(dashboard.panels).toHaveLength(1);
    expect(dashboard.panels?.[0]?.title).toBe('HTTP requests');
  });

  it('grafana_dashboard_build still works with no panels (backwards compatible)', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_build',
      arguments: { title: 'Empty Dashboard' },
    });

    const dashboard = JSON.parse(textContentOf(result)) as {
      title: string;
      panels?: unknown[];
    };
    expect(dashboard.title).toBe('Empty Dashboard');
    expect(dashboard.panels ?? []).toHaveLength(0);
  });

  it('grafana_dashboard_inspect returns a summary by default', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_inspect',
      arguments: {
        dashboard: {
          title: 'HTTP service',
          uid: 'abc',
          panels: [
            { id: 1, type: 'timeseries', title: 'HTTP: requests', description: 'd', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
            { id: 2, type: 'timeseries', title: 'HTTP: errors', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
          ],
        },
      },
    });

    const summary = JSON.parse(textContentOf(result)) as {
      detail: string;
      title?: string;
      panelCount: number;
      panelsMissingDescription: number;
    };
    expect(summary.detail).toBe('summary');
    expect(summary.title).toBe('HTTP service');
    expect(summary.panelCount).toBe(2);
    expect(summary.panelsMissingDescription).toBe(1);
  });

  it('grafana_dashboard_inspect with detail=panels returns per-panel rows', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_inspect',
      arguments: {
        dashboard: {
          title: 't',
          panels: [
            { id: 1, type: 'timeseries', title: 'a', description: 'desc', fieldConfig: { defaults: { unit: 'reqps' } }, gridPos: { x: 0, y: 0, w: 12, h: 8 } },
          ],
        },
        detail: 'panels',
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      detail: string;
      panels: Array<{ title?: string; description?: string; unit?: string }>;
    };
    expect(parsed.detail).toBe('panels');
    expect(parsed.panels[0]?.description).toBe('desc');
    expect(parsed.panels[0]?.unit).toBe('reqps');
  });

  it('grafana_dashboard_inspect with detail=conventions returns style patterns', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_inspect',
      arguments: {
        dashboard: {
          title: 't',
          panels: [
            { id: 1, type: 'timeseries', title: 'a', fieldConfig: { defaults: { unit: 'reqps' } }, gridPos: { x: 0, y: 0, w: 12, h: 8 } },
            { id: 2, type: 'timeseries', title: 'b', fieldConfig: { defaults: { unit: 'reqps' } }, gridPos: { x: 12, y: 0, w: 12, h: 8 } },
          ],
        },
        detail: 'conventions',
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      detail: string;
      panelSizeHistogram: Record<string, number>;
      topUnits: Array<{ unit: string; count: number }>;
    };
    expect(parsed.detail).toBe('conventions');
    expect(parsed.panelSizeHistogram['12x8']).toBe(2);
    expect(parsed.topUnits[0]).toEqual({ unit: 'reqps', count: 2 });
  });

  it('grafana_dashboard_validate returns valid:true for a clean dashboard', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_validate',
      arguments: {
        dashboard: {
          title: 't',
          panels: [{ id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
        },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      valid: boolean;
      errors: Array<{ path: string; message: string }>;
    };
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it('grafana_dashboard_validate surfaces a duplicate-id error with paths', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_validate',
      arguments: {
        dashboard: {
          title: 't',
          panels: [
            { id: 7, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
            { id: 7, type: 'stat', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
          ],
        },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      valid: boolean;
      errors: Array<{ path: string; message: string }>;
    };
    expect(parsed.valid).toBe(false);
    const dups = parsed.errors.filter((e) => /duplicate panel id 7/.test(e.message));
    expect(dups).toHaveLength(2);
  });

  it('grafana_panel_validate with dashboard context catches unknown variable refs', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_panel_validate',
      arguments: {
        panel: {
          id: 1,
          type: 'timeseries',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [{ expr: 'rate(x{env="$env"}[5m])' }],
        },
        dashboard: { title: 't', templating: { list: [{ name: 'service' }] } },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      valid: boolean;
      errors: Array<{ path: string; message: string }>;
    };
    expect(parsed.valid).toBe(false);
    expect(parsed.errors[0]?.message).toMatch(/\$env/);
  });

  it('grafana_panel_validate without dashboard skips variable-ref checks', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_panel_validate',
      arguments: {
        panel: {
          id: 1,
          type: 'timeseries',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [{ expr: 'rate(x{env="$env"}[5m])' }],
        },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as { valid: boolean };
    expect(parsed.valid).toBe(true);
  });

  it('grafana_dashboard_panel_insert appends a panel by default', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_insert',
      arguments: {
        dashboard: {
          title: 't',
          panels: [{ id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
        },
        panel: { type: 'timeseries', title: 'New' },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: { panels: Array<{ id: number; gridPos: { y: number } }> };
      errors: Array<{ path: string; message: string }>;
    };
    expect(parsed.errors).toEqual([]);
    expect(parsed.dashboard?.panels).toHaveLength(2);
    expect(parsed.dashboard?.panels[1]?.id).toBe(2);
    expect(parsed.dashboard?.panels[1]?.gridPos.y).toBe(8);
  });

  it('grafana_dashboard_panel_insert with mode=inRow places the panel inside the row', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_insert',
      arguments: {
        dashboard: {
          title: 't',
          panels: [
            {
              id: 10,
              type: 'row',
              gridPos: { x: 0, y: 0, w: 24, h: 1 },
              panels: [{ id: 11, type: 'timeseries', gridPos: { x: 0, y: 1, w: 12, h: 8 } }],
            },
          ],
        },
        panel: { type: 'timeseries', title: 'New' },
        position: { mode: 'inRow', rowId: 10 },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: { panels: Array<{ panels?: Array<unknown> }> };
      errors: Array<unknown>;
    };
    expect(parsed.errors).toEqual([]);
    expect(parsed.dashboard?.panels[0]?.panels).toHaveLength(2);
  });

  it('grafana_dashboard_panel_insert surfaces an error for unknown rowId', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_insert',
      arguments: {
        dashboard: { title: 't', panels: [] },
        panel: { type: 'timeseries', title: 'New' },
        position: { mode: 'inRow', rowId: 999 },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: unknown;
      errors: Array<{ message: string }>;
    };
    expect(parsed.dashboard).toBeUndefined();
    expect(parsed.errors[0]?.message).toMatch(/999/);
  });

  it('grafana_dashboard_panel_update deep-merges a patch into a panel', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_update',
      arguments: {
        dashboard: {
          title: 't',
          panels: [
            {
              id: 1,
              type: 'timeseries',
              title: 'HTTP',
              gridPos: { x: 0, y: 0, w: 12, h: 8 },
              fieldConfig: {
                defaults: {
                  unit: 'reqps',
                  color: { mode: 'palette-classic' },
                },
              },
            },
          ],
        },
        panelId: 1,
        patch: { fieldConfig: { defaults: { unit: 'decbytes' } } },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: { panels: Array<{ fieldConfig: { defaults: { unit: string; color: { mode: string } } } }> };
      errors: Array<unknown>;
    };
    expect(parsed.errors).toEqual([]);
    const defaults = parsed.dashboard?.panels[0]?.fieldConfig.defaults;
    expect(defaults?.unit).toBe('decbytes');
    expect(defaults?.color).toEqual({ mode: 'palette-classic' });
  });

  it('grafana_dashboard_panel_update clears a field when patch value is null', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_update',
      arguments: {
        dashboard: {
          title: 't',
          panels: [
            {
              id: 1,
              type: 'timeseries',
              title: 't',
              description: 'old',
              gridPos: { x: 0, y: 0, w: 12, h: 8 },
            },
          ],
        },
        panelId: 1,
        patch: { description: null },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: { panels: Array<{ description?: string }> };
      errors: Array<unknown>;
    };
    expect(parsed.errors).toEqual([]);
    expect(parsed.dashboard?.panels[0]?.description).toBeUndefined();
  });

  it('grafana_dashboard_panel_update surfaces an error for unknown panelId', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_update',
      arguments: {
        dashboard: { title: 't', panels: [] },
        panelId: 999,
        patch: { description: 'x' },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: unknown;
      errors: Array<{ message: string }>;
    };
    expect(parsed.dashboard).toBeUndefined();
    expect(parsed.errors[0]?.message).toMatch(/999/);
  });

  it('grafana_dashboard_panel_move relocates a panel to a new position', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_move',
      arguments: {
        dashboard: {
          title: 't',
          panels: [
            { id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
            { id: 2, type: 'timeseries', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
          ],
        },
        panelId: 1,
        to: { mode: 'append' },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: { panels: Array<{ id: number }> };
      errors: Array<unknown>;
    };
    expect(parsed.errors).toEqual([]);
    const ids = parsed.dashboard?.panels.map((p) => p.id) ?? [];
    expect(ids[ids.length - 1]).toBe(1);
  });

  it('grafana_dashboard_panel_remove removes a top-level panel', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_remove',
      arguments: {
        dashboard: {
          title: 't',
          panels: [
            { id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
            { id: 2, type: 'timeseries', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
          ],
        },
        panelId: 1,
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: { panels: Array<{ id: number }> };
      errors: Array<unknown>;
    };
    expect(parsed.errors).toEqual([]);
    expect(parsed.dashboard?.panels).toHaveLength(1);
    expect(parsed.dashboard?.panels[0]?.id).toBe(2);
  });

  it('grafana_dashboard_panel_remove surfaces an error for unknown panelId', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_remove',
      arguments: { dashboard: { title: 't', panels: [] }, panelId: 999 },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: unknown;
      errors: Array<{ message: string }>;
    };
    expect(parsed.dashboard).toBeUndefined();
    expect(parsed.errors[0]?.message).toMatch(/999/);
  });

  it('grafana_dashboard_variable_rename rewrites refs across templating, titles, and queries', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_variable_rename',
      arguments: {
        dashboard: {
          title: 't',
          templating: { list: [{ name: 'role_nchf', type: 'query' }] },
          panels: [
            {
              id: 1,
              type: 'timeseries',
              title: 'Rate $role_nchf',
              gridPos: { x: 0, y: 0, w: 12, h: 8 },
              targets: [{ expr: 'rate(m{r="${role_nchf}"}[1m])', refId: 'A' }],
            },
          ],
        },
        oldName: 'role_nchf',
        newName: 'roleNchf',
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: {
        templating: { list: Array<{ name: string }> };
        panels: Array<{ title: string; targets: Array<{ expr: string }> }>;
      };
      errors: Array<unknown>;
      rewrites: number;
      locations: string[];
    };
    expect(parsed.errors).toEqual([]);
    expect(parsed.rewrites).toBe(3);
    expect(parsed.dashboard?.templating.list[0]?.name).toBe('roleNchf');
    expect(parsed.dashboard?.panels[0]?.title).toBe('Rate $roleNchf');
    expect(parsed.dashboard?.panels[0]?.targets[0]?.expr).toBe('rate(m{r="${roleNchf}"}[1m])');
    expect(parsed.locations).toContain('templating.list[0].name');
  });

  it('grafana_dashboard_variable_rename surfaces an error for unknown oldName', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_variable_rename',
      arguments: {
        dashboard: { title: 't', templating: { list: [] }, panels: [] },
        oldName: 'missing',
        newName: 'anything',
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: unknown;
      errors: Array<{ message: string }>;
    };
    expect(parsed.dashboard).toBeUndefined();
    expect(parsed.errors[0]?.message).toMatch(/missing/);
  });

  // PR review finding: collision is the most likely error a model will
  // hit when chaining rename calls. Exercise it end-to-end through the
  // MCP boundary so the error shape stays stable for clients.
  it('grafana_dashboard_variable_rename surfaces a collision error', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_variable_rename',
      arguments: {
        dashboard: {
          title: 't',
          templating: {
            list: [
              { name: 'foo', type: 'query' },
              { name: 'bar', type: 'query' },
            ],
          },
          panels: [],
        },
        oldName: 'foo',
        newName: 'bar',
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      dashboard?: unknown;
      errors: Array<{ message: string }>;
    };
    expect(parsed.dashboard).toBeUndefined();
    expect(parsed.errors[0]?.message).toMatch(/already exists/);
  });

  it('reports a version that matches package.json (no 0.0.0 placeholder)', async () => {
    // The MCP server reports its version to clients via the initialize handshake.
    // Previously it was hardcoded to '0.0.0' while package.json said '0.1.0', so
    // every connected client saw a wrong version. Keep this assertion in sync
    // with package.json on every release bump.
    const client = await connectedClient();
    const info = client.getServerVersion();
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(info?.version).toBe(pkg.version);
  });

  it('grafana_panel_lint accepts a PanelStyleGuide slice and reports issues', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_panel_lint',
      arguments: {
        panel: {
          id: 1,
          type: 'timeseries',
          title: 'CPU',
          // description missing → fires panels.descriptions.required
          fieldConfig: { defaults: { unit: 'celsius' } }, // → fires panels.units.allowList
        },
        styleGuide: {
          timeseries: {
            legend: { placement: 'right', displayMode: 'table', calcs: ['mean'] },
          },
          units: { allowList: ['percentunit', 'short'] },
          descriptions: { required: true },
        },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      issues: Array<{ ruleId: string; severity: string }>;
    };
    const ruleIds = parsed.issues.map((i) => i.ruleId);
    expect(ruleIds).toContain('panels.units.allowList');
    expect(ruleIds).toContain('panels.descriptions.required');
    for (const issue of parsed.issues) {
      // Style severity discipline: warn or info, never error.
      expect(['warn', 'info']).toContain(issue.severity);
    }
  });

  it('grafana_panel_lint unwraps a GrafanaStyleGuide umbrella ({ panels: ... })', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_panel_lint',
      arguments: {
        panel: {
          id: 1,
          type: 'timeseries',
          title: 'CPU',
          description: 'd',
          fieldConfig: { defaults: { unit: 'locale' } }, // deny-list hit
        },
        styleGuide: {
          $schema: 'https://example.invalid/style.json',
          panels: {
            units: { deny: ['locale'] },
          },
        },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      issues: Array<{ ruleId: string }>;
    };
    expect(parsed.issues.map((i) => i.ruleId)).toContain('panels.units.deny');
  });

  it('exposes the grafana-style-guide skill as a read-only MCP resource', async () => {
    // The convention: skills/<name>.md is served at
    // mcp://grafana/skills/<name>.md (see docs/conventions/mcp-resource-uris.md).
    // Verifies both discoverability (resources/list) and content (resources/read).
    const client = await connectedClient();

    const { resources } = await client.listResources();
    const styleGuide = resources.find(
      (r) => r.uri === 'mcp://grafana/skills/grafana-style-guide.md',
    );
    expect(styleGuide).toBeDefined();
    expect(styleGuide?.mimeType).toBe('text/markdown');

    const read = await client.readResource({
      uri: 'mcp://grafana/skills/grafana-style-guide.md',
    });
    const first = read.contents[0] as { text?: string; mimeType?: string };
    expect(first?.mimeType).toBe('text/markdown');
    // Sanity-check: the skill body has the `## Scope` section.
    expect(first?.text).toContain('## Scope');
    expect(first?.text).toContain('Grafana style guide');
  });

  // Validates the "missing directories tolerated silently, light up
  // automatically when a file lands" contract from PR #35 — the
  // bulk-panel-updates guidance file dropped into docs/guidance/ and
  // is served at mcp://grafana/docs/guidance/<name>.md without any
  // explicit registration code change. (research.md Entry 015 cut
  // the bulk_update tool; the guidance file shipped in its place.)
  it('exposes docs/guidance/*.md files automatically when they land', async () => {
    const client = await connectedClient();

    const { resources } = await client.listResources();
    const guidance = resources.find(
      (r) => r.uri === 'mcp://grafana/docs/guidance/bulk-panel-updates.md',
    );
    expect(guidance).toBeDefined();
    expect(guidance?.mimeType).toBe('text/markdown');

    const read = await client.readResource({
      uri: 'mcp://grafana/docs/guidance/bulk-panel-updates.md',
    });
    const first = read.contents[0] as { text?: string; mimeType?: string };
    expect(first?.mimeType).toBe('text/markdown');
    // Sanity-check: the guidance body documents the canonical pattern.
    expect(first?.text).toContain('grafana_dashboard_panel_find');
    expect(first?.text).toContain('grafana_dashboard_panel_update');
  });

  // Verifies the resource handler's walk surfaces N>1 files in
  // docs/guidance/ — the units/descriptions/thresholds trio (#31
  // cuts' guidance replacements) all light up via the same handler.
  // Catches a regression where the walker silently dropped after
  // the first file (e.g. early break, accidental .find() instead of
  // .filter()).
  it('exposes every docs/guidance/*.md file when multiple are present', async () => {
    const client = await connectedClient();

    const { resources } = await client.listResources();
    const guidanceUris = resources
      .map((r) => r.uri)
      .filter((u) => u.startsWith('mcp://grafana/docs/guidance/'));
    // Every docs/guidance/*.md file lands as a discoverable resource:
    // the three audit-pattern docs (#31 cuts' replacements),
    // bulk-panel-updates.md, and session-resource-registry.md (#65
    // item 4). Sort for deterministic comparison.
    expect(guidanceUris.sort()).toEqual([
      'mcp://grafana/docs/guidance/audit-review.md',
      'mcp://grafana/docs/guidance/bulk-panel-updates.md',
      'mcp://grafana/docs/guidance/descriptions.md',
      'mcp://grafana/docs/guidance/pr-review.md',
      'mcp://grafana/docs/guidance/scaffold-from-metrics.md',
      'mcp://grafana/docs/guidance/session-resource-registry.md',
      'mcp://grafana/docs/guidance/thresholds.md',
      'mcp://grafana/docs/guidance/units.md',
    ]);
  });

  // The exhaustive tool-list assertion in "lists all twelve registered tools"
  // below is the real guard against an unintended write tool sneaking in:
  // adding ANY new tool, regardless of name, breaks that count assertion
  // and forces the author to update the list explicitly. The previous
  // regex check was weaker than that and was dropped during PR #35 review.

  it('grafana_panel_lint surfaces a structural issue (not silent {issues:[]}) when styleGuide.panels is malformed', async () => {
    // The worst-possible failure mode for a lint tool: silently report
    // "no issues" when the guide itself is broken. PR #35 review found
    // the original unwrap silently treated `{panels: null}` and
    // `{panels: 5}` as empty slices. resolveSlice surfaces it now.
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_panel_lint',
      arguments: {
        panel: { id: 1, type: 'timeseries', title: 't', description: 'd' },
        styleGuide: { panels: 5 },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      issues: Array<{ ruleId: string; path: string }>;
    };
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]?.ruleId).toBe('panels.shape');
    expect(parsed.issues[0]?.path).toBe('$styleGuide.panels');
  });

  it('grafana_panel_lint surfaces an ambiguity issue when styleGuide has both umbrella and slice keys', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_panel_lint',
      arguments: {
        panel: { id: 1, type: 'timeseries', title: 't', description: 'd' },
        styleGuide: {
          panels: { units: { allowList: ['short'] } },
          timeseries: { legend: { placement: 'right' } },
        },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      issues: Array<{ ruleId: string; message: string }>;
    };
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]?.ruleId).toBe('panels.shape');
    expect(parsed.issues[0]?.message).toMatch(/both umbrella-form .* and slice-form/);
  });

  it('grafana_dashboard_lint walks panels and surfaces dashboard-level rules', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_lint',
      arguments: {
        dashboard: {
          title: 't',
          templating: {
            list: [
              {
                name: 'processor',
                type: 'query',
                hide: 2,
                current: { value: 'a' },
              },
            ],
          },
          panels: [
            {
              id: 1,
              type: 'row',
              title: 'Processor: $processor',
              gridPos: { x: 0, y: 0, w: 24, h: 1 },
            },
            {
              id: 2,
              type: 'timeseries',
              title: 'Same name',
              // description missing → fires panels.descriptions.required
              fieldConfig: { defaults: { unit: 'reqps' } },
              gridPos: { x: 0, y: 1, w: 12, h: 8 },
            },
            {
              id: 3,
              type: 'timeseries',
              title: 'Same name', // duplicate of id 2
              description: 'd',
              fieldConfig: { defaults: { unit: 'reqps' } },
              gridPos: { x: 12, y: 1, w: 12, h: 8 },
            },
          ],
        },
        styleGuide: {
          panels: { descriptions: { required: true } },
          dashboards: {
            panels: { duplicateTitles: true },
            variables: { hiddenButReferenced: true },
          },
        },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      issues: Array<{ ruleId: string; path: string }>;
    };
    const ruleIds = parsed.issues.map((i) => i.ruleId);
    expect(ruleIds).toContain('panels.descriptions.required');
    expect(ruleIds).toContain('dashboards.panels.duplicateTitles');
    expect(ruleIds).toContain('dashboards.variables.hiddenButReferenced');
    // Panel issues come before dashboard issues so consumers can group by prefix.
    const firstDashIdx = ruleIds.findIndex((r) => r.startsWith('dashboards.'));
    const lastPanelIdx = ruleIds.reduce(
      (acc, r, i) => (r.startsWith('panels.') ? i : acc),
      -1,
    );
    expect(lastPanelIdx).toBeLessThan(firstDashIdx);
  });

  it('grafana_dashboard_panel_find returns ids matching a closed-set filter', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_find',
      arguments: {
        dashboard: {
          title: 't',
          panels: [
            { id: 1, type: 'row', title: 'r', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
            {
              id: 2,
              type: 'timeseries',
              title: 'a',
              description: 'd',
              fieldConfig: { defaults: { unit: 'reqps' } },
              targets: [{ expr: 'rate(http_requests_total[5m])' }],
            },
            {
              id: 3,
              type: 'timeseries',
              title: 'b',
              fieldConfig: { defaults: { unit: 'reqps' } },
              targets: [{ expr: 'sum(up)' }],
            },
          ],
        },
        filter: { type: 'timeseries', queryMatches: 'rate\\(' },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      panelIds: Array<number>;
      errors: Array<unknown>;
    };
    expect(parsed.errors).toEqual([]);
    expect(parsed.panelIds).toEqual([2]);
  });

  // Strict-schema rejection at the MCP boundary: a typo of
  // `queryMatches` as `matches` would otherwise silently return "every
  // panel matches" (empty filter). The closed-DSL design rejects it.
  // The MCP SDK surfaces validation failures via `isError: true` on
  // the tool result rather than throwing on the client side.
  it('grafana_dashboard_panel_find rejects unrecognised filter keys at the MCP boundary', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_find',
      arguments: {
        dashboard: { title: 't', panels: [] },
        // `matches` is a typo of `queryMatches` — strict schema must reject.
        filter: { matches: 'rate\\(' },
      },
    });

    const errored = (result as { isError?: boolean }).isError === true;
    const text = textContentOf(result);
    expect(errored).toBe(true);
    // The Zod error message should call out the unrecognised key.
    expect(text.toLowerCase()).toMatch(/unrecognized|matches/);
  });

  it('grafana_dashboard_panel_find surfaces an error for an over-long regex pattern', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_panel_find',
      arguments: {
        dashboard: { title: 't', panels: [] },
        filter: { queryMatches: 'a'.repeat(300) },
      },
    });

    const parsed = JSON.parse(textContentOf(result)) as {
      panelIds: Array<unknown>;
      errors: Array<{ path: string; message: string }>;
    };
    expect(parsed.panelIds).toEqual([]);
    expect(parsed.errors[0]?.path).toBe('filter.queryMatches');
    expect(parsed.errors[0]?.message).toMatch(/length|cap/i);
  });

  it('grafana_table_panel_build returns a table panel with the given title', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_table_panel_build',
      arguments: {
        title: 'Top endpoints',
        targets: [{ expr: 'topk(10, sum by (endpoint) (rate(http_requests_total[5m])))' }],
        unit: 'short',
        filterable: true,
      },
    });
    const panel = JSON.parse(textContentOf(result)) as {
      type: string;
      title: string;
    };
    expect(panel.type).toBe('table');
    expect(panel.title).toBe('Top endpoints');
    expect(JSON.stringify(panel)).toContain('"filterable":true');
  });

  it('grafana_state_timeline_panel_build returns a state-timeline panel', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_state_timeline_panel_build',
      arguments: {
        title: 'Service health',
        targets: [{ expr: 'up{job="api"}' }],
        mergeValues: true,
      },
    });
    const panel = JSON.parse(textContentOf(result)) as { type: string; title: string };
    expect(panel.type).toBe('state-timeline');
    expect(panel.title).toBe('Service health');
    expect(JSON.stringify(panel)).toContain('"mergeValues":true');
  });

  it('grafana_stat_panel_build returns a stat panel with the default graphMode "area"', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_stat_panel_build',
      arguments: {
        title: 'SLO',
        targets: [{ expr: 'sum(up)' }],
      },
    });
    const panel = JSON.parse(textContentOf(result)) as {
      type: string;
      title: string;
      options: { graphMode?: string };
    };
    expect(panel.type).toBe('stat');
    expect(panel.title).toBe('SLO');
    expect(panel.options.graphMode).toBe('area');
  });

  it('grafana_stat_panel_build accepts explicit graphMode "none" (caller opt-out)', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_stat_panel_build',
      arguments: {
        title: 'KPI',
        targets: [{ expr: 'up' }],
        graphMode: 'none',
      },
    });
    const panel = JSON.parse(textContentOf(result)) as {
      options: { graphMode?: string };
    };
    expect(panel.options.graphMode).toBe('none');
  });

  it('grafana_row_panel_build returns a row panel with the given title', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_row_panel_build',
      arguments: { title: 'Service health', collapsed: true },
    });
    const row = JSON.parse(textContentOf(result)) as {
      type: string;
      title: string;
      collapsed?: boolean;
    };
    expect(row.type).toBe('row');
    expect(row.title).toBe('Service health');
    expect(row.collapsed).toBe(true);
  });

  it('grafana_heatmap_panel_build returns a heatmap panel with the given title', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_heatmap_panel_build',
      arguments: {
        title: 'Request latency',
        targets: [{ expr: 'sum(rate(http_request_duration_seconds_bucket[5m])) by (le)' }],
        unit: 's',
        calculate: true,
      },
    });
    const panel = JSON.parse(textContentOf(result)) as { type: string; title: string };
    expect(panel.type).toBe('heatmap');
    expect(panel.title).toBe('Request latency');
    expect(JSON.stringify(panel)).toContain('"calculate":true');
  });

  it('grafana_gauge_panel_build returns a gauge panel with bounds and the given title', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_gauge_panel_build',
      arguments: {
        title: 'CPU utilisation',
        targets: [{ expr: 'avg(node_cpu_utilisation)' }],
        unit: 'percent',
        min: 0,
        max: 100,
      },
    });
    const panel = JSON.parse(textContentOf(result)) as { type: string; title: string };
    expect(panel.type).toBe('gauge');
    expect(panel.title).toBe('CPU utilisation');
    const json = JSON.stringify(panel);
    expect(json).toContain('"min":0');
    expect(json).toContain('"max":100');
    expect(json).toContain('lastNotNull');
  });

  it('grafana_dashboard_load registers a file and returns a registry URI', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'mcp-grafana-server-'));
    const path = join(dir, 'd.json');
    writeFileSync(path, JSON.stringify({ title: 'From File' }), 'utf8');

    const client = await connectedClient();
    const loadResult = await client.callTool({
      name: 'grafana_dashboard_load',
      arguments: { path },
    });
    const { uri } = JSON.parse(textContentOf(loadResult)) as { uri: string };
    expect(uri.startsWith('mcp://grafana/session/dashboard/')).toBe(true);

    const exportResult = await client.callTool({
      name: 'grafana_dashboard_export',
      arguments: { uri },
    });
    const { dashboard } = JSON.parse(textContentOf(exportResult)) as {
      dashboard: { title: string };
    };
    expect(dashboard.title).toBe('From File');

    const closeResult = await client.callTool({
      name: 'grafana_dashboard_close',
      arguments: { uri },
    });
    const { removed } = JSON.parse(textContentOf(closeResult)) as { removed: boolean };
    expect(removed).toBe(true);

    // Subsequent export fails with a structured error.
    const exportAfterClose = await client.callTool({
      name: 'grafana_dashboard_export',
      arguments: { uri },
    });
    const { errors } = JSON.parse(textContentOf(exportAfterClose)) as {
      errors: Array<{ code: string; message: string }>;
    };
    expect(errors[0]?.code).toBe('unknown-uri');
  });

  it('grafana_dashboard_load returns structured error for missing file', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_dashboard_load',
      arguments: { path: '/no/such/dashboard.json' },
    });
    const parsed = JSON.parse(textContentOf(result)) as {
      errors: Array<{ code: string }>;
    };
    expect(parsed.errors[0]?.code).toBe('not-found');
  });

  it('registry is session-scoped — a URI from one session does not resolve in another', async () => {
    // Test setup only: in production an MCP host creates ONE server per
    // session via createMcpServer() and the server never spawns
    // sub-servers. Here we call the connectedClient() helper twice to
    // simulate two independent sessions, each producing its own
    // (server, client) pair wired by InMemoryTransport. The test then
    // checks that a URI registered in simulated-session A does NOT
    // resolve in simulated-session B — the per-session contract that
    // protects against cross-session leakage.
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'mcp-grafana-server-iso-'));
    const path = join(dir, 'd.json');
    writeFileSync(path, JSON.stringify({ title: 'isolation' }), 'utf8');

    const a = await connectedClient();
    const b = await connectedClient();
    const loadA = await a.callTool({
      name: 'grafana_dashboard_load',
      arguments: { path },
    });
    const { uri } = JSON.parse(textContentOf(loadA)) as { uri: string };

    const exportB = await b.callTool({
      name: 'grafana_dashboard_export',
      arguments: { uri },
    });
    const parsed = JSON.parse(textContentOf(exportB)) as {
      errors?: Array<{ code: string }>;
    };
    expect(parsed.errors?.[0]?.code).toBe('unknown-uri');
  });

  it('grafana_promql_validate returns valid:true for a syntactically valid expression', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_promql_validate',
      arguments: { expr: 'rate(http_requests_total[5m])' },
    });
    const parsed = JSON.parse(textContentOf(result)) as { valid: boolean; errors: unknown[] };
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it('grafana_promql_validate returns valid:false with structured errors for a broken expression', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_promql_validate',
      arguments: { expr: 'rate(http_requests_total[5m' },
    });
    const parsed = JSON.parse(textContentOf(result)) as {
      valid: boolean;
      errors: Array<{ from: number; to: number; message: string }>;
    };
    expect(parsed.valid).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.errors[0]?.from).toBeTypeOf('number');
    expect(parsed.errors[0]?.message).toBeTypeOf('string');
  });

  it('registers exactly the three workflow-recipe prompts', async () => {
    // EXACT match (drift guard, mirroring the tool-list test): adding a
    // workflow prompt without updating this breaks the test. Reference
    // guidance docs (units/descriptions/thresholds/…) are resources only,
    // not prompts — see src/mcp/prompts.ts.
    const client = await connectedClient();
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toEqual([
      'grafana_audit_dashboard',
      'grafana_review_dashboard_change',
      'grafana_scaffold_dashboard',
    ]);
  });

  it('a recipe prompt returns its guidance markdown as a user message', async () => {
    const client = await connectedClient();
    // A prompt that declares (all-optional) args still expects an
    // `arguments` object per the SDK — prompt-aware clients send `{}` when
    // the user fills nothing in.
    const result = await client.getPrompt({
      name: 'grafana_review_dashboard_change',
      arguments: {},
    });
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0]!;
    expect(msg.role).toBe('user');
    const content = msg.content as { type?: string; text?: string };
    expect(content.type).toBe('text');
    // The body is the pr-review.md guidance file verbatim.
    expect(content.text).toContain('Reviewing a dashboard change');
    expect(content.text).toContain('grafana_dashboard_diff');
    // No inputs supplied → no preamble.
    expect(content.text?.startsWith('Inputs for this run')).toBe(false);
  });

  it('a recipe prompt prepends supplied arguments as an inputs preamble', async () => {
    const client = await connectedClient();
    const result = await client.getPrompt({
      name: 'grafana_scaffold_dashboard',
      arguments: { metricsPath: '/tmp/metrics.txt' },
    });
    const content = result.messages[0]!.content as { text?: string };
    expect(content.text?.startsWith('Inputs for this run:')).toBe(true);
    expect(content.text).toContain('`/tmp/metrics.txt`');
    // The recipe body still follows the preamble.
    expect(content.text).toContain('scaffold');
  });

  it('grafana_dashboard_diff reports semantic changes between two dashboards', async () => {
    const client = await connectedClient();

    const base = {
      title: 'svc',
      panels: [
        { id: 1, type: 'timeseries', title: 'A', fieldConfig: { defaults: { unit: 'reqps' } } },
        { id: 2, type: 'stat', title: 'B' },
      ],
    };
    const head = {
      title: 'svc',
      panels: [
        { id: 1, type: 'timeseries', title: 'A', fieldConfig: { defaults: { unit: 'cps' } } },
      ],
    };

    const result = await client.callTool({
      name: 'grafana_dashboard_diff',
      arguments: { base, head },
    });
    const parsed = JSON.parse(textContentOf(result)) as {
      panelsRemoved: Array<{ id?: number }>;
      panelsChanged: Array<{ id?: number; changes: Array<{ field: string }> }>;
    };
    expect(parsed.panelsRemoved.map((p) => p.id)).toEqual([2]);
    expect(parsed.panelsChanged).toHaveLength(1);
    expect(parsed.panelsChanged[0]?.changes.map((c) => c.field)).toEqual(['unit']);
  });

  it('grafana_dashboard_diff errors when a side has both inline and URI', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'grafana_dashboard_diff',
      arguments: { base: { title: 'x' }, baseUri: 'mcp://grafana/session/dashboard/1', head: { title: 'y' } },
    });
    const parsed = JSON.parse(textContentOf(result)) as { errors?: unknown[] };
    expect(parsed.errors).toBeDefined();
  });

  it('registers exactly the twenty-three expected tools — no more, no less', async () => {
    // EXACT match (not toContain) so any new tool added without updating
    // this list breaks the test, forcing the author to explicitly
    // acknowledge the new surface. This is the project's guard against
    // an unintended write tool (e.g. `grafana_skill_install`,
    // `set_style_guide`) silently appearing — see AGENTS.md §1.8 and
    // docs/conventions/mcp-resource-uris.md for the read-only-skills
    // discipline. A `toContain`-only check (the previous form) would
    // let any extra tool slip through.
    const client = await connectedClient();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'grafana_dashboard_build',
      'grafana_dashboard_close',
      'grafana_dashboard_diff',
      'grafana_dashboard_export',
      'grafana_dashboard_inspect',
      'grafana_dashboard_lint',
      'grafana_dashboard_load',
      'grafana_dashboard_panel_find',
      'grafana_dashboard_panel_insert',
      'grafana_dashboard_panel_move',
      'grafana_dashboard_panel_remove',
      'grafana_dashboard_panel_update',
      'grafana_dashboard_validate',
      'grafana_dashboard_variable_rename',
      'grafana_gauge_panel_build',
      'grafana_heatmap_panel_build',
      'grafana_panel_lint',
      'grafana_panel_validate',
      'grafana_promql_validate',
      'grafana_row_panel_build',
      'grafana_stat_panel_build',
      'grafana_state_timeline_panel_build',
      'grafana_table_panel_build',
      'grafana_timeseries_panel_build',
      'prometheus_metric_parse',
    ]);
  });

  describe('dashboardUri read-tool wiring (#65 item 2)', () => {
    async function loadAndGetUri(
      client: Awaited<ReturnType<typeof connectedClient>>,
      dashboard: Record<string, unknown>,
    ): Promise<string> {
      const { writeFileSync, mkdtempSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const dir = mkdtempSync(join(tmpdir(), 'mcp-grafana-readtool-'));
      const path = join(dir, 'd.json');
      writeFileSync(path, JSON.stringify(dashboard), 'utf8');
      const loadResult = await client.callTool({
        name: 'grafana_dashboard_load',
        arguments: { path },
      });
      const { uri } = JSON.parse(textContentOf(loadResult)) as { uri: string };
      return uri;
    }

    it('grafana_dashboard_inspect accepts dashboardUri', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'From Registry',
        panels: [{ id: 1, type: 'timeseries', title: 'X' }],
      });

      const result = await client.callTool({
        name: 'grafana_dashboard_inspect',
        arguments: { dashboardUri: uri },
      });
      const parsed = JSON.parse(textContentOf(result)) as { title: string; panelCount: number };
      expect(parsed.title).toBe('From Registry');
      expect(parsed.panelCount).toBe(1);
    });

    it('grafana_dashboard_validate accepts dashboardUri', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'Valid',
        panels: [{ id: 1, type: 'timeseries', title: 'X' }],
      });

      const result = await client.callTool({
        name: 'grafana_dashboard_validate',
        arguments: { dashboardUri: uri },
      });
      const parsed = JSON.parse(textContentOf(result)) as { valid: boolean; errors: unknown[] };
      expect(parsed.valid).toBe(true);
      expect(parsed.errors).toEqual([]);
    });

    it('grafana_panel_validate runs schema-only when neither dashboard nor dashboardUri provided', async () => {
      // panel_validate's special case: dashboard context is optional —
      // omitting both is valid (runs schema-only validation), unlike the
      // other four tools where neither is an error. Guards the
      // hasInline || hasUri branch from regressing into a "must pass one"
      // contract.
      const client = await connectedClient();
      const result = await client.callTool({
        name: 'grafana_panel_validate',
        arguments: { panel: { id: 1, type: 'timeseries', title: 'X' } },
      });
      const parsed = JSON.parse(textContentOf(result)) as { valid: boolean; errors: unknown[] };
      expect(parsed.valid).toBe(true);
      expect(parsed.errors).toEqual([]);
    });

    it('grafana_panel_validate accepts dashboardUri for context', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'd',
        templating: { list: [{ name: 'instance', type: 'query' }] },
      });

      const result = await client.callTool({
        name: 'grafana_panel_validate',
        arguments: {
          panel: { id: 1, type: 'timeseries', targets: [{ expr: 'up{instance="$instance"}' }] },
          dashboardUri: uri,
        },
      });
      const parsed = JSON.parse(textContentOf(result)) as { valid: boolean };
      // Variable ref `$instance` resolves against templating list → valid.
      expect(parsed.valid).toBe(true);
    });

    it('grafana_dashboard_lint accepts dashboardUri', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'd',
        panels: [{ id: 1, type: 'timeseries', title: 'no desc' }],
      });

      const result = await client.callTool({
        name: 'grafana_dashboard_lint',
        arguments: {
          dashboardUri: uri,
          styleGuide: { panels: { descriptions: { required: true } } },
        },
      });
      const parsed = JSON.parse(textContentOf(result)) as { issues: Array<{ ruleId: string }> };
      expect(parsed.issues.some((i) => i.ruleId === 'panels.descriptions.required')).toBe(true);
    });

    it('grafana_dashboard_panel_find accepts dashboardUri', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'd',
        panels: [
          { id: 1, type: 'timeseries', title: 'A' },
          { id: 2, type: 'stat', title: 'B' },
        ],
      });

      const result = await client.callTool({
        name: 'grafana_dashboard_panel_find',
        arguments: { dashboardUri: uri, filter: { type: 'stat' } },
      });
      const parsed = JSON.parse(textContentOf(result)) as { panelIds: number[] };
      expect(parsed.panelIds).toEqual([2]);
    });

    it('errors when both dashboard and dashboardUri are provided (mutual exclusion)', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, { title: 'd' });

      const result = await client.callTool({
        name: 'grafana_dashboard_inspect',
        arguments: { dashboard: { title: 'inline' }, dashboardUri: uri },
      });
      const parsed = JSON.parse(textContentOf(result)) as {
        errors?: Array<{ code: string }>;
      };
      expect(parsed.errors?.[0]?.code).toBe('both-provided');
    });

    it('errors when neither dashboard nor dashboardUri are provided', async () => {
      const client = await connectedClient();
      const result = await client.callTool({
        name: 'grafana_dashboard_inspect',
        arguments: {},
      });
      const parsed = JSON.parse(textContentOf(result)) as {
        errors?: Array<{ code: string }>;
      };
      expect(parsed.errors?.[0]?.code).toBe('neither-provided');
    });

    it('errors when dashboardUri does not resolve', async () => {
      const client = await connectedClient();
      const result = await client.callTool({
        name: 'grafana_dashboard_inspect',
        arguments: { dashboardUri: 'mcp://grafana/session/dashboard/999' },
      });
      const parsed = JSON.parse(textContentOf(result)) as {
        errors?: Array<{ code: string }>;
      };
      expect(parsed.errors?.[0]?.code).toBe('unknown-uri');
    });
  });

  describe('dashboardUri write-tool wiring (#65 item 3)', () => {
    async function loadAndGetUri(
      client: Awaited<ReturnType<typeof connectedClient>>,
      dashboard: Record<string, unknown>,
    ): Promise<string> {
      const { writeFileSync, mkdtempSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const dir = mkdtempSync(join(tmpdir(), 'mcp-grafana-writetool-'));
      const path = join(dir, 'd.json');
      writeFileSync(path, JSON.stringify(dashboard), 'utf8');
      const loadResult = await client.callTool({
        name: 'grafana_dashboard_load',
        arguments: { path },
      });
      const { uri } = JSON.parse(textContentOf(loadResult)) as { uri: string };
      return uri;
    }

    it('grafana_dashboard_panel_insert returns { uri, summary, errors } on URI path', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, { title: 'd', panels: [] });

      const result = await client.callTool({
        name: 'grafana_dashboard_panel_insert',
        arguments: {
          dashboardUri: uri,
          panel: { type: 'timeseries', title: 'New' },
        },
      });
      const env = JSON.parse(textContentOf(result)) as {
        uri: string;
        summary: { title: string; panelCount: number };
        errors: unknown[];
        dashboard?: unknown;
      };

      expect(env.uri).toBe(uri);
      expect(env.summary.title).toBe('d');
      expect(env.summary.panelCount).toBe(1);
      expect(env.errors).toEqual([]);
      // Crucial: no `dashboard` field on the URI-path response. That's
      // the whole point — JSON does not enter the LLM context.
      expect(env.dashboard).toBeUndefined();
    });

    it('grafana_dashboard_panel_insert mutates the registry slot in place', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, { title: 'd', panels: [] });

      await client.callTool({
        name: 'grafana_dashboard_panel_insert',
        arguments: {
          dashboardUri: uri,
          panel: { type: 'timeseries', title: 'P1' },
        },
      });

      // Subsequent export sees the mutated dashboard.
      const exportResult = await client.callTool({
        name: 'grafana_dashboard_export',
        arguments: { uri },
      });
      const { dashboard } = JSON.parse(textContentOf(exportResult)) as {
        dashboard: { panels: Array<{ title: string }> };
      };
      expect(dashboard.panels).toHaveLength(1);
      expect(dashboard.panels[0]?.title).toBe('P1');
    });

    it('grafana_dashboard_panel_update mutates via URI', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'd',
        panels: [{ id: 1, type: 'timeseries', title: 'orig' }],
      });

      const result = await client.callTool({
        name: 'grafana_dashboard_panel_update',
        arguments: {
          dashboardUri: uri,
          panelId: 1,
          patch: { title: 'updated' },
        },
      });
      const env = JSON.parse(textContentOf(result)) as { uri: string; summary: unknown; errors: unknown[] };
      expect(env.uri).toBe(uri);
      expect(env.errors).toEqual([]);

      const exp = await client.callTool({
        name: 'grafana_dashboard_export',
        arguments: { uri },
      });
      const { dashboard } = JSON.parse(textContentOf(exp)) as {
        dashboard: { panels: Array<{ title: string }> };
      };
      expect(dashboard.panels[0]?.title).toBe('updated');
    });

    it('grafana_dashboard_panel_move via URI', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'd',
        panels: [
          { id: 1, type: 'timeseries', title: 'A', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
          { id: 2, type: 'timeseries', title: 'B', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
        ],
      });

      const result = await client.callTool({
        name: 'grafana_dashboard_panel_move',
        arguments: {
          dashboardUri: uri,
          panelId: 1,
          to: { mode: 'gridPos', x: 0, y: 100, w: 12, h: 8 },
        },
      });
      const env = JSON.parse(textContentOf(result)) as { uri: string; errors: unknown[] };
      expect(env.uri).toBe(uri);
      expect(env.errors).toEqual([]);
    });

    it('grafana_dashboard_panel_remove via URI', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'd',
        panels: [{ id: 1, type: 'timeseries', title: 'X' }],
      });

      const result = await client.callTool({
        name: 'grafana_dashboard_panel_remove',
        arguments: { dashboardUri: uri, panelId: 1 },
      });
      const env = JSON.parse(textContentOf(result)) as {
        uri: string;
        summary: { panelCount: number };
        errors: unknown[];
      };
      expect(env.uri).toBe(uri);
      expect(env.summary.panelCount).toBe(0);
    });

    it('grafana_dashboard_variable_rename via URI preserves rewrites + locations', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'd',
        templating: { list: [{ name: 'env', type: 'query' }] },
        panels: [{ id: 1, type: 'timeseries', targets: [{ expr: 'up{env="$env"}' }] }],
      });

      const result = await client.callTool({
        name: 'grafana_dashboard_variable_rename',
        arguments: { dashboardUri: uri, oldName: 'env', newName: 'environment' },
      });
      const env = JSON.parse(textContentOf(result)) as {
        uri: string;
        summary: unknown;
        errors: unknown[];
        rewrites: number;
        locations: string[];
        dashboard?: unknown;
      };
      expect(env.uri).toBe(uri);
      expect(env.errors).toEqual([]);
      expect(env.rewrites).toBeGreaterThan(0);
      expect(env.locations.length).toBeGreaterThan(0);
      // No dashboard field on the URI path.
      expect(env.dashboard).toBeUndefined();
    });

    it('write tools still support inline dashboard (unchanged shape)', async () => {
      const client = await connectedClient();
      const result = await client.callTool({
        name: 'grafana_dashboard_panel_insert',
        arguments: {
          dashboard: { title: 'd', panels: [] },
          panel: { type: 'timeseries', title: 'X' },
        },
      });
      const env = JSON.parse(textContentOf(result)) as {
        dashboard?: { panels?: unknown[] };
        errors: unknown[];
      };
      expect(env.dashboard?.panels).toHaveLength(1);
      expect(env.errors).toEqual([]);
    });

    it('registered URI + library failure leaves the registry slot unchanged', async () => {
      // The applyWriteResult failure branch (dashboard absent) must NOT
      // call registry.replace. Walks: register a dashboard, call
      // panel_update with a bogus panelId so the library returns
      // { errors: [...] } and no dashboard, then export and verify the
      // slot still holds the original.
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'unchanged-on-failure',
        panels: [{ id: 1, type: 'timeseries', title: 'orig' }],
      });

      const updateResult = await client.callTool({
        name: 'grafana_dashboard_panel_update',
        arguments: {
          dashboardUri: uri,
          panelId: 999, // not present
          patch: { title: 'mutated' },
        },
      });
      const env = JSON.parse(textContentOf(updateResult)) as {
        uri?: string;
        summary?: unknown;
        errors: unknown[];
      };
      expect(env.uri).toBe(uri);
      expect(env.summary).toBeUndefined();
      expect(env.errors.length).toBeGreaterThan(0);

      const exp = await client.callTool({
        name: 'grafana_dashboard_export',
        arguments: { uri },
      });
      const { dashboard } = JSON.parse(textContentOf(exp)) as {
        dashboard: { title: string; panels: Array<{ title: string }> };
      };
      expect(dashboard.title).toBe('unchanged-on-failure');
      expect(dashboard.panels[0]?.title).toBe('orig');
    });

    it.each([
      ['grafana_dashboard_panel_insert', { panel: { type: 'timeseries', title: 'X' } }],
      ['grafana_dashboard_panel_update', { panelId: 1, patch: { title: 'X' } }],
      [
        'grafana_dashboard_panel_move',
        { panelId: 1, to: { mode: 'gridPos', x: 0, y: 0, w: 12, h: 8 } },
      ],
      ['grafana_dashboard_panel_remove', { panelId: 1 }],
      ['grafana_dashboard_variable_rename', { oldName: 'a', newName: 'b' }],
    ])('%s rejects both dashboard and dashboardUri (mutual exclusion)', async (tool, extraArgs) => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, {
        title: 'd',
        panels: [{ id: 1, type: 'timeseries', title: 'X' }],
        templating: { list: [{ name: 'a', type: 'query' }] },
      });
      const result = await client.callTool({
        name: tool,
        arguments: {
          dashboard: { title: 'inline', panels: [] },
          dashboardUri: uri,
          ...(extraArgs as Record<string, unknown>),
        },
      });
      const env = JSON.parse(textContentOf(result)) as {
        errors?: Array<{ code: string }>;
      };
      expect(env.errors?.[0]?.code).toBe('both-provided');
    });

    it('write tools surface unknown-uri as a structured error and do not mutate', async () => {
      const client = await connectedClient();
      const result = await client.callTool({
        name: 'grafana_dashboard_panel_update',
        arguments: {
          dashboardUri: 'mcp://grafana/session/dashboard/999',
          panelId: 1,
          patch: { title: 'x' },
        },
      });
      const env = JSON.parse(textContentOf(result)) as {
        errors?: Array<{ code: string }>;
      };
      expect(env.errors?.[0]?.code).toBe('unknown-uri');
    });

    it('write tools reject both dashboard and dashboardUri (mutual exclusion)', async () => {
      const client = await connectedClient();
      const uri = await loadAndGetUri(client, { title: 'd', panels: [] });

      const result = await client.callTool({
        name: 'grafana_dashboard_panel_insert',
        arguments: {
          dashboard: { title: 'inline', panels: [] },
          dashboardUri: uri,
          panel: { type: 'timeseries', title: 'X' },
        },
      });
      const env = JSON.parse(textContentOf(result)) as {
        errors?: Array<{ code: string }>;
      };
      expect(env.errors?.[0]?.code).toBe('both-provided');
    });
  });
});
