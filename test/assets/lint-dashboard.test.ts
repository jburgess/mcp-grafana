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

// Issue #44.1: lint findings should carry panelId + panelTitle when
// the path resolves to a single panel. Saves callers a JSON walk to
// map `panels[0].panels[8]` back to the id every downstream tool
// (panel_update, panel_find, inspect) keys by.
describe('lintDashboard - panelId / panelTitle on findings (issue #44.1)', () => {
  it('populates panelId and panelTitle on panel-scoped findings', () => {
    const dash = {
      title: 't',
      templating: { list: [] },
      panels: [
        {
          id: 42,
          type: 'timeseries',
          title: 'CPU usage',
          // description missing — fires panels.descriptions.required
          fieldConfig: { defaults: { unit: 'short' } }, // fires panels.units.allowList
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
      ],
    };
    const result = lintDashboard(dash, {
      panels: {
        descriptions: { required: true },
        units: { allowList: ['reqps', 'percentunit'] },
      },
    });
    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      expect(issue.panelId).toBe(42);
      expect(issue.panelTitle).toBe('CPU usage');
    }
  });

  it('carries the right panelId on each panel-scoped finding in a multi-panel dashboard', () => {
    const dash = {
      title: 't',
      templating: { list: [] },
      panels: [
        {
          id: 100,
          type: 'timeseries',
          title: 'A',
          fieldConfig: { defaults: { unit: 'short' } },
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
        {
          id: 200,
          type: 'timeseries',
          title: 'B',
          fieldConfig: { defaults: { unit: 'celsius' } },
          gridPos: { x: 12, y: 0, w: 12, h: 8 },
        },
      ],
    };
    const result = lintDashboard(dash, {
      panels: { units: { allowList: ['reqps'] } },
    });
    const issueA = result.issues.find((i) => i.panelId === 100);
    const issueB = result.issues.find((i) => i.panelId === 200);
    expect(issueA?.panelTitle).toBe('A');
    expect(issueB?.panelTitle).toBe('B');
    // Sanity: ids are not swapped between findings.
    expect(issueA?.message).toMatch(/short/);
    expect(issueB?.message).toMatch(/celsius/);
  });

  it('carries panelId/panelTitle on legacy row-nested panel findings', () => {
    const dash = {
      title: 't',
      templating: { list: [] },
      panels: [
        {
          id: 1,
          type: 'row',
          title: 'R',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            {
              id: 77,
              type: 'timeseries',
              title: 'Nested panel',
              fieldConfig: { defaults: { unit: 'short' } },
              gridPos: { x: 0, y: 1, w: 12, h: 8 },
            },
          ],
        },
      ],
    };
    const result = lintDashboard(dash, {
      panels: { units: { allowList: ['reqps'] } },
    });
    const issue = result.issues[0];
    expect(issue?.panelId).toBe(77);
    expect(issue?.panelTitle).toBe('Nested panel');
  });

  it('OMITS panelId / panelTitle on dashboard-scoped findings', () => {
    // dashboards.* rules resolve to templating variables or aggregate
    // panel state, not a single panel. The fields should be absent
    // so consumers can tell panel-scoped from dashboard-scoped.
    const dash = {
      title: 't',
      templating: {
        list: [
          // type 'query' + no current.value → fires dashboards.variables.emptyDefault
          { name: 'env', type: 'query' },
        ],
      },
      panels: [],
    };
    const result = lintDashboard(dash, {
      dashboards: { variables: { emptyDefault: true } },
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.ruleId).toBe('dashboards.variables.emptyDefault');
    expect(result.issues[0]?.panelId).toBeUndefined();
    expect(result.issues[0]?.panelTitle).toBeUndefined();
  });

  it('OMITS panelTitle when the panel has no title but keeps panelId', () => {
    const dash = {
      title: 't',
      templating: { list: [] },
      panels: [
        {
          id: 99,
          type: 'timeseries',
          // No title at all
          fieldConfig: { defaults: { unit: 'short' } },
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
      ],
    };
    const result = lintDashboard(dash, {
      panels: { units: { allowList: ['reqps'] } },
    });
    expect(result.issues[0]?.panelId).toBe(99);
    expect(result.issues[0]?.panelTitle).toBeUndefined();
  });

  it('OMITS panelTitle when the panel has title: "" (empty == missing, matches glossary)', () => {
    // The glossary's LintIssue entry promises panelTitle is "absent when
    // the panel has no title set." Grafana's UI renders absent and ""
    // identically — the lint output must reflect that, not leak `""`.
    const dash = {
      title: 't',
      templating: { list: [] },
      panels: [
        {
          id: 7,
          type: 'timeseries',
          title: '',
          fieldConfig: { defaults: { unit: 'short' } },
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
      ],
    };
    const result = lintDashboard(dash, {
      panels: { units: { allowList: ['reqps'] } },
    });
    expect(result.issues[0]?.panelId).toBe(7);
    expect(result.issues[0]?.panelTitle).toBeUndefined();
    expect('panelTitle' in (result.issues[0] ?? {})).toBe(false);
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

  // Round-1 review (LLM+Doc+Naysayer): emptyDefault was too aggressive
  // and fired for variable types where empty defaults are legitimate
  // (textbox blank by design; adhoc starts with zero filters; constant
  // / custom may expect a user choice). Restrict to types where empty
  // is a real load-time hazard.
  it('skips dashboards.variables.emptyDefault for variable types where empty is legitimate', () => {
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'tb', type: 'textbox', current: { value: '' } },
          { name: 'ad', type: 'adhoc' },
          { name: 'const', type: 'constant' },
          { name: 'cust', type: 'custom', current: { value: '' } },
        ],
      },
      panels: [],
    };
    const result = lintDashboard(dash, {
      dashboards: { variables: { emptyDefault: true } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.variables.emptyDefault'),
    ).toEqual([]);
  });

  // Round-2 review: hideValueOf used Number(asString(v.hide)) which
  // resolves `hide: ""` to 0 (visible). The design intent was
  // "tolerate string-coerced numbers," not "treat blank as visible."
  // Short-circuited on empty string. This test guards the regression.
  it('treats hide: "" (empty string) as undeclared, not as visible/0', () => {
    const dash = {
      title: 't',
      templating: {
        list: [
          // hide is the empty string — a malformed export shape.
          // Whatever we do, this variable shouldn't fire
          // hiddenButReferenced because we can't determine the hide
          // value. (Pre-fix: Number("") === 0 made it visible and
          // the rule didn't fire; post-fix: same outcome but via the
          // intentional path — undefined hide → not hidden.)
          { name: 'p', type: 'query', hide: '', current: { value: 'a' } },
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
      result.issues.find((i) => i.ruleId === 'dashboards.variables.hiddenButReferenced'),
    ).toBeUndefined();
  });

  // Round-1 review (Grafana+TS+MCP): some dashboard exports / round-trips
  // coerce `hide: 2` to the string `"2"`. The check must tolerate both.
  it('fires hiddenButReferenced for string-form hide: "2"', () => {
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'p', type: 'query', hide: '2', current: { value: 'a' } },
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
      result.issues.find((i) => i.ruleId === 'dashboards.variables.hiddenButReferenced'),
    ).toBeDefined();
  });

  // Round-1 review (Grafana+TS+MCP): hiddenButReferenced path was
  // `templating.list[?(name="X")].hide` (JSONPath filter form) — no
  // other rule in this codebase uses filter form. Consistent with
  // `emptyDefault`'s indexed `templating.list[N].current.value`.
  it('emits hiddenButReferenced path in indexed form (matches emptyDefault)', () => {
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'unrelated', type: 'custom' },
          { name: 'p', type: 'query', hide: 2, current: { value: 'a' } },
        ],
      },
      panels: [
        { id: 1, type: 'row', title: 'P: $p', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
      ],
    };
    const result = lintDashboard(dash, {
      dashboards: { variables: { hiddenButReferenced: true } },
    });
    const issue = result.issues.find(
      (i) => i.ruleId === 'dashboards.variables.hiddenButReferenced',
    );
    expect(issue?.path).toBe('templating.list[1].hide');
  });

  // Round-1 review (Grafana+TS+MCP): Grafana's `panel.repeat: "var"`
  // creates N runtime copies sharing the source panel's title — that's
  // intentional, not a duplicate. Without this skip, every repeat-using
  // dashboard would produce a false positive.
  it('skips panels with a `repeat:` field from duplicateTitles', () => {
    const dash = {
      title: 't',
      templating: { list: [{ name: 'p', type: 'custom' }] },
      panels: [
        // Two repeat-source panels with the same title — Grafana renders
        // these as N copies per `p` value, all titled "By processor".
        // Flagging them would fire on every dashboard using repeat.
        {
          id: 1,
          type: 'timeseries',
          title: 'By processor',
          description: 'd',
          fieldConfig: { defaults: { unit: 'reqps' } },
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          repeat: 'p',
        },
        {
          id: 2,
          type: 'timeseries',
          title: 'By processor',
          description: 'd',
          fieldConfig: { defaults: { unit: 'reqps' } },
          gridPos: { x: 12, y: 0, w: 12, h: 8 },
          repeat: 'p',
        },
        // Non-repeat panel with the same title — SHOULD fire (genuine dup).
        {
          id: 3,
          type: 'timeseries',
          title: 'Different name',
          description: 'd',
          fieldConfig: { defaults: { unit: 'reqps' } },
          gridPos: { x: 0, y: 8, w: 12, h: 8 },
        },
      ],
    };
    const result = lintDashboard(dash, {
      dashboards: { panels: { duplicateTitles: true } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.duplicateTitles'),
    ).toEqual([]);
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

  it('exempts titles listed in duplicateTitles.except (intentional duplicates)', () => {
    // Two pairs of duplicates: "Requests" is exempted (KPI stat next to
    // timeseries trend convention), "Errors" is not. Only "Errors" fires.
    const dash = baseFixture();
    (dash.panels as Array<Record<string, unknown>>).push(
      {
        id: 2,
        type: 'stat',
        title: 'Requests',
        description: 'd',
        fieldConfig: { defaults: { unit: 'reqps' } },
        gridPos: { x: 12, y: 0, w: 6, h: 4 },
      },
      {
        id: 3,
        type: 'timeseries',
        title: 'Errors',
        description: 'd',
        fieldConfig: { defaults: { unit: 'short' } },
        gridPos: { x: 0, y: 8, w: 12, h: 8 },
        options: { legend: { placement: 'right', displayMode: 'table', calcs: ['mean', 'lastNotNull', 'max'] } },
      },
      {
        id: 4,
        type: 'stat',
        title: 'Errors',
        description: 'd',
        fieldConfig: { defaults: { unit: 'short' } },
        gridPos: { x: 12, y: 8, w: 6, h: 4 },
      },
    );
    const result = lintDashboard(dash, {
      dashboards: { panels: { duplicateTitles: { except: ['Requests'] } } },
    });
    const dups = result.issues.filter(
      (i) => i.ruleId === 'dashboards.panels.duplicateTitles',
    );
    expect(dups).toHaveLength(1);
    expect(dups[0]?.message).toMatch(/Errors/);
    expect(dups[0]?.message).not.toMatch(/Requests/);
  });

  it('treats duplicateTitles.except as empty when except is omitted (equivalent to true)', () => {
    const dash = baseFixture();
    (dash.panels as Array<Record<string, unknown>>).push({
      id: 2,
      type: 'timeseries',
      title: 'Requests',
      description: 'd',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
      options: { legend: { placement: 'right', displayMode: 'table', calcs: ['mean', 'lastNotNull', 'max'] } },
    });
    const result = lintDashboard(dash, {
      dashboards: { panels: { duplicateTitles: {} } },
    });
    const dups = result.issues.filter(
      (i) => i.ruleId === 'dashboards.panels.duplicateTitles',
    );
    expect(dups).toHaveLength(1);
    expect(dups[0]?.message).toMatch(/Requests/);
  });

  it('still fires duplicateTitles when except is empty array', () => {
    const dash = baseFixture();
    (dash.panels as Array<Record<string, unknown>>).push({
      id: 2,
      type: 'timeseries',
      title: 'Requests',
      description: 'd',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
      options: { legend: { placement: 'right', displayMode: 'table', calcs: ['mean', 'lastNotNull', 'max'] } },
    });
    const result = lintDashboard(dash, {
      dashboards: { panels: { duplicateTitles: { except: [] } } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.duplicateTitles'),
    ).toHaveLength(1);
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

  // Smoke test: run lintDashboard against the real-world Node Exporter
  // Full fixture (141 panels, 16 rows, mixed legacy/modern format) with
  // all rules enabled. Catches walker regressions on a representative
  // production dashboard. Loose assertions — we don't assert specific
  // issue counts because those are real-world quirks the user resolves
  // case-by-case; we assert no crash, finite output, and well-formed
  // issue shape.
  it('runs cleanly on the Node Exporter Full fixture', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');

    const fixturePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../fixtures/node-exporter-full.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;

    const result = lintDashboard(fixture, {
      panels: {
        units: { allowList: ['short', 'percent', 'percentunit', 'reqps', 'ops', 'bytes', 's'] },
        descriptions: { required: true },
      },
      dashboards: {
        panels: { duplicateTitles: true },
        variables: { hiddenButReferenced: true, emptyDefault: true },
      },
    });

    // No crash; bounded result; every issue is well-formed.
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.issues.length).toBeLessThanOrEqual(100);
    for (const issue of result.issues) {
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.ruleId).toBe('string');
      expect(typeof issue.message).toBe('string');
      expect(['warn', 'info']).toContain(issue.severity);
    }
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

describe('lintDashboard - dashboards.panels.maxRepeat (issue #51)', () => {
  // Helper: dashboard with one repeat panel + one templating variable.
  const makeRepeatDashboard = (
    varOptions: Array<{ text: string; value: string }> | undefined,
    currentValue: unknown = undefined,
  ): Record<string, unknown> => ({
    title: 'Repeat',
    templating: {
      list: [
        {
          name: 'host',
          type: 'query',
          ...(varOptions !== undefined ? { options: varOptions } : {}),
          ...(currentValue !== undefined ? { current: { value: currentValue } } : {}),
        },
      ],
    },
    panels: [
      {
        id: 1,
        type: 'timeseries',
        title: 'Per-host load',
        description: 'd',
        fieldConfig: { defaults: { unit: 'short' } },
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        repeat: 'host',
      },
    ],
  });

  it('does NOT fire when cardinality is at or below the threshold', () => {
    const opts = Array.from({ length: 10 }, (_, i) => ({ text: `h${i}`, value: `h${i}` }));
    const dash = makeRepeatDashboard(opts);
    const result = lintDashboard(dash, {
      dashboards: { panels: { maxRepeat: 10 } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.maxRepeat'),
    ).toEqual([]);
  });

  it('fires when cardinality exceeds the threshold (cardinality + max in message)', () => {
    const opts = Array.from({ length: 25 }, (_, i) => ({ text: `h${i}`, value: `h${i}` }));
    const dash = makeRepeatDashboard(opts);
    const result = lintDashboard(dash, {
      dashboards: { panels: { maxRepeat: 10 } },
    });
    const issues = result.issues.filter((i) => i.ruleId === 'dashboards.panels.maxRepeat');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('warn');
    expect(issues[0]?.message).toMatch(/cardinality 25/);
    expect(issues[0]?.message).toMatch(/max of 10/);
    expect(issues[0]?.message).toMatch(/Top-N table|heatmap|state-timeline/);
    expect(issues[0]?.panelId).toBe(1);
    expect(issues[0]?.panelTitle).toBe('Per-host load');
    expect(issues[0]?.path).toBe('panels[0].repeat');
  });

  it('accepts both `number` and `{ max: number }` shapes equivalently', () => {
    const opts = Array.from({ length: 15 }, (_, i) => ({ text: `h${i}`, value: `h${i}` }));
    const dash = makeRepeatDashboard(opts);
    const a = lintDashboard(dash, { dashboards: { panels: { maxRepeat: 10 } } });
    const b = lintDashboard(dash, { dashboards: { panels: { maxRepeat: { max: 10 } } } });
    expect(a.issues.filter((i) => i.ruleId === 'dashboards.panels.maxRepeat')).toHaveLength(1);
    expect(b.issues.filter((i) => i.ruleId === 'dashboards.panels.maxRepeat')).toHaveLength(1);
  });

  it('emits a structural finding when repeat references an undefined variable', () => {
    const dash = {
      title: 'Broken',
      templating: { list: [{ name: 'env', type: 'custom', current: { value: 'prod' } }] },
      panels: [
        {
          id: 7,
          type: 'timeseries',
          title: 'Broken repeat',
          description: 'd',
          fieldConfig: { defaults: { unit: 'short' } },
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          repeat: 'host', // not in templating.list[]
        },
      ],
    };
    const result = lintDashboard(dash, {
      dashboards: { panels: { maxRepeat: 10 } },
    });
    const issues = result.issues.filter((i) => i.ruleId === 'dashboards.panels.maxRepeat');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/no such variable/);
    expect(issues[0]?.panelId).toBe(7);
  });

  it('skips non-repeat panels entirely', () => {
    const dash = {
      title: 'No repeat',
      templating: { list: [] },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'Normal',
          description: 'd',
          fieldConfig: { defaults: { unit: 'short' } },
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          // no repeat: field
        },
      ],
    };
    const result = lintDashboard(dash, {
      dashboards: { panels: { maxRepeat: 10 } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.maxRepeat'),
    ).toEqual([]);
  });

  it('reads cardinality from current.value (multi-select array) when options[] absent', () => {
    const dash = makeRepeatDashboard(undefined, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
    const result = lintDashboard(dash, {
      dashboards: { panels: { maxRepeat: 10 } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.maxRepeat'),
    ).toHaveLength(1);
  });

  it('excludes the synthetic $__all option from cardinality count', () => {
    // Grafana's "All" option ($__all) shouldn't inflate cardinality —
    // 10 real options + the $__all entry should NOT fire when max=10.
    const opts = [
      { text: 'All', value: '$__all' },
      ...Array.from({ length: 10 }, (_, i) => ({ text: `h${i}`, value: `h${i}` })),
    ];
    const dash = makeRepeatDashboard(opts);
    const result = lintDashboard(dash, {
      dashboards: { panels: { maxRepeat: 10 } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.maxRepeat'),
    ).toEqual([]);
  });

  it('no-ops when the rule config is absent (no maxRepeat in guide)', () => {
    const opts = Array.from({ length: 100 }, (_, i) => ({ text: `h${i}`, value: `h${i}` }));
    const dash = makeRepeatDashboard(opts);
    // Guide has no maxRepeat at all → no fire, no error.
    const result = lintDashboard(dash, { dashboards: { panels: {} } });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.maxRepeat'),
    ).toEqual([]);
  });
});

describe('lintDashboard - dashboards.links.preservesVariables (issue #52)', () => {
  const dashWithVars = (
    panelLinks: Array<Record<string, unknown>>,
  ): Record<string, unknown> => ({
    title: 'Links',
    templating: {
      list: [
        { name: 'cluster', type: 'query', current: { value: 'prod' } },
        { name: 'namespace', type: 'query', current: { value: 'web' } },
      ],
    },
    panels: [
      {
        id: 1,
        type: 'timeseries',
        title: 'Service health',
        description: 'd',
        fieldConfig: { defaults: { unit: 'short' } },
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        links: panelLinks,
      },
    ],
  });

  it('does NOT fire when the link preserves every variable', () => {
    const dash = dashWithVars([
      { title: 'Drill', url: '/d/abc/detail?var-cluster=${cluster}&var-namespace=${namespace}' },
    ]);
    const result = lintDashboard(dash, {
      dashboards: { links: { preservesVariables: true } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.links.preservesVariables'),
    ).toEqual([]);
  });

  it('fires when the link drops every variable', () => {
    const dash = dashWithVars([{ title: 'Lost', url: '/d/abc/detail' }]);
    const result = lintDashboard(dash, {
      dashboards: { links: { preservesVariables: true } },
    });
    const issues = result.issues.filter(
      (i) => i.ruleId === 'dashboards.links.preservesVariables',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('info');
    expect(issues[0]?.message).toMatch(/\$cluster/);
    expect(issues[0]?.message).toMatch(/\$namespace/);
    expect(issues[0]?.panelId).toBe(1);
    expect(issues[0]?.path).toBe('panels[0].links[0].url');
  });

  it('does NOT fire on a partial drop (intentional drill-up)', () => {
    // Per-namespace → per-cluster drill-up: drops $namespace on purpose
    // but keeps $cluster. Rule fires only on links that drop ALL.
    const dash = dashWithVars([
      { title: 'Drill up', url: '/d/abc/cluster?var-cluster=${cluster}' },
    ]);
    const result = lintDashboard(dash, {
      dashboards: { links: { preservesVariables: true } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.links.preservesVariables'),
    ).toEqual([]);
  });

  it('ignores external (non-dashboard) URLs', () => {
    const dash = dashWithVars([
      { title: 'Docs', url: 'https://example.com/runbook/service' },
      { title: 'GitHub', url: 'https://github.com/team/repo/issues' },
    ]);
    const result = lintDashboard(dash, {
      dashboards: { links: { preservesVariables: true } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.links.preservesVariables'),
    ).toEqual([]);
  });

  it('accepts $var (bare) syntax in addition to ${var}', () => {
    const dash = dashWithVars([
      { title: 'Drill', url: '/d/abc/detail?var-cluster=$cluster&var-namespace=$namespace' },
    ]);
    const result = lintDashboard(dash, {
      dashboards: { links: { preservesVariables: true } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.links.preservesVariables'),
    ).toEqual([]);
  });

  it('checks fieldConfig.defaults.links[] in addition to panel.links[]', () => {
    const dash = {
      title: 'Field links',
      templating: { list: [{ name: 'env', type: 'query', current: { value: 'prod' } }] },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'Service',
          description: 'd',
          fieldConfig: {
            defaults: {
              unit: 'short',
              links: [{ title: 'Drill', url: '/d/abc/detail' }],
            },
          },
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
      ],
    };
    const result = lintDashboard(dash, {
      dashboards: { links: { preservesVariables: true } },
    });
    const issues = result.issues.filter(
      (i) => i.ruleId === 'dashboards.links.preservesVariables',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('panels[0].fieldConfig.defaults.links[0].url');
  });

  it('no-ops when the dashboard has no templating variables', () => {
    const dash = {
      title: 't',
      templating: { list: [] },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'p',
          description: 'd',
          fieldConfig: { defaults: { unit: 'short' } },
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          links: [{ title: 'Drill', url: '/d/abc/detail' }],
        },
      ],
    };
    const result = lintDashboard(dash, {
      dashboards: { links: { preservesVariables: true } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.links.preservesVariables'),
    ).toEqual([]);
  });

  it('no-ops when the rule is false / absent', () => {
    const dash = dashWithVars([{ title: 'Lost', url: '/d/abc/detail' }]);
    const a = lintDashboard(dash, { dashboards: { links: { preservesVariables: false } } });
    const b = lintDashboard(dash, { dashboards: {} });
    expect(
      a.issues.filter((i) => i.ruleId === 'dashboards.links.preservesVariables'),
    ).toEqual([]);
    expect(
      b.issues.filter((i) => i.ruleId === 'dashboards.links.preservesVariables'),
    ).toEqual([]);
  });

  it('does NOT mis-flag external URLs that happen to contain "/d/" as a substring', () => {
    // Regression test: a substring-match check would mis-flag
    // `https://example.com/some-/d/-name/x` because it contains `/d/`.
    // The URL-parsing implementation correctly reads `pathname`
    // (`/some-/d/-name/x`) which does NOT start with `/d/` or
    // `/dashboard/`, so the URL is treated as external and ignored.
    const dash = dashWithVars([
      { title: 'Tricky', url: 'https://example.com/some-/d/-name/x' },
    ]);
    const result = lintDashboard(dash, {
      dashboards: { links: { preservesVariables: true } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.links.preservesVariables'),
    ).toEqual([]);
  });

  it('walks dashboard-header dashboard.links[] and omits panelId on those findings', () => {
    const dash = {
      title: 't',
      templating: { list: [{ name: 'env', type: 'query', current: { value: 'prod' } }] },
      links: [
        { title: 'Drill', url: '/d/abc/detail' }, // drops $env, should fire
        { title: 'External', url: 'https://example.com/runbook' }, // ignored
      ],
      panels: [],
    };
    const result = lintDashboard(dash, {
      dashboards: { links: { preservesVariables: true } },
    });
    const issues = result.issues.filter(
      (i) => i.ruleId === 'dashboards.links.preservesVariables',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('links[0].url');
    // Dashboard-header links have no panel context — both omitted.
    expect(issues[0]?.panelId).toBeUndefined();
    expect(issues[0]?.panelTitle).toBeUndefined();
  });
});

describe('lintDashboard - maxRepeat edge cases (issue #51 review fixes)', () => {
  it('returns cardinality 0 (no fire) when options contains only $__all', () => {
    // The only resolved option is the synthetic "All" sentinel. A
    // text-fallback check would mis-read current.text="All" as
    // cardinality 1; the fix returns 0 and skips.
    const dash = {
      title: 'AllOnly',
      templating: {
        list: [
          {
            name: 'host',
            type: 'query',
            options: [{ text: 'All', value: '$__all' }],
            current: { text: 'All', value: '$__all' },
          },
        ],
      },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'Per-host',
          description: 'd',
          fieldConfig: { defaults: { unit: 'short' } },
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          repeat: 'host',
        },
      ],
    };
    const result = lintDashboard(dash, {
      dashboards: { panels: { maxRepeat: 10 } },
    });
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.maxRepeat'),
    ).toEqual([]);
  });

  it('walks panels nested inside a row panel (row-internal repeat)', () => {
    // Repeats can live on panels inside a row, not just at the top
    // level. Regression test: the row-traversal walked nested panels
    // for duplicateTitles; this confirms it also walks for maxRepeat.
    const opts = Array.from({ length: 25 }, (_, i) => ({ text: `h${i}`, value: `h${i}` }));
    const dash = {
      title: 'Nested',
      templating: { list: [{ name: 'host', type: 'query', options: opts }] },
      panels: [
        {
          id: 1,
          type: 'row',
          title: 'Section',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            {
              id: 2,
              type: 'timeseries',
              title: 'Per-host',
              description: 'd',
              fieldConfig: { defaults: { unit: 'short' } },
              gridPos: { x: 0, y: 1, w: 12, h: 8 },
              repeat: 'host',
            },
          ],
        },
      ],
    };
    const result = lintDashboard(dash, {
      dashboards: { panels: { maxRepeat: 10 } },
    });
    const issues = result.issues.filter(
      (i) => i.ruleId === 'dashboards.panels.maxRepeat',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('panels[0].panels[0].repeat');
    expect(issues[0]?.panelId).toBe(2);
  });
});

describe('lintDashboard - dashboards.panels.datasourceDeclared (datasource gap)', () => {
  // Closes the team-retrospective finding: panels without a datasource
  // render against the Grafana instance default — if no default is
  // set, the panel queries nothing and renders blank. Silent broken
  // dashboard. The rule fires on any non-row panel missing a
  // `datasource` field. Row panels are excluded (rows don't query).
  function panel(extras: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 1,
      type: 'timeseries',
      title: 'X',
      description: 'd',
      fieldConfig: { defaults: { unit: 'short' } },
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      ...extras,
    };
  }

  const guide = { dashboards: { panels: { datasourceDeclared: true } } };

  it('fires on a panel with no datasource field', () => {
    const dash = { title: 'd', panels: [panel()] };
    const result = lintDashboard(dash, guide);
    const issue = result.issues.find(
      (i) => i.ruleId === 'dashboards.panels.datasourceDeclared',
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warn');
    expect(issue?.path).toBe('panels[0].datasource');
    expect(issue?.panelId).toBe(1);
    expect(issue?.message).toMatch(/datasource/i);
  });

  it('does NOT fire on a panel with an object-form datasource', () => {
    const dash = {
      title: 'd',
      panels: [panel({ datasource: { uid: 'prometheus-prod', type: 'prometheus' } })],
    };
    const result = lintDashboard(dash, guide);
    expect(
      result.issues.find((i) => i.ruleId === 'dashboards.panels.datasourceDeclared'),
    ).toBeUndefined();
  });

  it('does NOT fire on a panel with a legacy string datasource', () => {
    const dash = { title: 'd', panels: [panel({ datasource: 'Prometheus' })] };
    const result = lintDashboard(dash, guide);
    expect(
      result.issues.find((i) => i.ruleId === 'dashboards.panels.datasourceDeclared'),
    ).toBeUndefined();
  });

  it('fires on a datasource: {} object with no uid AND no type (empty ref)', () => {
    // Grafana renders an empty datasource ref the same as a missing
    // one — the panel falls back to the instance default. Treat empty
    // as missing so we catch the case where a builder produced
    // `datasource: {}` by accident.
    const dash = { title: 'd', panels: [panel({ datasource: {} })] };
    const result = lintDashboard(dash, guide);
    expect(
      result.issues.find((i) => i.ruleId === 'dashboards.panels.datasourceDeclared'),
    ).toBeDefined();
  });

  it('does NOT fire on a templating-variable datasource (uid: "$datasource")', () => {
    // Datasource-as-variable is the standard multi-environment pattern;
    // the panel resolves at render time. Must not flag.
    const dash = {
      title: 'd',
      panels: [panel({ datasource: { uid: '$datasource', type: 'prometheus' } })],
    };
    const result = lintDashboard(dash, guide);
    expect(
      result.issues.find((i) => i.ruleId === 'dashboards.panels.datasourceDeclared'),
    ).toBeUndefined();
  });

  it('does NOT fire on row panels (rows do not query)', () => {
    const dash = {
      title: 'd',
      panels: [
        { id: 9, type: 'row', title: 'Section', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
      ],
    };
    const result = lintDashboard(dash, guide);
    expect(
      result.issues.filter((i) => i.ruleId === 'dashboards.panels.datasourceDeclared'),
    ).toEqual([]);
  });

  it('walks legacy row.panels[] and flags missing datasource on nested children', () => {
    const dash = {
      title: 'd',
      panels: [
        {
          id: 9,
          type: 'row',
          title: 'Section',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            {
              id: 11,
              type: 'timeseries',
              title: 'Nested',
              description: 'd',
              fieldConfig: { defaults: { unit: 'short' } },
              gridPos: { x: 0, y: 1, w: 12, h: 8 },
              // no datasource
            },
          ],
        },
      ],
    };
    const result = lintDashboard(dash, guide);
    const issue = result.issues.find(
      (i) => i.ruleId === 'dashboards.panels.datasourceDeclared',
    );
    expect(issue).toBeDefined();
    expect(issue?.path).toBe('panels[0].panels[0].datasource');
    expect(issue?.panelId).toBe(11);
  });

  it('does NOT fire when datasourceDeclared is false (rule disabled)', () => {
    const dash = { title: 'd', panels: [panel()] };
    const result = lintDashboard(dash, {
      dashboards: { panels: { datasourceDeclared: false } },
    });
    expect(
      result.issues.find((i) => i.ruleId === 'dashboards.panels.datasourceDeclared'),
    ).toBeUndefined();
  });

  it('does NOT fire when dashboards.panels slice is absent from the guide', () => {
    const dash = { title: 'd', panels: [panel()] };
    const result = lintDashboard(dash, { dashboards: { variables: { emptyDefault: true } } });
    expect(
      result.issues.find((i) => i.ruleId === 'dashboards.panels.datasourceDeclared'),
    ).toBeUndefined();
  });
});

describe('lintDashboard - dashboards.layout.firstRowCategorical (issue #54)', () => {
  // The fold (first row) of an OVERVIEW dashboard should lead with
  // categorical health (state-timeline + alertlist), not a wall of
  // numbers. Scoping is mandatory: the rule fires only on dashboards
  // the author marks as overview (via tag) or, with bare `true`, on
  // every dashboard. Drill-downs legitimately open with timeseries.
  const RULE = 'dashboards.layout.firstRowCategorical';

  function statPanel(id: number, x: number): Record<string, unknown> {
    return { id, type: 'stat', title: `S${id}`, gridPos: { x, y: 0, w: 6, h: 4 } };
  }
  function timeseriesPanel(id: number, y: number): Record<string, unknown> {
    return { id, type: 'timeseries', title: `T${id}`, gridPos: { x: 0, y, w: 12, h: 8 } };
  }
  function stateTimeline(id: number, x: number): Record<string, unknown> {
    return { id, type: 'state-timeline', title: `Health`, gridPos: { x, y: 0, w: 12, h: 6 } };
  }

  const tagged = { dashboards: { layout: { firstRowCategorical: { overviewTag: 'overview' } } } };

  it('fires when a tagged overview dashboard opens with a wall of numbers', () => {
    const dash = {
      title: 'Service overview',
      tags: ['overview', 'prod'],
      panels: [statPanel(1, 0), statPanel(2, 6), timeseriesPanel(3, 4)],
    };
    const result = lintDashboard(dash, tagged);
    const issue = result.issues.find((i) => i.ruleId === RULE);
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warn');
    expect(issue?.path).toBe('panels');
    expect(issue?.message).toMatch(/state-timeline/);
    // The fold is the y=0 band only; the y=4 timeseries is row 2.
    expect(issue?.message).toMatch(/stat, stat/);
  });

  it('does NOT fire when the fold already carries a state-timeline', () => {
    const dash = {
      title: 'Service overview',
      tags: ['overview'],
      panels: [stateTimeline(1, 0), statPanel(2, 12), timeseriesPanel(3, 8)],
    };
    const result = lintDashboard(dash, tagged);
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('does NOT fire on a dashboard that lacks the overview tag (drill-down)', () => {
    const dash = {
      title: 'Pod drill-down',
      tags: ['per-pod'],
      panels: [timeseriesPanel(1, 0), timeseriesPanel(2, 8)],
    };
    const result = lintDashboard(dash, tagged);
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('does NOT fire on a dashboard with no tags when a tag is required', () => {
    const dash = { title: 'd', panels: [statPanel(1, 0)] };
    const result = lintDashboard(dash, tagged);
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('with bare true, fires on any dashboard regardless of tags', () => {
    const dash = { title: 'd', panels: [statPanel(1, 0), statPanel(2, 6)] };
    const result = lintDashboard(dash, {
      dashboards: { layout: { firstRowCategorical: true } },
    });
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeDefined();
  });

  it('does NOT fire on a text-only header fold (no numeric/graph panels)', () => {
    const dash = {
      title: 'd',
      tags: ['overview'],
      panels: [
        { id: 1, type: 'text', title: 'Welcome', gridPos: { x: 0, y: 0, w: 24, h: 3 } },
        { id: 2, type: 'stat', title: 'S2', gridPos: { x: 0, y: 3, w: 6, h: 4 } },
      ],
    };
    const result = lintDashboard(dash, tagged);
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('ignores a leading row marker and reads the first positioned panel band', () => {
    const dash = {
      title: 'd',
      tags: ['overview'],
      panels: [
        { id: 1, type: 'row', title: 'Top', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
        { id: 2, type: 'stat', title: 'S2', gridPos: { x: 0, y: 1, w: 6, h: 4 } },
        { id: 3, type: 'timeseries', title: 'T3', gridPos: { x: 0, y: 9, w: 12, h: 8 } },
      ],
    };
    const result = lintDashboard(dash, tagged);
    // Fold = y=1 band (one stat), no categorical → fires.
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeDefined();
  });

  it('skips when no top-level panel declares a gridPos', () => {
    const dash = {
      title: 'd',
      tags: ['overview'],
      panels: [{ id: 1, type: 'stat', title: 'S' }],
    };
    const result = lintDashboard(dash, tagged);
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('does NOT fire when firstRowCategorical is absent from the guide', () => {
    const dash = {
      title: 'd',
      tags: ['overview'],
      panels: [statPanel(1, 0)],
    };
    const result = lintDashboard(dash, { dashboards: { panels: { duplicateTitles: true } } });
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });
});

describe('lintDashboard - dashboards.panels.orphanRow (issue #91)', () => {
  const RULE = 'dashboards.panels.orphanRow';
  const guide = { dashboards: { panels: { orphanRow: true } } };

  const ts = (id: number, y: number) => ({
    id,
    type: 'timeseries',
    title: `T${id}`,
    gridPos: { x: 0, y, w: 12, h: 8 },
  });
  const row = (id: number, y: number, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'row',
    title: `R${id}`,
    gridPos: { x: 0, y, w: 24, h: 1 },
    ...extra,
  });

  it('fires on a trailing empty row (flat layout, last panel)', () => {
    const dash = { title: 'd', panels: [ts(1, 0), row(2, 9)] };
    const result = lintDashboard(dash, guide);
    const issue = result.issues.find((i) => i.ruleId === RULE);
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('info');
    expect(issue?.path).toBe('panels[1]');
    expect(issue?.panelId).toBe(2);
  });

  it('fires on a row immediately followed by another row (flat layout)', () => {
    const dash = { title: 'd', panels: [row(1, 0), row(2, 1), ts(3, 2)] };
    const result = lintDashboard(dash, guide);
    const orphans = result.issues.filter((i) => i.ruleId === RULE);
    // Row 1 is followed by a row → orphan. Row 2 owns the timeseries → not.
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.panelId).toBe(1);
  });

  it('does NOT fire on an expanded row with flat-sibling children', () => {
    const dash = { title: 'd', panels: [row(1, 0), ts(2, 1), ts(3, 9)] };
    const result = lintDashboard(dash, guide);
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('does NOT fire on a collapsed row carrying nested children', () => {
    const dash = {
      title: 'd',
      panels: [row(1, 0, { collapsed: true, panels: [ts(2, 1)] })],
    };
    const result = lintDashboard(dash, guide);
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('does NOT fire when the rule is disabled', () => {
    const dash = { title: 'd', panels: [ts(1, 0), row(2, 9)] };
    const result = lintDashboard(dash, { dashboards: { panels: { orphanRow: false } } });
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });
});

describe('lintDashboard - dashboards.variables.unreferenced (issue #91)', () => {
  const RULE = 'dashboards.variables.unreferenced';
  const guide = { dashboards: { variables: { unreferenced: true } } };

  function dash(
    variables: Array<Record<string, unknown>>,
    panels: Array<Record<string, unknown>> = [],
  ): Record<string, unknown> {
    return { title: 'd', templating: { list: variables }, panels };
  }

  it('fires on a variable that is never interpolated', () => {
    const result = lintDashboard(
      dash([{ name: 'unused', type: 'query', current: { value: 'x' } }]),
      guide,
    );
    const issue = result.issues.find((i) => i.ruleId === RULE);
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('info');
    expect(issue?.path).toBe('templating.list[0]');
    expect(issue?.message).toMatch(/unused/);
  });

  it('does NOT fire when the variable is interpolated in a panel target', () => {
    const result = lintDashboard(
      dash(
        [{ name: 'job', type: 'query' }],
        [
          {
            id: 1,
            type: 'timeseries',
            title: 'T',
            gridPos: { x: 0, y: 0, w: 12, h: 8 },
            targets: [{ expr: 'up{job="$job"}' }],
          },
        ],
      ),
      guide,
    );
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('does NOT fire when referenced via ${var} or [[var]] anywhere', () => {
    const braced = lintDashboard(
      dash(
        [{ name: 'env', type: 'custom' }],
        [{ id: 1, type: 'timeseries', title: 'env = ${env}', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
      ),
      guide,
    );
    expect(braced.issues.find((i) => i.ruleId === RULE)).toBeUndefined();

    const legacy = lintDashboard(
      dash(
        [{ name: 'env', type: 'custom' }],
        [{ id: 1, type: 'timeseries', title: '[[env]]', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
      ),
      guide,
    );
    expect(legacy.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('does NOT fire when a variable is used only by a panel repeat (bare name)', () => {
    const result = lintDashboard(
      dash(
        [{ name: 'pod', type: 'query' }],
        [{ id: 1, type: 'timeseries', title: 'T', repeat: 'pod', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
      ),
      guide,
    );
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('does NOT fire when a variable is referenced only by another variable (chained)', () => {
    const result = lintDashboard(
      dash([
        { name: 'cluster', type: 'query' },
        { name: 'namespace', type: 'query', query: 'label_values(up{cluster="$cluster"}, namespace)' },
      ]),
      guide,
    );
    expect(result.issues.find((i) => i.ruleId === RULE && i.message.includes('cluster'))).toBeUndefined();
  });

  it('does NOT fire on adhoc variables (used implicitly, never interpolated)', () => {
    const result = lintDashboard(
      dash([{ name: 'filters', type: 'adhoc' }]),
      guide,
    );
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });

  it('does NOT flag a variable whose name is a substring of a referenced one', () => {
    // `pod` is unused; `pod_name` is referenced. The word-boundary in the
    // regex must not let `$pod_name` count as a reference to `pod`.
    const result = lintDashboard(
      dash(
        [
          { name: 'pod', type: 'query' },
          { name: 'pod_name', type: 'query' },
        ],
        [{ id: 1, type: 'timeseries', title: '$pod_name', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
      ),
      guide,
    );
    const flagged = result.issues.filter((i) => i.ruleId === RULE).map((i) => i.message);
    expect(flagged.some((m) => m.includes('"pod"'))).toBe(true);
    expect(flagged.some((m) => m.includes('"pod_name"'))).toBe(false);
  });

  it('does NOT fire when the rule is disabled', () => {
    const result = lintDashboard(
      dash([{ name: 'unused', type: 'query' }]),
      { dashboards: { variables: { unreferenced: false } } },
    );
    expect(result.issues.find((i) => i.ruleId === RULE)).toBeUndefined();
  });
});
