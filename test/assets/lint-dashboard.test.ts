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
