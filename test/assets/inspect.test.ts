import { describe, expect, it } from 'vitest';

import { inspectDashboard } from '../../src/assets/inspect.js';

const fixture = {
  title: 'HTTP service',
  uid: 'http-service-dash',
  templating: {
    list: [
      { name: 'env', type: 'custom', current: { value: 'prod' } },
      { name: 'service', type: 'query', current: { value: 'auth' } },
    ],
  },
  panels: [
    { id: 1, type: 'row', title: 'Overview', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
    {
      id: 2,
      type: 'timeseries',
      title: 'HTTP: requests',
      description: 'Request rate',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 0, y: 1, w: 12, h: 8 },
      datasource: { uid: 'prom-uid', type: 'prometheus' },
      targets: [{ expr: 'rate(http_requests_total[$__rate_interval])' }],
    },
    {
      id: 3,
      type: 'timeseries',
      title: 'HTTP: errors',
      description: '5xx error rate',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 12, y: 1, w: 12, h: 8 },
      datasource: { uid: 'prom-uid', type: 'prometheus' },
      targets: [
        { expr: 'rate(http_requests_total{status=~"5.."}[$__rate_interval])' },
      ],
    },
    {
      id: 4,
      type: 'timeseries',
      title: 'HTTP: latency p99',
      // description missing — should count toward panelsMissingDescription
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 0, y: 9, w: 12, h: 4 },
      datasource: { uid: 'prom-uid', type: 'prometheus' },
      targets: [
        { expr: 'histogram_quantile(0.99, ...)' },
        { expr: 'histogram_quantile(0.95, ...)' },
      ],
    },
    {
      id: 5,
      type: 'stat',
      title: 'Memory in use',
      description: 'RSS bytes',
      fieldConfig: { defaults: { unit: 'bytes' } },
      gridPos: { x: 12, y: 9, w: 6, h: 4 },
      datasource: { uid: 'prom-uid', type: 'prometheus' },
      targets: [{ expr: 'process_resident_memory_bytes' }],
    },
    {
      id: 6,
      type: 'stat',
      title: 'Heap size',
      // description missing
      fieldConfig: { defaults: { unit: 'bytes' } },
      gridPos: { x: 18, y: 9, w: 6, h: 4 },
      datasource: { uid: 'prom-uid', type: 'prometheus' },
      targets: [{ expr: 'go_memstats_heap_inuse_bytes' }],
    },
  ],
};

describe('inspectDashboard - summary (default)', () => {
  it('returns title, uid, panelCount', () => {
    const result = inspectDashboard(fixture);
    expect(result.detail).toBe('summary');
    if (result.detail !== 'summary') return; // narrow

    expect(result.title).toBe('HTTP service');
    expect(result.uid).toBe('http-service-dash');
    expect(result.panelCount).toBe(6);
  });

  it('returns the variable names from templating.list', () => {
    const result = inspectDashboard(fixture, { detail: 'summary' });
    if (result.detail !== 'summary') return;
    expect(result.variableNames).toEqual(['env', 'service']);
  });

  it('returns unique datasource refs', () => {
    const result = inspectDashboard(fixture, { detail: 'summary' });
    if (result.detail !== 'summary') return;
    expect(result.datasourceRefs).toEqual(['prom-uid']);
  });

  it('returns layout bounds from panel gridPos', () => {
    const result = inspectDashboard(fixture, { detail: 'summary' });
    if (result.detail !== 'summary') return;
    expect(result.layoutBounds).toEqual({ width: 24, height: 13 });
  });

  it('counts panels missing a description (excluding row panels)', () => {
    const result = inspectDashboard(fixture, { detail: 'summary' });
    if (result.detail !== 'summary') return;
    // panels 4 and 6 are missing descriptions; row panel 1 is excluded
    expect(result.panelsMissingDescription).toBe(2);
  });

  it('detects top naming patterns by colon prefix', () => {
    const result = inspectDashboard(fixture, { detail: 'summary' });
    if (result.detail !== 'summary') return;
    // 3 panels share the "HTTP:" prefix
    const httpPattern = result.namingPatterns.find((p) => p.prefix === 'HTTP');
    expect(httpPattern).toBeDefined();
    expect(httpPattern?.count).toBe(3);
  });

  it('summary output is bounded: no per-panel arrays', () => {
    const result = inspectDashboard(fixture, { detail: 'summary' });
    // summary should be a small headline object; no `panels` array
    expect((result as { panels?: unknown }).panels).toBeUndefined();
  });
});

describe('inspectDashboard - panels', () => {
  it('returns one row per panel with first-class description', () => {
    const result = inspectDashboard(fixture, { detail: 'panels' });
    expect(result.detail).toBe('panels');
    if (result.detail !== 'panels') return;

    expect(result.panels).toHaveLength(6);
    const requestsRow = result.panels.find((p) => p.id === 2);
    expect(requestsRow?.title).toBe('HTTP: requests');
    expect(requestsRow?.type).toBe('timeseries');
    expect(requestsRow?.description).toBe('Request rate');
    expect(requestsRow?.unit).toBe('reqps');
    expect(requestsRow?.targetCount).toBe(1);
    expect(requestsRow?.datasource).toBe('prom-uid');
  });

  it('reports targetCount per panel', () => {
    const result = inspectDashboard(fixture, { detail: 'panels' });
    if (result.detail !== 'panels') return;
    const latencyRow = result.panels.find((p) => p.id === 4);
    expect(latencyRow?.targetCount).toBe(2);
  });

  it('description is undefined for panels missing it (not empty string)', () => {
    const result = inspectDashboard(fixture, { detail: 'panels' });
    if (result.detail !== 'panels') return;
    const latencyRow = result.panels.find((p) => p.id === 4);
    expect(latencyRow?.description).toBeUndefined();
  });
});

describe('inspectDashboard - conventions', () => {
  it('returns a panel size histogram keyed by WxH', () => {
    const result = inspectDashboard(fixture, { detail: 'conventions' });
    expect(result.detail).toBe('conventions');
    if (result.detail !== 'conventions') return;

    // panels: 2 at 12x8, 1 at 12x4, 2 at 6x4, 1 row at 24x1
    expect(result.panelSizeHistogram).toEqual({
      '12x8': 2,
      '12x4': 1,
      '6x4': 2,
      '24x1': 1,
    });
  });

  it('returns top units in count-descending order', () => {
    const result = inspectDashboard(fixture, { detail: 'conventions' });
    if (result.detail !== 'conventions') return;
    expect(result.topUnits[0]).toEqual({ unit: 'reqps', count: 3 });
    expect(result.topUnits[1]).toEqual({ unit: 'bytes', count: 2 });
  });

  it('returns top panel types', () => {
    const result = inspectDashboard(fixture, { detail: 'conventions' });
    if (result.detail !== 'conventions') return;
    const types = Object.fromEntries(
      result.topPanelTypes.map((t) => [t.type, t.count]),
    );
    expect(types.timeseries).toBe(3);
    expect(types.stat).toBe(2);
    expect(types.row).toBe(1);
  });

  it('returns variables with name, type, default', () => {
    const result = inspectDashboard(fixture, { detail: 'conventions' });
    if (result.detail !== 'conventions') return;
    expect(result.variables).toEqual([
      { name: 'env', type: 'custom', default: 'prod' },
      { name: 'service', type: 'query', default: 'auth' },
    ]);
  });

  it('returns rowCount based on type=row panels', () => {
    const result = inspectDashboard(fixture, { detail: 'conventions' });
    if (result.detail !== 'conventions') return;
    expect(result.rowCount).toBe(1);
  });
});

describe('inspectDashboard - edge cases', () => {
  it('handles a dashboard with no panels', () => {
    const result = inspectDashboard({ title: 'Empty' });
    if (result.detail !== 'summary') return;
    expect(result.panelCount).toBe(0);
    expect(result.layoutBounds).toEqual({ width: 0, height: 0 });
    expect(result.panelsMissingDescription).toBe(0);
    expect(result.namingPatterns).toEqual([]);
  });

  it('handles a dashboard with no variables', () => {
    const result = inspectDashboard({ title: 'No vars', panels: [] });
    if (result.detail !== 'summary') return;
    expect(result.variableNames).toEqual([]);
  });

  it('handles string-form datasource (legacy)', () => {
    const result = inspectDashboard({
      title: 'Legacy ds',
      panels: [
        { id: 1, type: 'timeseries', title: 't', datasource: 'Prometheus-legacy', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
      ],
    }, { detail: 'panels' });
    if (result.detail !== 'panels') return;
    expect(result.panels[0]?.datasource).toBe('Prometheus-legacy');
  });
});
