import { describe, expect, it } from 'vitest';

import { diffDashboards } from '../../src/assets/diff.js';

// A small two-panel dashboard reused as the "before" baseline across cases.
function baseDashboard() {
  return {
    title: 'HTTP service',
    uid: 'http-dash',
    tags: ['http', 'prod'],
    timezone: 'utc',
    templating: { list: [{ name: 'env' }, { name: 'service' }] },
    panels: [
      {
        id: 1,
        type: 'timeseries',
        title: 'Requests',
        description: 'Request rate',
        fieldConfig: { defaults: { unit: 'reqps' } },
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        datasource: { uid: 'prom' },
        targets: [{ expr: 'rate(http_requests_total[5m])' }],
      },
      {
        id: 2,
        type: 'stat',
        title: 'Errors',
        fieldConfig: { defaults: { unit: 'short' } },
        gridPos: { x: 12, y: 0, w: 12, h: 8 },
        datasource: { uid: 'prom' },
        targets: [{ expr: 'sum(rate(errors_total[5m]))' }],
      },
    ],
  };
}

describe('diffDashboards', () => {
  it('reports no changes for identical dashboards', () => {
    const d = baseDashboard();
    const diff = diffDashboards(d, baseDashboard());
    expect(diff.panelsAdded).toEqual([]);
    expect(diff.panelsRemoved).toEqual([]);
    expect(diff.panelsChanged).toEqual([]);
    expect(diff.dashboardChanges).toEqual([]);
  });

  it('detects an added panel', () => {
    const before = baseDashboard();
    const after = baseDashboard();
    after.panels.push({
      id: 3,
      type: 'gauge',
      title: 'Saturation',
      fieldConfig: { defaults: { unit: 'percent' } },
      gridPos: { x: 0, y: 8, w: 12, h: 8 },
      datasource: { uid: 'prom' },
      targets: [{ expr: 'cpu' }],
    });
    const diff = diffDashboards(before, after);
    expect(diff.panelsAdded).toHaveLength(1);
    expect(diff.panelsAdded[0]?.id).toBe(3);
    expect(diff.panelsAdded[0]?.title).toBe('Saturation');
    expect(diff.panelsRemoved).toEqual([]);
    expect(diff.panelsChanged).toEqual([]);
  });

  it('detects a removed panel', () => {
    const before = baseDashboard();
    const after = baseDashboard();
    after.panels.pop();
    const diff = diffDashboards(before, after);
    expect(diff.panelsRemoved).toHaveLength(1);
    expect(diff.panelsRemoved[0]?.id).toBe(2);
    expect(diff.panelsAdded).toEqual([]);
  });

  it('detects a per-panel unit change with before/after values', () => {
    const before = baseDashboard();
    const after = baseDashboard();
    after.panels[0]!.fieldConfig.defaults.unit = 'cps';
    const diff = diffDashboards(before, after);
    expect(diff.panelsChanged).toHaveLength(1);
    const change = diff.panelsChanged[0]!;
    expect(change.id).toBe(1);
    expect(change.title).toBe('Requests');
    const unitChange = change.changes.find((c) => c.field === 'unit');
    expect(unitChange).toEqual({ field: 'unit', before: 'reqps', after: 'cps' });
  });

  it('detects a datasource swap', () => {
    const before = baseDashboard();
    const after = baseDashboard();
    after.panels[0]!.datasource = { uid: 'mimir' };
    const diff = diffDashboards(before, after);
    expect(diff.panelsChanged).toHaveLength(1);
    const dsChange = diff.panelsChanged[0]!.changes.find((c) => c.field === 'datasource');
    expect(dsChange).toEqual({ field: 'datasource', before: 'prom', after: 'mimir' });
  });

  it('detects a query (targets) change', () => {
    const before = baseDashboard();
    const after = baseDashboard();
    after.panels[0]!.targets = [{ expr: 'rate(http_requests_total[10m])' }];
    const diff = diffDashboards(before, after);
    const targetsChange = diff.panelsChanged[0]!.changes.find((c) => c.field === 'targets');
    expect(targetsChange?.field).toBe('targets');
    expect(JSON.stringify(targetsChange?.after)).toContain('10m');
  });

  it('ignores panel array reordering when ids are stable', () => {
    const before = baseDashboard();
    const after = baseDashboard();
    after.panels.reverse();
    // gridPos is unchanged on each panel; only array order differs. Since
    // panels match by id, no panel should register as changed.
    const diff = diffDashboards(before, after);
    expect(diff.panelsChanged).toEqual([]);
    expect(diff.panelsAdded).toEqual([]);
    expect(diff.panelsRemoved).toEqual([]);
  });

  it('reports dashboard-level title and uid changes', () => {
    const before = baseDashboard();
    const after = baseDashboard();
    after.title = 'HTTP service (v2)';
    after.uid = 'http-dash-v2';
    const diff = diffDashboards(before, after);
    const fields = diff.dashboardChanges.map((c) => c.field).sort();
    expect(fields).toEqual(['title', 'uid']);
    const titleChange = diff.dashboardChanges.find((c) => c.field === 'title');
    expect(titleChange).toEqual({
      field: 'title',
      before: 'HTTP service',
      after: 'HTTP service (v2)',
    });
  });

  it('treats tags as a set (reordering tags is not a change)', () => {
    const before = baseDashboard();
    const after = baseDashboard();
    after.tags = ['prod', 'http'];
    const diff = diffDashboards(before, after);
    expect(diff.dashboardChanges).toEqual([]);
  });

  it('reports a real tag addition', () => {
    const before = baseDashboard();
    const after = baseDashboard();
    after.tags = ['http', 'prod', 'team-a'];
    const diff = diffDashboards(before, after);
    const tagChange = diff.dashboardChanges.find((c) => c.field === 'tags');
    expect(tagChange).toEqual({
      field: 'tags',
      before: ['http', 'prod'],
      after: ['http', 'prod', 'team-a'],
    });
  });

  it('reports a variable rename via the variableNames list', () => {
    const before = baseDashboard();
    const after = baseDashboard();
    after.templating.list = [{ name: 'environment' }, { name: 'service' }];
    const diff = diffDashboards(before, after);
    const varChange = diff.dashboardChanges.find((c) => c.field === 'variableNames');
    expect(varChange).toEqual({
      field: 'variableNames',
      before: ['env', 'service'],
      after: ['environment', 'service'],
    });
  });

  it('matches id-less panels by title', () => {
    const before = { panels: [{ type: 'stat', title: 'KPI', fieldConfig: { defaults: { unit: 'short' } } }] };
    const after = { panels: [{ type: 'stat', title: 'KPI', fieldConfig: { defaults: { unit: 'percent' } } }] };
    const diff = diffDashboards(before, after);
    expect(diff.panelsChanged).toHaveLength(1);
    expect(diff.panelsChanged[0]?.title).toBe('KPI');
    expect(diff.panelsChanged[0]?.id).toBeUndefined();
    expect(diff.panelsChanged[0]?.changes.find((c) => c.field === 'unit')).toEqual({
      field: 'unit',
      before: 'short',
      after: 'percent',
    });
  });

  it('handles non-object inputs as empty dashboards', () => {
    const after = baseDashboard();
    const diff = diffDashboards(null, after);
    expect(diff.panelsAdded).toHaveLength(2);
    expect(diff.panelsRemoved).toEqual([]);
  });

  it('detects a panel moved to a different row (rowId change)', () => {
    const before = {
      panels: [
        { id: 10, type: 'row', title: 'A' },
        { id: 1, type: 'stat', title: 'KPI', gridPos: { x: 0, y: 1, w: 6, h: 4 } },
        { id: 20, type: 'row', title: 'B' },
      ],
    };
    const after = {
      panels: [
        { id: 10, type: 'row', title: 'A' },
        { id: 20, type: 'row', title: 'B' },
        { id: 1, type: 'stat', title: 'KPI', gridPos: { x: 0, y: 1, w: 6, h: 4 } },
      ],
    };
    const diff = diffDashboards(before, after);
    const rowChange = diff.panelsChanged.find((c) => c.id === 1);
    expect(rowChange?.changes.find((c) => c.field === 'rowId')).toEqual({
      field: 'rowId',
      before: 10,
      after: 20,
    });
  });
});
