import { describe, expect, it } from 'vitest';

import {
  buildRowPanel,
  buildStatPanel,
  buildTablePanel,
  buildTimeseriesPanel,
} from '../../src/assets/panel.js';

describe('buildTimeseriesPanel', () => {
  it('produces a panel with the given title and a single target', () => {
    const panel = buildTimeseriesPanel({
      title: 'HTTP requests',
      targets: [{ expr: 'rate(http_requests_total[$__rate_interval])' }],
    });

    expect(panel.title).toBe('HTTP requests');
    expect(panel.targets).toHaveLength(1);
    expect((panel.targets?.[0] as { expr?: string })?.expr).toBe(
      'rate(http_requests_total[$__rate_interval])',
    );
  });

  it('supports multiple targets on the same chart (multi-expression panels)', () => {
    const panel = buildTimeseriesPanel({
      title: 'HTTP rate vs errors',
      targets: [
        {
          expr: 'sum(rate(http_requests_total[$__rate_interval]))',
          legendFormat: 'all',
        },
        {
          expr: 'sum(rate(http_requests_total{status=~"5.."}[$__rate_interval]))',
          legendFormat: 'errors',
        },
      ],
    });

    expect(panel.targets).toHaveLength(2);
    const targets = panel.targets as Array<{ expr?: string; legendFormat?: string }>;
    expect(targets[0]?.legendFormat).toBe('all');
    expect(targets[1]?.legendFormat).toBe('errors');
  });

  it('propagates description and unit when provided', () => {
    const panel = buildTimeseriesPanel({
      title: 'x',
      description: 'total processed HTTP requests per second',
      unit: 'reqps',
      targets: [{ expr: 'up' }],
    });

    expect(panel.description).toBe('total processed HTTP requests per second');
    expect(JSON.stringify(panel)).toContain('"reqps"');
  });

  it('omits optional fields when not provided', () => {
    const panel = buildTimeseriesPanel({
      title: 'x',
      targets: [{ expr: 'up' }],
    });

    expect(panel.description).toBeUndefined();
  });

  it('omits every field the tool description claims is omitted', () => {
    // Pinned by issue #60: the tool description tells callers id /
    // gridPos / datasource / legend / tooltip / fieldConfig / options are
    // omitted and points them at the right sibling tool for each.
    // Legend and tooltip live under `options` / `fieldConfig.defaults`,
    // so we pin those carriers too — otherwise an SDK bump could start
    // emitting `options.legend = {...}` and the description silently
    // lies while this test stays green.
    const panel = buildTimeseriesPanel({ title: 'x', targets: [{ expr: 'up' }] });

    expect(panel.id).toBeUndefined();
    expect(panel.gridPos).toBeUndefined();
    expect(panel.datasource).toBeUndefined();
    expect(panel.fieldConfig).toBeUndefined();
    expect(panel.options).toBeUndefined();
  });
});

describe('buildRowPanel', () => {
  it('produces a row panel with type "row" and the given title', () => {
    const row = buildRowPanel({ title: 'Service health' });

    expect(row.type).toBe('row');
    expect(row.title).toBe('Service health');
  });

  it('propagates collapsed when set to true', () => {
    const row = buildRowPanel({ title: 'r', collapsed: true });
    expect(row.collapsed).toBe(true);
  });

  it('propagates collapsed when set to false', () => {
    const row = buildRowPanel({ title: 'r', collapsed: false });
    expect(row.collapsed).toBe(false);
  });

  it('omits collapsed when not provided (no SDK override)', () => {
    // Pinned per issue #61 DoD: "absent collapsed produces no override".
    // The Foundation SDK initialises collapsed to false in defaultRowPanel(),
    // so the assertion is: caller-omitted input matches SDK default
    // without our builder overriding it.
    const row = buildRowPanel({ title: 'r' });
    expect(row.collapsed).toBe(false);
  });
});

describe('buildStatPanel', () => {
  it('produces a stat panel with type "stat" and the given title and target', () => {
    const panel = buildStatPanel({
      title: 'Error rate',
      targets: [{ expr: 'sum(rate(http_requests_total{status=~"5.."}[5m]))' }],
    });

    expect(panel.type).toBe('stat');
    expect(panel.title).toBe('Error rate');
    expect(panel.targets).toHaveLength(1);
    expect((panel.targets?.[0] as { expr?: string })?.expr).toContain('status=~"5.."');
  });

  it('defaults graphMode to "area" (matches panels.stat.requiresComparison)', () => {
    const panel = buildStatPanel({
      title: 'SLO',
      targets: [{ expr: 'up' }],
    });
    const options = panel.options as { graphMode?: string };
    expect(options.graphMode).toBe('area');
  });

  it('accepts graphMode: "none" and propagates it (caller opt-out)', () => {
    const panel = buildStatPanel({
      title: 'SLO',
      targets: [{ expr: 'up' }],
      graphMode: 'none',
    });
    const options = panel.options as { graphMode?: string };
    expect(options.graphMode).toBe('none');
  });

  it('accepts graphMode: "line"', () => {
    const panel = buildStatPanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      graphMode: 'line',
    });
    const options = panel.options as { graphMode?: string };
    expect(options.graphMode).toBe('line');
  });

  it('propagates description and unit when provided', () => {
    const panel = buildStatPanel({
      title: 'x',
      description: 'current SLO',
      unit: 'percentunit',
      targets: [{ expr: 'up' }],
    });
    expect(panel.description).toBe('current SLO');
    expect(JSON.stringify(panel)).toContain('"percentunit"');
  });

  it('omits description when not provided', () => {
    const panel = buildStatPanel({ title: 'x', targets: [{ expr: 'up' }] });
    expect(panel.description).toBeUndefined();
  });

  it('propagates reduceCalc to reduceOptions.calcs when set', () => {
    const panel = buildStatPanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      reduceCalc: 'mean',
    });
    const options = panel.options as { reduceOptions?: { calcs?: string[] } };
    expect(options.reduceOptions?.calcs).toEqual(['mean']);
  });

  it('defaults reduceCalc to "lastNotNull" so the stat actually displays a value', () => {
    // Round-1 review caught: SDK default for reduceOptions.calcs is []
    // (renders nothing). The builder fills "lastNotNull" — Grafana's
    // own canonical stat default and the right pick for current-state
    // KPI reads — so freshly-built stat panels show a number without
    // the caller having to think about it.
    const panel = buildStatPanel({ title: 'x', targets: [{ expr: 'up' }] });
    const options = panel.options as { reduceOptions?: { calcs?: string[] } };
    expect(options.reduceOptions?.calcs).toEqual(['lastNotNull']);
  });
});

describe('buildTablePanel', () => {
  it('produces a table panel with type "table" and the given title and target', () => {
    const panel = buildTablePanel({
      title: 'Top endpoints',
      targets: [{ expr: 'topk(10, sum by (endpoint) (rate(http_requests_total[5m])))' }],
    });

    expect(panel.type).toBe('table');
    expect(panel.title).toBe('Top endpoints');
    expect(panel.targets).toHaveLength(1);
  });

  it('propagates description and unit when provided', () => {
    const panel = buildTablePanel({
      title: 'x',
      description: 'service inventory',
      unit: 'short',
      targets: [{ expr: 'up' }],
    });
    expect(panel.description).toBe('service inventory');
    expect(JSON.stringify(panel)).toContain('"short"');
  });

  it('propagates filterable when set', () => {
    const panel = buildTablePanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      filterable: true,
    });
    expect(JSON.stringify(panel)).toContain('"filterable":true');
  });

  it('omits filterable from output when not set (SDK default applies)', () => {
    const panel = buildTablePanel({ title: 'x', targets: [{ expr: 'up' }] });
    // SDK default for table-panel custom.filterable is unset (Grafana
    // treats absent as false). Builder should not override.
    expect(JSON.stringify(panel)).not.toContain('"filterable":true');
  });

  it('omits description when not provided', () => {
    const panel = buildTablePanel({ title: 'x', targets: [{ expr: 'up' }] });
    expect(panel.description).toBeUndefined();
  });
});
