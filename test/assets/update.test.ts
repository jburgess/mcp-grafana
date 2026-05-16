import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { updatePanel } from '../../src/assets/update.js';

const dashboardWithPanel = () => ({
  title: 'Service',
  panels: [
    {
      id: 1,
      type: 'timeseries',
      title: 'HTTP requests',
      description: 'old description',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      fieldConfig: {
        defaults: {
          unit: 'reqps',
          color: { mode: 'palette-classic' },
          thresholds: { mode: 'absolute', steps: [{ color: 'green', value: 0 }] },
        },
      },
      targets: [{ expr: 'rate(http_requests_total[5m])', refId: 'A' }],
    },
  ],
});

const panelAt = (dashboard: unknown, i: number) =>
  (dashboard as { panels: Array<Record<string, unknown>> }).panels[i];

describe('updatePanel - set scalar fields', () => {
  it('sets description without touching other fields', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, { description: 'new description' });

    expect(result.errors).toEqual([]);
    const updated = panelAt(result.dashboard, 0);
    expect(updated?.description).toBe('new description');
    expect(updated?.title).toBe('HTTP requests'); // unchanged
    expect(updated?.targets).toHaveLength(1); // unchanged
  });

  it('sets multiple fields at once', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, {
      description: 'new',
      title: 'Renamed',
    });

    const updated = panelAt(result.dashboard, 0);
    expect(updated?.description).toBe('new');
    expect(updated?.title).toBe('Renamed');
  });
});

describe('updatePanel - deep merge', () => {
  it('changes unit without losing other fieldConfig.defaults siblings', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, {
      fieldConfig: { defaults: { unit: 'decbytes' } },
    });

    expect(result.errors).toEqual([]);
    const updated = panelAt(result.dashboard, 0);
    const defaults = (updated?.fieldConfig as { defaults?: Record<string, unknown> })?.defaults;
    expect(defaults?.unit).toBe('decbytes');
    // color preserved (sibling under defaults)
    expect(defaults?.color).toEqual({ mode: 'palette-classic' });
    // thresholds preserved
    expect(defaults?.thresholds).toEqual({
      mode: 'absolute',
      steps: [{ color: 'green', value: 0 }],
    });
  });

  it('deep-merges a nested object that did not exist on the target', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, {
      fieldConfig: { defaults: { custom: { lineWidth: 3 } } },
    });

    const updated = panelAt(result.dashboard, 0);
    const defaults = (updated?.fieldConfig as { defaults?: Record<string, unknown> })?.defaults;
    expect(defaults?.custom).toEqual({ lineWidth: 3 });
    expect(defaults?.unit).toBe('reqps'); // unchanged
  });
});

describe('updatePanel - null clears (RFC 7396)', () => {
  it('clears description when patch.description is null', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, { description: null });

    const updated = panelAt(result.dashboard, 0);
    expect(updated?.description).toBeUndefined();
    expect('description' in (updated ?? {})).toBe(false);
  });

  it('clears a nested field via null', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, {
      fieldConfig: { defaults: { unit: null } },
    });

    const updated = panelAt(result.dashboard, 0);
    const defaults = (updated?.fieldConfig as { defaults?: Record<string, unknown> })?.defaults;
    expect(defaults?.unit).toBeUndefined();
    expect('unit' in (defaults ?? {})).toBe(false);
    // siblings still intact
    expect(defaults?.color).toEqual({ mode: 'palette-classic' });
  });

  it('null on a field that does not exist is a no-op', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, { nonexistent: null });

    expect(result.errors).toEqual([]);
    const updated = panelAt(result.dashboard, 0);
    expect('nonexistent' in (updated ?? {})).toBe(false);
  });
});

describe('updatePanel - arrays replace wholesale (RFC 7396)', () => {
  it('replaces targets with the patch value rather than merging element-wise', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, {
      targets: [
        { expr: 'sum(rate(http_requests_total{status=~"5.."}[5m]))', refId: 'A' },
        { expr: 'sum(rate(http_requests_total[5m]))', refId: 'B' },
      ],
    });

    const updated = panelAt(result.dashboard, 0);
    const targets = updated?.targets as Array<{ expr: string; refId: string }>;
    expect(targets).toHaveLength(2);
    expect(targets[0]?.expr).toContain('5..');
    expect(targets[0]?.refId).toBe('A');
  });

  it('replaces thresholds.steps wholesale, not merging step-by-step', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, {
      fieldConfig: {
        defaults: {
          thresholds: { mode: 'absolute', steps: [{ color: 'red', value: 100 }] },
        },
      },
    });

    const updated = panelAt(result.dashboard, 0);
    const defaults = (updated?.fieldConfig as { defaults?: Record<string, unknown> })?.defaults;
    const thresholds = defaults?.thresholds as { mode: string; steps: Array<{ color: string; value: number }> };
    expect(thresholds.steps).toHaveLength(1);
    expect(thresholds.steps[0]).toEqual({ color: 'red', value: 100 });
  });
});

describe('updatePanel - row-nested panel targeting', () => {
  it('updates a panel nested inside a row (legacy format)', () => {
    const dashboard = {
      title: 't',
      panels: [
        {
          id: 10,
          type: 'row',
          title: 'Section',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            { id: 99, type: 'timeseries', title: 'Old', gridPos: { x: 0, y: 1, w: 12, h: 8 } },
          ],
        },
      ],
    };
    const result = updatePanel(dashboard, 99, { title: 'New' });

    expect(result.errors).toEqual([]);
    const updated = (result.dashboard as { panels: Array<{ panels?: Array<{ title: string }> }> })
      .panels[0]?.panels?.[0];
    expect(updated?.title).toBe('New');
  });

  it('updates a row panel itself by its id', () => {
    const dashboard = {
      title: 't',
      panels: [
        {
          id: 10,
          type: 'row',
          title: 'Old section',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
        },
      ],
    };
    const result = updatePanel(dashboard, 10, { title: 'New section' });

    const updated = (result.dashboard as { panels: Array<{ title: string }> }).panels[0];
    expect(updated?.title).toBe('New section');
  });
});

describe('updatePanel - errors', () => {
  it('returns a clear error for unknown panelId', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 999, { description: 'x' });

    expect(result.dashboard).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('panelId');
    expect(result.errors[0]?.message).toMatch(/999/);
  });

  it('rejects a non-object dashboard', () => {
    const result = updatePanel('nope', 1, { x: 1 });
    expect(result.errors[0]?.message).toMatch(/dashboard/i);
  });

  it('rejects a non-object patch', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, 'not an object');
    expect(result.errors[0]?.message).toMatch(/patch/i);
  });

  it('rejects an array patch (RFC 7396: top-level patch must be an object)', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, [{ description: 'x' }]);
    expect(result.errors[0]?.message).toMatch(/patch/i);
  });
});

describe('updatePanel - immutability', () => {
  it('does not mutate the input dashboard', () => {
    const dashboard = dashboardWithPanel();
    const before = JSON.parse(JSON.stringify(dashboard));
    updatePanel(dashboard, 1, { description: 'new' });
    expect(dashboard).toEqual(before);
  });

  it('does not mutate the input patch', () => {
    const dashboard = dashboardWithPanel();
    const patch = { fieldConfig: { defaults: { unit: 'decbytes' } } };
    const patchBefore = JSON.parse(JSON.stringify(patch));
    updatePanel(dashboard, 1, patch);
    expect(patch).toEqual(patchBefore);
  });

  it('returned dashboard.panels has a different array reference', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, { description: 'new' });
    expect((result.dashboard as { panels: unknown[] }).panels).not.toBe(dashboard.panels);
  });
});

describe('updatePanel - empty patch', () => {
  it('is a structural no-op (returns the same content in a new object)', () => {
    const dashboard = dashboardWithPanel();
    const result = updatePanel(dashboard, 1, {});

    expect(result.errors).toEqual([]);
    expect(result.dashboard).toEqual(dashboard);
    expect(result.dashboard).not.toBe(dashboard);
  });
});

describe('updatePanel - against real fixture (Node Exporter Full)', () => {
  it('patches the description on a nested panel without losing siblings', () => {
    const dashboard = JSON.parse(
      readFileSync(new URL('../fixtures/node-exporter-full.json', import.meta.url), 'utf8'),
    ) as { panels: Array<{ id: number; panels?: Array<{ id: number }> }> };

    // Pick a nested panel from a legacy-format row
    const cpuRow = dashboard.panels.find((p) => p.id === 265);
    const targetId = cpuRow?.panels?.[0]?.id;
    expect(targetId).toBeDefined();

    const result = updatePanel(dashboard, targetId!, {
      description: 'Updated by panel_update test',
    });

    expect(result.errors).toEqual([]);
    const top = (result.dashboard as { panels: Array<{ id: number; panels?: Array<{ id: number; description?: string }> }> })
      .panels.find((p) => p.id === 265);
    const patched = top?.panels?.[0];
    expect(patched?.description).toBe('Updated by panel_update test');
  });
});
