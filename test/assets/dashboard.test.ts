import { describe, expect, it } from 'vitest';
import { PanelBuilder } from '@grafana/grafana-foundation-sdk/timeseries';

import {
  buildDashboard,
  buildRowPanel,
  buildStatPanel,
  buildStateTimelinePanel,
  buildTablePanel,
  buildTimeseriesPanel,
  lintDashboard,
  validateDashboard,
} from '../../src/index.js';
import type { PanelInput } from '../../src/index.js';

describe('buildDashboard', () => {
  it('produces a dashboard whose title matches the input', () => {
    const dashboard = buildDashboard({ title: 'My Dashboard' });

    expect(dashboard.title).toBe('My Dashboard');
  });

  it('includes a provided panel builder in the dashboard', () => {
    const dashboard = buildDashboard({
      title: 'My Dashboard',
      panels: [new PanelBuilder().title('CPU usage')],
    });

    expect(dashboard.panels).toHaveLength(1);
    expect(dashboard.panels?.[0]?.title).toBe('CPU usage');
  });

  it('omits panels when none are provided', () => {
    const dashboard = buildDashboard({ title: 'My Dashboard' });

    expect(dashboard.panels ?? []).toHaveLength(0);
  });

  it('accepts a pre-built panel JSON object (output of buildTimeseriesPanel)', () => {
    const panel = buildTimeseriesPanel({
      title: 'HTTP requests',
      targets: [{ expr: 'rate(http_requests_total[$__rate_interval])' }],
    });

    const dashboard = buildDashboard({
      title: 'My Dashboard',
      panels: [panel],
    });

    expect(dashboard.panels).toHaveLength(1);
    expect(dashboard.panels?.[0]?.title).toBe('HTTP requests');
  });

  it('accepts a mix of pre-built panel JSON and SDK panel builders', () => {
    const prebuiltPanel = buildTimeseriesPanel({
      title: 'Errors',
      targets: [{ expr: 'sum(rate(http_requests_total{status=~"5.."}[5m]))' }],
    });

    const dashboard = buildDashboard({
      title: 'My Dashboard',
      panels: [new PanelBuilder().title('CPU usage'), prebuiltPanel],
    });

    expect(dashboard.panels).toHaveLength(2);
    const titles = dashboard.panels?.map((p) => p.title);
    expect(titles).toEqual(['CPU usage', 'Errors']);
  });

  it('accepts a bare row JSON without a panels[] field (does not crash on withRow)', () => {
    // Regression: SDK's DashboardBuilder.withRow does
    // rowPanelResource.panels.forEach(...) unconditionally, so a bare
    // {type:'row', title:'X'} input would crash with TypeError. The
    // dispatch must default panels: [] when absent on row inputs.
    const bareRow = { type: 'row', title: 'Bare' };
    expect(() => buildDashboard({ title: 'd', panels: [bareRow] })).not.toThrow();
    const dashboard = buildDashboard({ title: 'd', panels: [bareRow] });
    expect(dashboard.panels?.[0]?.type).toBe('row');
    expect(dashboard.panels?.[0]?.title).toBe('Bare');
  });

  it('accepts a row panel produced by buildRowPanel alongside regular panels', () => {
    const row = buildRowPanel({ title: 'Service health' });
    const panel = buildTimeseriesPanel({
      title: 'A',
      targets: [{ expr: 'up' }],
    });

    const dashboard = buildDashboard({ title: 'd', panels: [row, panel] });

    expect(dashboard.panels).toHaveLength(2);
    expect(dashboard.panels?.[0]?.type).toBe('row');
    expect(dashboard.panels?.[0]?.title).toBe('Service health');
    expect(dashboard.panels?.[1]?.type).toBe('timeseries');
  });

  it('round-trip build → validate produces a valid dashboard', () => {
    const panel = buildTimeseriesPanel({
      title: 'HTTP requests',
      targets: [{ expr: 'rate(http_requests_total[$__rate_interval])' }],
    });

    const dashboard = buildDashboard({ title: 'My Service', panels: [panel] });
    const result = validateDashboard(dashboard);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('round-trip stat panel build → validate produces a valid dashboard', () => {
    const stat = buildStatPanel({
      title: 'Error rate',
      targets: [{ expr: 'sum(rate(http_requests_total{status=~"5.."}[5m]))' }],
    });
    const dashboard = buildDashboard({ title: 'd', panels: [stat] });
    const result = validateDashboard(dashboard);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('round-trip table panel build → validate produces a valid dashboard', () => {
    const table = buildTablePanel({
      title: 'Top endpoints',
      targets: [{ expr: 'topk(10, sum by (endpoint) (rate(http_requests_total[5m])))' }],
    });
    const dashboard = buildDashboard({ title: 'd', panels: [table] });
    const result = validateDashboard(dashboard);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('round-trip state-timeline build → validate produces a valid dashboard', () => {
    const stateTimeline = buildStateTimelinePanel({
      title: 'Service health',
      targets: [{ expr: 'up{job="api"}' }],
    });
    const dashboard = buildDashboard({ title: 'd', panels: [stateTimeline] });
    const result = validateDashboard(dashboard);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('assigns sequential ids starting at 1 to panels missing one', () => {
    const a = buildTimeseriesPanel({ title: 'A', targets: [{ expr: 'up' }] });
    const b = buildTimeseriesPanel({ title: 'B', targets: [{ expr: 'up' }] });
    const c = buildTimeseriesPanel({ title: 'C', targets: [{ expr: 'up' }] });

    const dashboard = buildDashboard({ title: 'd', panels: [a, b, c] });
    const ids = dashboard.panels?.map((p) => p.id);

    expect(ids).toEqual([1, 2, 3]);
  });

  it('preserves explicit ids and fills gaps for the rest', () => {
    const explicit = { type: 'timeseries', title: 'Pinned', id: 42 };
    const unset = buildTimeseriesPanel({ title: 'Floating', targets: [{ expr: 'up' }] });

    const dashboard = buildDashboard({ title: 'd', panels: [explicit, unset] });
    const ids = dashboard.panels?.map((p) => p.id);

    expect(ids).toEqual([42, 43]);
  });

  it('overwrites non-numeric ids with a fresh integer (Grafana schema requires numeric)', () => {
    // Cast: the input type rules out string ids, but a misbehaving caller
    // can still hand-craft one. Pinned behavior: we overwrite rather than
    // pass the schema-invalid id through to fail validation later.
    const stringId = { type: 'timeseries', title: 'Bad', id: 'not-a-number' } as unknown as PanelInput;
    const dashboard = buildDashboard({ title: 'd', panels: [stringId] });
    expect(dashboard.panels?.[0]?.id).toBe(1);
  });

  it('treats id: 0 as missing and reassigns it', () => {
    const zeroId = { type: 'timeseries', title: 'Zero', id: 0 };
    const unset = buildTimeseriesPanel({ title: 'Floating', targets: [{ expr: 'up' }] });

    const dashboard = buildDashboard({ title: 'd', panels: [zeroId, unset] });
    const ids = dashboard.panels?.map((p) => p.id);

    expect(ids).toEqual([1, 2]);
  });

  it('does not mutate caller-supplied pre-built panel JSON', () => {
    const panel = buildTimeseriesPanel({
      title: 'CPU',
      targets: [{ expr: 'rate(cpu[1m])' }],
    });
    // SDK builder leaves id undefined and may include a default gridPos.
    expect((panel as { id?: unknown }).id).toBeUndefined();
    const snapshot = JSON.stringify(panel);

    buildDashboard({ title: 'd', panels: [panel] });
    buildDashboard({ title: 'd2', panels: [panel] });

    // Caller's panel object is unchanged across multiple build calls.
    expect((panel as { id?: unknown }).id).toBeUndefined();
    expect(JSON.stringify(panel)).toBe(snapshot);
  });

  it('assigns ids to row-nested children that lack one (legacy row format)', () => {
    const row = {
      type: 'row',
      title: 'Section',
      panels: [
        { type: 'timeseries', title: 'A' },
        { type: 'timeseries', title: 'B', id: 7 },
        { type: 'timeseries', title: 'C' },
      ],
    };

    const dashboard = buildDashboard({ title: 'd', panels: [row] });
    const top = dashboard.panels as Array<{ id?: number; panels?: Array<{ id?: number; title?: string }> }>;
    expect(top[0]?.id).toBe(8); // row itself: max=7 → 8
    const childIds = top[0]?.panels?.map((c) => c.id);
    // 7 preserved (B); A and C fill 9 and 10 around it.
    expect(childIds).toEqual([9, 7, 10]);
  });

  it('produces deterministic output for the same input', () => {
    const inputs = (): BuildDashboardInputArg => ({
      title: 'd',
      panels: [
        buildTimeseriesPanel({ title: 'A', targets: [{ expr: 'up' }] }),
        buildTimeseriesPanel({ title: 'B', targets: [{ expr: 'up' }] }),
      ],
    });
    const first = JSON.stringify(buildDashboard(inputs()));
    const second = JSON.stringify(buildDashboard(inputs()));
    expect(first).toBe(second);
  });
});

describe('builder → buildDashboard → lint datasourceDeclared round-trip', () => {
  // End-to-end pin: the datasource-gap PR's two surfaces (builder
  // input + lint rule) have to agree. Build a panel with datasource,
  // assemble the dashboard, lint with datasourceDeclared enabled →
  // zero issues. Same without datasource → one issue. Catches future
  // drift where the builder might start emitting an empty
  // `datasource: {}` (lint would falsely fire) or where the lint
  // rule's shape diverges from what the builder emits.
  it('produces a lint-clean dashboard when builders carry datasource', () => {
    const panel = buildTimeseriesPanel({
      title: 'HTTP rate',
      targets: [{ expr: 'rate(http_requests_total[$__rate_interval])' }],
      datasource: { uid: 'prometheus-prod', type: 'prometheus' },
    });
    const dashboard = buildDashboard({ title: 'd', panels: [panel] });
    const result = lintDashboard(dashboard, {
      dashboards: { panels: { datasourceDeclared: true } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.datasourceDeclared'),
    ).toEqual([]);
  });

  it('fires datasourceDeclared when builders omit datasource', () => {
    const panel = buildTimeseriesPanel({
      title: 'HTTP rate',
      targets: [{ expr: 'rate(http_requests_total[$__rate_interval])' }],
    });
    const dashboard = buildDashboard({ title: 'd', panels: [panel] });
    const result = lintDashboard(dashboard, {
      dashboards: { panels: { datasourceDeclared: true } },
    });
    const issues = result.issues.filter(
      (i) => i.ruleId === 'dashboards.panels.datasourceDeclared',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('panels[0].datasource');
  });
});

type BuildDashboardInputArg = Parameters<typeof buildDashboard>[0];
