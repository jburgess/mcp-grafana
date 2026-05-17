import { describe, expect, it } from 'vitest';

import { lintDashboard, type GrafanaStyleGuide } from '../../src/assets/lint.js';

// lintDashboard is the dashboard-level aggregator over lintPanel. It walks
// every panel (top-level + legacy row.panels[]) and runs the panel-slice
// rules against each, then adds dashboard-level rules that can't be
// checked per-panel: duplicate titles, hidden-but-referenced variables,
// empty-default variables. Per the issue #31 team-review reshape, the
// aggregator is thin — taste-laden rules (title-query mismatch, naming
// inconsistency, etc.) stay in the skill's prose, not in code.

const baseFixture = (): Record<string, unknown> => ({
  title: 'Test',
  templating: {
    list: [
      { name: 'env', type: 'custom', current: { value: 'prod' } },
      { name: 'role', type: 'query', current: { value: 'web' } },
    ],
  },
  panels: [
    {
      id: 1,
      type: 'timeseries',
      title: 'Requests',
      description: 'Request rate',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      options: {
        legend: { placement: 'right', displayMode: 'table', calcs: ['mean', 'lastNotNull', 'max'] },
      },
      targets: [{ expr: 'rate(http_requests_total[5m])' }],
    },
  ],
});

const minimalGuide: GrafanaStyleGuide = {
  panels: {
    units: { allowList: ['reqps', 'percentunit'] },
    descriptions: { required: true },
  },
  dashboards: {
    panels: { duplicateTitles: true },
    variables: { hiddenButReferenced: true, emptyDefault: true },
  },
};

describe('lintDashboard - aggregation over panels', () => {
  it('returns no issues for a clean dashboard', () => {
    const result = lintDashboard(baseFixture(), minimalGuide);
    expect(result.issues).toEqual([]);
  });

  it('forwards lintPanel issues with the panel JSONPath as the prefix', () => {
    // A panel with a unit not in the allow list should fire the unit rule
    // — and the path must point at the panel's index, not '$' (which
    // would only make sense for a standalone panel).
    const dash = baseFixture();
    const panel = (dash.panels as Array<Record<string, unknown>>)[0]!;
    (panel.fieldConfig as { defaults: { unit: string } }).defaults.unit = 'celsius';
    const result = lintDashboard(dash, minimalGuide);
    const unitIssue = result.issues.find((i) => i.ruleId === 'panels.units.allowList');
    expect(unitIssue).toBeDefined();
    // Path is rebased onto the panel's index in the dashboard.
    expect(unitIssue?.path).toBe('panels[0].fieldConfig.defaults.unit');
  });

  it('walks every top-level panel and legacy row.panels[] nested panels', () => {
    const dash = {
      title: 'Mixed',
      templating: { list: [] },
      panels: [
        {
          id: 1,
          type: 'row',
          title: 'Section',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            // Nested panel: no description -> fires panels.descriptions.required
            {
              id: 2,
              type: 'timeseries',
              title: 'Nested',
              fieldConfig: { defaults: { unit: 'reqps' } },
              gridPos: { x: 0, y: 1, w: 12, h: 8 },
            },
          ],
        },
        // Top-level non-row: also no description
        {
          id: 3,
          type: 'timeseries',
          title: 'Top',
          fieldConfig: { defaults: { unit: 'reqps' } },
          gridPos: { x: 0, y: 9, w: 12, h: 8 },
        },
      ],
    };
    const result = lintDashboard(dash, {
      panels: { descriptions: { required: true } },
    });
    const descIssues = result.issues.filter(
      (i) => i.ruleId === 'panels.descriptions.required',
    );
    expect(descIssues).toHaveLength(2);
    expect(descIssues.map((i) => i.path).sort()).toEqual([
      'panels[0].panels[0].description',
      'panels[1].description',
    ]);
  });

  it('skips row panels themselves for description checks (rows are section markers, not visualizations)', () => {
    const dash = {
      title: 't',
      templating: { list: [] },
      panels: [
        { id: 1, type: 'row', title: 'R', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
      ],
    };
    const result = lintDashboard(dash, { panels: { descriptions: { required: true } } });
    expect(result.issues).toEqual([]);
  });
});

describe('lintDashboard - dashboard-level rules', () => {
  it('fires dashboards.panels.duplicateTitles when two panels share a title', () => {
    const dash = baseFixture();
    (dash.panels as Array<Record<string, unknown>>).push({
      id: 2,
      type: 'timeseries',
      title: 'Requests', // duplicate of panel 1
      description: 'd',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
      options: { legend: { placement: 'right', displayMode: 'table', calcs: ['mean', 'lastNotNull', 'max'] } },
    });
    const result = lintDashboard(dash, minimalGuide);
    const dup = result.issues.find((i) => i.ruleId === 'dashboards.panels.duplicateTitles');
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe('info');
    expect(dup?.message).toMatch(/Requests/);
    expect(dup?.message).toMatch(/panel ids? 1, 2|panels 1, 2|ids 1, 2/i);
  });

  it('does NOT fire duplicateTitles for row panels (rows often share titles legitimately)', () => {
    const dash = {
      title: 't',
      templating: { list: [] },
      panels: [
        { id: 1, type: 'row', title: 'Overview', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
        { id: 2, type: 'row', title: 'Overview', gridPos: { x: 0, y: 9, w: 24, h: 1 } },
      ],
    };
    const result = lintDashboard(dash, {
      dashboards: { panels: { duplicateTitles: true } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.duplicateTitles'),
    ).toEqual([]);
  });

  it('fires dashboards.variables.hiddenButReferenced when hide:2 var appears in a row/panel title', () => {
    // The exact bug case from issue #31: a templating var is hidden
    // (hide:2 means both label and value hidden in the UI) but
    // interpolated in a row title — renders as "All" or empty, never
    // shows the user what the value is. Structural check.
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'processor', type: 'query', hide: 2, current: { value: 'a' } },
        ],
      },
      panels: [
        {
          id: 1,
          type: 'row',
          title: 'Processor: $processor',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
        },
      ],
    };
    const result = lintDashboard(dash, {
      dashboards: { variables: { hiddenButReferenced: true } },
    });
    const issue = result.issues.find(
      (i) => i.ruleId === 'dashboards.variables.hiddenButReferenced',
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warn');
    expect(issue?.message).toMatch(/processor/);
  });

  it('does NOT fire hiddenButReferenced when the variable is visible (hide=0) or label-only hidden (hide=1)', () => {
    for (const hide of [0, 1, undefined]) {
      const dash = {
        title: 't',
        templating: {
          list: [
            hide === undefined
              ? { name: 'p', type: 'query', current: { value: 'a' } }
              : { name: 'p', type: 'query', hide, current: { value: 'a' } },
          ],
        },
        panels: [
          { id: 1, type: 'row', title: 'P: $p', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
        ],
      };
      const result = lintDashboard(dash, {
        dashboards: { variables: { hiddenButReferenced: true } },
      });
      expect(
        result.issues.filter((i) => i.ruleId === 'dashboards.variables.hiddenButReferenced'),
      ).toEqual([]);
    }
  });

  it('fires dashboards.variables.emptyDefault for variables with no current value', () => {
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'env', type: 'custom', current: { value: 'prod' } }, // OK
          { name: 'namespace', type: 'query', current: { value: '' } }, // fires
          { name: 'role', type: 'query' }, // fires — no current at all
        ],
      },
      panels: [],
    };
    const result = lintDashboard(dash, {
      dashboards: { variables: { emptyDefault: true } },
    });
    const emptyIssues = result.issues.filter(
      (i) => i.ruleId === 'dashboards.variables.emptyDefault',
    );
    expect(emptyIssues).toHaveLength(2);
    expect(emptyIssues.map((i) => i.path).sort()).toEqual([
      'templating.list[1].current.value',
      'templating.list[2].current.value',
    ]);
  });
});

describe('lintDashboard - rule configurability', () => {
  it('skips dashboard-level rules when the dashboards section of the guide is absent', () => {
    const dash = baseFixture();
    (dash.panels as Array<Record<string, unknown>>).push({
      id: 2,
      type: 'timeseries',
      title: 'Requests',
      description: 'd',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
    });
    // Only panel-level rules in the guide — duplicate titles must NOT fire.
    const result = lintDashboard(dash, { panels: { descriptions: { required: true } } });
    expect(
      result.issues.filter((i) => i.ruleId.startsWith('dashboards.')),
    ).toEqual([]);
  });

  it('skips dashboards.panels.duplicateTitles when the rule is false', () => {
    const dash = baseFixture();
    (dash.panels as Array<Record<string, unknown>>).push({
      id: 2,
      type: 'timeseries',
      title: 'Requests',
      description: 'd',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
    });
    const result = lintDashboard(dash, {
      dashboards: { panels: { duplicateTitles: false } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.duplicateTitles'),
    ).toEqual([]);
  });
});

describe('lintDashboard - structural / edge cases', () => {
  it('returns a single structural issue when dashboard is not an object', () => {
    const result = lintDashboard(null, minimalGuide);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toBe('$');
    expect(result.issues[0]?.ruleId).toBe('dashboards.shape');
  });

  it('handles a non-object guide by surfacing the same panels.shape issue lintPanel uses', () => {
    const result = lintDashboard(baseFixture(), null);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.ruleId).toBe('panels.shape');
  });

  it('emits deterministic output across repeat runs', () => {
    const dash = baseFixture();
    (dash.panels as Array<Record<string, unknown>>).push({
      id: 2,
      type: 'timeseries',
      title: 'Requests',
      description: 'd',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
    });
    const a = lintDashboard(dash, minimalGuide);
    const b = lintDashboard(dash, minimalGuide);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('returns issues across rule sections in a stable order (panels first by index, then dashboards)', () => {
    const dash = baseFixture();
    const panel = (dash.panels as Array<Record<string, unknown>>)[0]!;
    delete (panel as { description?: string }).description; // fires panel-level
    (dash.panels as Array<Record<string, unknown>>).push({
      id: 2,
      type: 'timeseries',
      title: 'Requests', // dup -> fires dashboard-level
      description: 'd',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
    });
    const result = lintDashboard(dash, minimalGuide);
    // Panel-level issues come before dashboard-level issues so consumers
    // can group by "panels[N]." prefix.
    const ruleIds = result.issues.map((i) => i.ruleId);
    const firstDashIdx = ruleIds.findIndex((r) => r.startsWith('dashboards.'));
    const lastPanelIdx = ruleIds.reduce(
      (acc, r, i) => (r.startsWith('panels.') ? i : acc),
      -1,
    );
    expect(lastPanelIdx).toBeLessThan(firstDashIdx);
  });
});
