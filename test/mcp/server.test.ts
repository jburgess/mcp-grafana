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

  it('lists all eleven registered tools', async () => {
    const client = await connectedClient();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('grafana_dashboard_build');
    expect(names).toContain('grafana_dashboard_inspect');
    expect(names).toContain('grafana_dashboard_panel_insert');
    expect(names).toContain('grafana_dashboard_panel_move');
    expect(names).toContain('grafana_dashboard_panel_remove');
    expect(names).toContain('grafana_dashboard_panel_update');
    expect(names).toContain('grafana_dashboard_validate');
    expect(names).toContain('grafana_dashboard_variable_rename');
    expect(names).toContain('grafana_panel_validate');
    expect(names).toContain('prometheus_metric_parse');
    expect(names).toContain('grafana_timeseries_panel_build');
  });
});
