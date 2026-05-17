import { describe, expect, it } from 'vitest';

import {
  buildRowPanel,
  buildStatPanel,
  buildStateTimelinePanel,
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
    // Pinned by issue #60 (with #datasource-gap revision): id /
    // gridPos / legend / tooltip / fieldConfig / options are omitted
    // by the builder. The tool description points callers at the right
    // sibling tool for each. datasource is NO LONGER omitted by
    // default — the team-retrospective datasource-gap PR added it as
    // an optional input. When the caller doesn't pass datasource, the
    // SDK still doesn't emit `datasource: {}` (verified by the
    // assertion below); pinning that so an SDK bump that starts
    // emitting an empty default ref would surface as a test failure.
    // Legend and tooltip live under `options` / `fieldConfig.defaults`,
    // so we pin those carriers too.
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

describe('buildStateTimelinePanel', () => {
  it('produces a state-timeline panel with type "state-timeline" and the given title', () => {
    const panel = buildStateTimelinePanel({
      title: 'UP/DOWN',
      targets: [{ expr: 'up' }],
    });
    expect(panel.type).toBe('state-timeline');
    expect(panel.title).toBe('UP/DOWN');
    expect(panel.targets).toHaveLength(1);
  });

  it('propagates description when set', () => {
    const panel = buildStateTimelinePanel({
      title: 'x',
      description: 'service availability',
      targets: [{ expr: 'up' }],
    });
    expect(panel.description).toBe('service availability');
  });

  it('propagates mergeValues when set to true', () => {
    const panel = buildStateTimelinePanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      mergeValues: true,
    });
    expect(JSON.stringify(panel)).toContain('"mergeValues":true');
  });

  it('propagates rowHeight when set', () => {
    const panel = buildStateTimelinePanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      rowHeight: 0.5,
    });
    expect(JSON.stringify(panel)).toContain('"rowHeight":0.5');
  });

  it('omits description when not provided', () => {
    const panel = buildStateTimelinePanel({
      title: 'x',
      targets: [{ expr: 'up' }],
    });
    expect(panel.description).toBeUndefined();
  });
});

describe('panel-builder datasource propagation (closes datasource gap)', () => {
  // The four data-bearing builders all accept an optional datasource
  // input. Without it, panels render against the Grafana instance
  // default — silent broken dashboard if no default is set. Tests pin
  // that the field flows through unchanged on each builder.
  const ds = { uid: 'prometheus-prod', type: 'prometheus' };

  it('buildTimeseriesPanel propagates datasource when set', () => {
    const panel = buildTimeseriesPanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      datasource: ds,
    });
    expect(panel.datasource).toEqual(ds);
  });

  it('buildTimeseriesPanel omits datasource when not provided', () => {
    const panel = buildTimeseriesPanel({ title: 'x', targets: [{ expr: 'up' }] });
    expect(panel.datasource).toBeUndefined();
  });

  it('buildStatPanel propagates datasource when set', () => {
    const panel = buildStatPanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      datasource: ds,
    });
    expect(panel.datasource).toEqual(ds);
  });

  it('buildTablePanel propagates datasource when set', () => {
    const panel = buildTablePanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      datasource: ds,
    });
    expect(panel.datasource).toEqual(ds);
  });

  it('buildStateTimelinePanel propagates datasource when set', () => {
    const panel = buildStateTimelinePanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      datasource: ds,
    });
    expect(panel.datasource).toEqual(ds);
  });

  it('accepts datasource with only uid (type optional)', () => {
    const panel = buildTimeseriesPanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      datasource: { uid: 'prometheus-prod' },
    });
    expect((panel.datasource as { uid?: string })?.uid).toBe('prometheus-prod');
  });

  it('accepts datasource templating-variable reference shape', () => {
    // A common pattern: datasource is parameterised by a templating
    // variable — `{ uid: "$datasource" }`. The builder must pass it
    // through verbatim so variable interpolation works at render time.
    const panel = buildTimeseriesPanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      datasource: { uid: '$datasource', type: 'prometheus' },
    });
    expect((panel.datasource as { uid?: string })?.uid).toBe('$datasource');
  });

  it('accepts a type-only datasource ref (uid omitted)', () => {
    // Pin the lenient semantics: a `{ type: 'prometheus' }` ref with
    // no uid passes the builder unchanged. The lint rule
    // `dashboards.panels.datasourceDeclared` is intentionally lenient
    // and treats type-only refs as "declared." (A type-only ref still
    // falls back to the instance default at render time, but that's a
    // shape Grafana itself accepts; we're catching the empty-{}
    // footgun, not policing every shape.)
    const panel = buildTimeseriesPanel({
      title: 'x',
      targets: [{ expr: 'up' }],
      datasource: { type: 'prometheus' },
    });
    expect((panel.datasource as { type?: string })?.type).toBe('prometheus');
  });
});
