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

  // Issue #31 item 7: include each panel's targets so audit workflows don't
  // need a follow-up call into the raw dashboard JSON. Each expr is bounded
  // so a huge query doesn't blow up the response budget.
  it('includes target expressions, legend formats, and refIds', () => {
    const result = inspectDashboard(fixture, { detail: 'panels' });
    if (result.detail !== 'panels') return;
    const requestsRow = result.panels.find((p) => p.id === 2);
    expect(requestsRow?.targets).toEqual([
      { expr: 'rate(http_requests_total[$__rate_interval])' },
    ]);
    const latencyRow = result.panels.find((p) => p.id === 4);
    expect(latencyRow?.targets).toEqual([
      { expr: 'histogram_quantile(0.99, ...)' },
      { expr: 'histogram_quantile(0.95, ...)' },
    ]);
  });

  it('omits the targets field entirely when a panel has no targets', () => {
    const dash = {
      title: 't',
      panels: [
        { id: 1, type: 'row', title: 'R', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
      ],
    };
    const result = inspectDashboard(dash, { detail: 'panels' });
    if (result.detail !== 'panels') return;
    expect(result.panels[0]?.targets).toBeUndefined();
  });

  it('caps each expr at 512 characters with an ellipsis marker when truncated', () => {
    const longExpr = `${'a'.repeat(600)}`;
    const dash = {
      title: 't',
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'long',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [{ expr: longExpr, refId: 'A' }],
        },
      ],
    };
    const result = inspectDashboard(dash, { detail: 'panels' });
    if (result.detail !== 'panels') return;
    const t = result.panels[0]?.targets?.[0];
    expect(t?.expr).toHaveLength(512);
    expect(t?.expr?.endsWith('…')).toBe(true);
    expect(t?.refId).toBe('A');
  });

  it('falls back across expr → query → rawQuery so non-Prometheus targets surface too', () => {
    // Matches validate.ts:158 which scans the same field set for variable refs.
    const dash = {
      title: 't',
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 't',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [
            { expr: 'up', legendFormat: '{{instance}}', refId: 'A' },
            { query: 'sum by (job) (up)', refId: 'B' }, // Loki / generic
            { rawQuery: 'select 1', refId: 'C' }, // SQL
          ],
        },
      ],
    };
    const result = inspectDashboard(dash, { detail: 'panels' });
    if (result.detail !== 'panels') return;
    expect(result.panels[0]?.targets).toEqual([
      { expr: 'up', legendFormat: '{{instance}}', refId: 'A' },
      { expr: 'sum by (job) (up)', refId: 'B' },
      { expr: 'select 1', refId: 'C' },
    ]);
  });
});

// Issue #31 item 11: `panelsMissingDescription` undercounts panels with
// `description: ""` (treats absent and empty inconsistently). Grafana's UI
// renders both the same; the count should too.
describe('inspectDashboard - empty-string description treated as missing (issue #31)', () => {
  const emptyDescFixture = {
    title: 'has empties',
    panels: [
      {
        id: 1,
        type: 'timeseries',
        title: 'absent desc',
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
      },
      {
        id: 2,
        type: 'timeseries',
        title: 'empty desc',
        description: '',
        gridPos: { x: 12, y: 0, w: 12, h: 8 },
      },
      {
        id: 3,
        type: 'timeseries',
        title: 'real desc',
        description: 'a real description',
        gridPos: { x: 0, y: 8, w: 12, h: 8 },
      },
    ],
  };

  it('summary.panelsMissingDescription counts empty-string and absent the same', () => {
    const result = inspectDashboard(emptyDescFixture);
    if (result.detail !== 'summary') return;
    expect(result.panelsMissingDescription).toBe(2);
  });

  it('panels view omits description when empty-string (mirrors absent)', () => {
    const result = inspectDashboard(emptyDescFixture, { detail: 'panels' });
    if (result.detail !== 'panels') return;
    expect(result.panels.find((p) => p.id === 1)?.description).toBeUndefined();
    expect(result.panels.find((p) => p.id === 2)?.description).toBeUndefined();
    expect(result.panels.find((p) => p.id === 3)?.description).toBe('a real description');
  });
});

describe('inspectDashboard - conventions', () => {
  it('returns a panel size histogram keyed by WxH', () => {
    const result = inspectDashboard(fixture, { detail: 'conventions' });
    expect(result.detail).toBe('conventions');
    if (result.detail !== 'conventions') return;

    // panels: 2 at 12x8, 1 at 12x4, 2 at 6x4. Row panel (24x1) excluded —
    // row panels are section markers, not visualizations, and would drown
    // out the real distribution.
    expect(result.panelSizeHistogram).toEqual({
      '12x8': 2,
      '12x4': 1,
      '6x4': 2,
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

  // Issue #31 item 12: stat panels often use graphMode and colorMode to
  // express "KPI with trend" (sparkline area + colored value). The
  // conventions view should surface this so a reviewer doesn't grade a
  // stat-heavy dashboard as flat KPIs when it's actually trended KPIs.
  it('tallies stat panel graphMode and colorMode into histograms', () => {
    const dash = {
      title: 't',
      panels: [
        {
          id: 1,
          type: 'stat',
          title: 'a',
          gridPos: { x: 0, y: 0, w: 6, h: 4 },
          options: { graphMode: 'area', colorMode: 'value' },
        },
        {
          id: 2,
          type: 'stat',
          title: 'b',
          gridPos: { x: 6, y: 0, w: 6, h: 4 },
          options: { graphMode: 'area', colorMode: 'value' },
        },
        {
          id: 3,
          type: 'stat',
          title: 'c',
          gridPos: { x: 12, y: 0, w: 6, h: 4 },
          options: { graphMode: 'none', colorMode: 'background' },
        },
        // non-stat panel should not contribute
        {
          id: 4,
          type: 'timeseries',
          title: 'ts',
          gridPos: { x: 18, y: 0, w: 6, h: 4 },
          options: { graphMode: 'area' },
        },
      ],
    };
    const result = inspectDashboard(dash, { detail: 'conventions' });
    if (result.detail !== 'conventions') return;
    expect(result.statGraphModes).toEqual({ area: 2, none: 1 });
    expect(result.statColorModes).toEqual({ value: 2, background: 1 });
  });

  it('stat-mode histograms are empty objects when no stat panels are present', () => {
    const result = inspectDashboard(fixture, { detail: 'conventions' });
    if (result.detail !== 'conventions') return;
    // fixture has 2 stat panels but no options — both keys should be {}
    expect(result.statGraphModes).toEqual({});
    expect(result.statColorModes).toEqual({});
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

describe('inspectDashboard - row membership (legacy nested + modern flat)', () => {
  const legacyNested = {
    title: 'Legacy nested',
    panels: [
      {
        id: 10,
        type: 'row',
        title: 'CPU',
        gridPos: { x: 0, y: 0, w: 24, h: 1 },
        panels: [
          { id: 11, type: 'timeseries', title: 'CPU usage', gridPos: { x: 0, y: 1, w: 12, h: 8 } },
          { id: 12, type: 'timeseries', title: 'Load', gridPos: { x: 12, y: 1, w: 12, h: 8 } },
        ],
      },
      {
        id: 20,
        type: 'row',
        title: 'Memory',
        gridPos: { x: 0, y: 9, w: 24, h: 1 },
        panels: [
          { id: 21, type: 'stat', title: 'RSS', gridPos: { x: 0, y: 10, w: 6, h: 4 } },
        ],
      },
    ],
  };

  const modernFlat = {
    title: 'Modern flat',
    // Row panels are at the top level alongside their (logical) children.
    // Row membership is implied by array order: panels following a row belong
    // to it until the next row.
    panels: [
      { id: 10, type: 'row', title: 'CPU', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
      { id: 11, type: 'timeseries', title: 'CPU usage', gridPos: { x: 0, y: 1, w: 12, h: 8 } },
      { id: 12, type: 'timeseries', title: 'Load', gridPos: { x: 12, y: 1, w: 12, h: 8 } },
      { id: 20, type: 'row', title: 'Memory', gridPos: { x: 0, y: 9, w: 24, h: 1 } },
      { id: 21, type: 'stat', title: 'RSS', gridPos: { x: 0, y: 10, w: 6, h: 4 } },
    ],
  };

  const mixedFormat = {
    title: 'Mixed (like Node Exporter Full)',
    panels: [
      // Modern-style row: members are siblings following in array order
      { id: 10, type: 'row', title: 'Quick stats', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
      { id: 11, type: 'stat', title: 'CPU%', gridPos: { x: 0, y: 1, w: 6, h: 4 } },
      { id: 12, type: 'stat', title: 'MEM%', gridPos: { x: 6, y: 1, w: 6, h: 4 } },
      // Legacy-style row: members are inside row.panels[]
      {
        id: 20,
        type: 'row',
        title: 'Details',
        gridPos: { x: 0, y: 5, w: 24, h: 1 },
        panels: [
          { id: 21, type: 'timeseries', title: 'CPU detail', gridPos: { x: 0, y: 6, w: 24, h: 8 } },
        ],
      },
    ],
  };

  describe('summary.rows', () => {
    it('lists every row with title and child count (legacy nested)', () => {
      const result = inspectDashboard(legacyNested);
      if (result.detail !== 'summary') return;
      expect(result.rows).toEqual([
        { id: 10, title: 'CPU', panelCount: 2 },
        { id: 20, title: 'Memory', panelCount: 1 },
      ]);
    });

    it('lists every row with title and child count (modern flat)', () => {
      const result = inspectDashboard(modernFlat);
      if (result.detail !== 'summary') return;
      expect(result.rows).toEqual([
        { id: 10, title: 'CPU', panelCount: 2 },
        { id: 20, title: 'Memory', panelCount: 1 },
      ]);
    });

    it('handles mixed legacy + modern formats in the same dashboard', () => {
      const result = inspectDashboard(mixedFormat);
      if (result.detail !== 'summary') return;
      expect(result.rows).toEqual([
        { id: 10, title: 'Quick stats', panelCount: 2 },
        { id: 20, title: 'Details', panelCount: 1 },
      ]);
    });

    it('returns empty rows array for a dashboard with no rows', () => {
      const result = inspectDashboard({
        title: 't',
        panels: [{ id: 1, type: 'timeseries', title: 'a', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
      });
      if (result.detail !== 'summary') return;
      expect(result.rows).toEqual([]);
    });
  });

  describe('PanelRow.rowId', () => {
    it('tags nested panels with their parent row id (legacy format)', () => {
      const result = inspectDashboard(legacyNested, { detail: 'panels' });
      if (result.detail !== 'panels') return;
      const cpuChild = result.panels.find((p) => p.id === 11);
      const loadChild = result.panels.find((p) => p.id === 12);
      const rssChild = result.panels.find((p) => p.id === 21);
      expect(cpuChild?.rowId).toBe(10);
      expect(loadChild?.rowId).toBe(10);
      expect(rssChild?.rowId).toBe(20);
    });

    it('tags following panels with the preceding row id (modern format)', () => {
      const result = inspectDashboard(modernFlat, { detail: 'panels' });
      if (result.detail !== 'panels') return;
      const cpuChild = result.panels.find((p) => p.id === 11);
      const loadChild = result.panels.find((p) => p.id === 12);
      const rssChild = result.panels.find((p) => p.id === 21);
      expect(cpuChild?.rowId).toBe(10);
      expect(loadChild?.rowId).toBe(10);
      expect(rssChild?.rowId).toBe(20);
    });

    it('row panels themselves have rowId undefined (rows are not inside rows)', () => {
      const result = inspectDashboard(legacyNested, { detail: 'panels' });
      if (result.detail !== 'panels') return;
      const cpuRow = result.panels.find((p) => p.id === 10);
      const memRow = result.panels.find((p) => p.id === 20);
      expect(cpuRow?.type).toBe('row');
      expect(cpuRow?.rowId).toBeUndefined();
      expect(memRow?.rowId).toBeUndefined();
    });

    it('top-level non-row panels before the first row have rowId undefined', () => {
      const dash = {
        title: 't',
        panels: [
          { id: 1, type: 'stat', title: 'header', gridPos: { x: 0, y: 0, w: 12, h: 4 } },
          { id: 10, type: 'row', title: 'R', gridPos: { x: 0, y: 4, w: 24, h: 1 } },
          { id: 11, type: 'timeseries', title: 'in row', gridPos: { x: 0, y: 5, w: 12, h: 8 } },
        ],
      };
      const result = inspectDashboard(dash, { detail: 'panels' });
      if (result.detail !== 'panels') return;
      const header = result.panels.find((p) => p.id === 1);
      const inRow = result.panels.find((p) => p.id === 11);
      expect(header?.rowId).toBeUndefined();
      expect(inRow?.rowId).toBe(10);
    });
  });
});

describe('inspectDashboard - row-nested panels', () => {
  // Production Grafana dashboards (e.g. Node Exporter Full, dashboard ID 1860)
  // place panels inside row panels via row.panels[]. The flat dashboard.panels[]
  // walk misses these — which makes panelCount, conventions, and per-panel
  // listings dramatically wrong on real dashboards. inspectDashboard must walk
  // nested panels recursively.
  const nestedFixture = {
    title: 'With rows',
    panels: [
      {
        id: 1,
        type: 'row',
        title: 'CPU',
        gridPos: { x: 0, y: 0, w: 24, h: 1 },
        panels: [
          {
            id: 2,
            type: 'timeseries',
            title: 'CPU usage',
            description: 'd',
            fieldConfig: { defaults: { unit: 'percent' } },
            gridPos: { x: 0, y: 1, w: 12, h: 8 },
            targets: [{ expr: 'rate(cpu[5m])' }],
          },
          {
            id: 3,
            type: 'timeseries',
            title: 'Load avg',
            description: 'd',
            fieldConfig: { defaults: { unit: 'short' } },
            gridPos: { x: 12, y: 1, w: 12, h: 8 },
            targets: [{ expr: 'load1' }],
          },
        ],
      },
      {
        id: 4,
        type: 'row',
        title: 'Memory',
        gridPos: { x: 0, y: 9, w: 24, h: 1 },
        panels: [
          {
            id: 5,
            type: 'stat',
            title: 'RSS',
            description: 'd',
            fieldConfig: { defaults: { unit: 'bytes' } },
            gridPos: { x: 0, y: 10, w: 6, h: 4 },
            targets: [{ expr: 'mem_rss' }],
          },
        ],
      },
    ],
  };

  it('counts nested panels in panelCount', () => {
    const result = inspectDashboard(nestedFixture);
    if (result.detail !== 'summary') return;
    // 2 rows + 3 nested panels = 5 total
    expect(result.panelCount).toBe(5);
  });

  it('includes nested panels in detail=panels output', () => {
    const result = inspectDashboard(nestedFixture, { detail: 'panels' });
    if (result.detail !== 'panels') return;
    expect(result.panels).toHaveLength(5);
    const cpuPanel = result.panels.find((p) => p.id === 2);
    expect(cpuPanel?.title).toBe('CPU usage');
    expect(cpuPanel?.unit).toBe('percent');
  });

  it('conventions reflects nested panel units and types, not just rows', () => {
    const result = inspectDashboard(nestedFixture, { detail: 'conventions' });
    if (result.detail !== 'conventions') return;
    // topUnits should see the nested panels' units, not just the (no-unit) rows
    const units = Object.fromEntries(result.topUnits.map((u) => [u.unit, u.count]));
    expect(units.percent).toBe(1);
    expect(units.short).toBe(1);
    expect(units.bytes).toBe(1);
    // topPanelTypes should count rows AND nested types
    const types = Object.fromEntries(result.topPanelTypes.map((t) => [t.type, t.count]));
    expect(types.row).toBe(2);
    expect(types.timeseries).toBe(2);
    expect(types.stat).toBe(1);
    // size histogram excludes rows
    expect(result.panelSizeHistogram).toEqual({ '12x8': 2, '6x4': 1 });
    expect(result.rowCount).toBe(2);
  });

  it('layoutBounds spans nested panel gridPos (nested gridPos is absolute)', () => {
    const result = inspectDashboard(nestedFixture);
    if (result.detail !== 'summary') return;
    // bottom-most nested panel: y=10 + h=4 = 14
    expect(result.layoutBounds.height).toBe(14);
  });
});
