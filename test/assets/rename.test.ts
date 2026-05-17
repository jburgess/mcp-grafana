import { describe, expect, it } from 'vitest';

import { renameDashboardVariable } from '../../src/assets/rename.js';

// renameDashboardVariable solves the painful problem (cited in issue #31 item 2)
// of a shell-escaped regex mangling `\$` and silently breaking 75 expressions
// while the templating list said "done". The atomic primitive walks every
// place a variable can be referenced and rewrites consistently.

describe('renameDashboardVariable - templating list', () => {
  it('renames the variable definition itself (name field)', () => {
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'role_nchf', type: 'query' },
          { name: 'env', type: 'custom' },
        ],
      },
      panels: [],
    };
    const result = renameDashboardVariable(dash, 'role_nchf', 'roleNchf');
    expect(result.errors).toEqual([]);
    const list = (result.dashboard as { templating: { list: { name: string }[] } })
      .templating.list;
    expect(list[0]?.name).toBe('roleNchf');
    expect(list[1]?.name).toBe('env');
  });

  it('renames matching `label` on the variable when label equals oldName', () => {
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'role_nchf', label: 'role_nchf', type: 'query' },
          { name: 'env', label: 'Environment', type: 'custom' },
        ],
      },
      panels: [],
    };
    const result = renameDashboardVariable(dash, 'role_nchf', 'roleNchf');
    expect(result.errors).toEqual([]);
    const list = (result.dashboard as { templating: { list: { name: string; label: string }[] } })
      .templating.list;
    expect(list[0]?.label).toBe('roleNchf');
    // Unrelated label is left alone.
    expect(list[1]?.label).toBe('Environment');
  });

  it('rewrites references in another variable\'s `query` string', () => {
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'role_nchf', type: 'query' },
          {
            name: 'namespace',
            type: 'query',
            query: 'label_values(metric{role="$role_nchf"}, namespace)',
          },
        ],
      },
      panels: [],
    };
    const result = renameDashboardVariable(dash, 'role_nchf', 'roleNchf');
    expect(result.errors).toEqual([]);
    const ns = (result.dashboard as { templating: { list: Array<{ query?: string }> } })
      .templating.list[1];
    expect(ns?.query).toBe('label_values(metric{role="$roleNchf"}, namespace)');
  });

  it('rewrites references in another variable\'s `definition` field', () => {
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'foo', type: 'query' },
          { name: 'bar', type: 'query', definition: 'label_values(m{x="${foo:csv}"}, bar)' },
        ],
      },
      panels: [],
    };
    const result = renameDashboardVariable(dash, 'foo', 'fooNew');
    expect(result.errors).toEqual([]);
    const bar = (result.dashboard as { templating: { list: Array<{ definition?: string }> } })
      .templating.list[1];
    expect(bar?.definition).toBe('label_values(m{x="${fooNew:csv}"}, bar)');
  });

  it('rewrites a variable.query object\'s nested `query` field', () => {
    // Some Grafana variable definitions use { query: { query: "..." } } shape.
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'foo', type: 'query' },
          { name: 'bar', type: 'query', query: { query: 'label_values(m{x="$foo"}, bar)', refId: 'A' } },
        ],
      },
      panels: [],
    };
    const result = renameDashboardVariable(dash, 'foo', 'fooNew');
    expect(result.errors).toEqual([]);
    const bar = (result.dashboard as {
      templating: { list: Array<{ query?: { query?: string } }> };
    }).templating.list[1];
    expect(bar?.query?.query).toBe('label_values(m{x="$fooNew"}, bar)');
  });
});

describe('renameDashboardVariable - panel target rewrites', () => {
  const fixture = {
    title: 't',
    templating: { list: [{ name: 'role_nchf', type: 'query' }] },
    panels: [
      {
        id: 1,
        type: 'timeseries',
        title: 'Rate',
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        targets: [
          { expr: 'rate(metric{role="$role_nchf"}[$__rate_interval])', refId: 'A' },
          { expr: 'sum by(${role_nchf}) (rate(metric[5m]))', refId: 'B' },
          { expr: 'avg by(${role_nchf:csv}) (m)', refId: 'C' },
          { expr: 'count(m{r="[[role_nchf]]"})', refId: 'D' },
          { expr: 'count(m{r="[[role_nchf:csv]]"})', refId: 'E' },
        ],
      },
    ],
  };

  it('rewrites $bare, ${braced}, ${braced:fmt}, [[legacy]], [[legacy:fmt]] forms in expr', () => {
    const result = renameDashboardVariable(fixture, 'role_nchf', 'roleNchf');
    expect(result.errors).toEqual([]);
    const targets = (result.dashboard as {
      panels: Array<{ targets: Array<{ expr: string }> }>;
    }).panels[0]?.targets;
    expect(targets?.[0]?.expr).toBe('rate(metric{role="$roleNchf"}[$__rate_interval])');
    expect(targets?.[1]?.expr).toBe('sum by(${roleNchf}) (rate(metric[5m]))');
    expect(targets?.[2]?.expr).toBe('avg by(${roleNchf:csv}) (m)');
    expect(targets?.[3]?.expr).toBe('count(m{r="[[roleNchf]]"})');
    expect(targets?.[4]?.expr).toBe('count(m{r="[[roleNchf:csv]]"})');
  });

  it('also rewrites query and rawQuery fields (Loki / SQL targets)', () => {
    const dash = {
      title: 't',
      templating: { list: [{ name: 'foo', type: 'query' }] },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 't',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [
            { query: 'sum({namespace="$foo"})', refId: 'A' },
            { rawQuery: "select * from t where ns = '${foo}'", refId: 'B' },
          ],
        },
      ],
    };
    const result = renameDashboardVariable(dash, 'foo', 'fooNew');
    expect(result.errors).toEqual([]);
    const targets = (result.dashboard as {
      panels: Array<{ targets: Array<{ query?: string; rawQuery?: string }> }>;
    }).panels[0]?.targets;
    expect(targets?.[0]?.query).toBe('sum({namespace="$fooNew"})');
    expect(targets?.[1]?.rawQuery).toBe("select * from t where ns = '${fooNew}'");
  });

  it('does not match partial names ($foo must NOT touch $foobar)', () => {
    const dash = {
      title: 't',
      templating: { list: [{ name: 'foo', type: 'query' }, { name: 'foobar', type: 'query' }] },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 't',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [
            { expr: 'sum($foo) + sum($foobar) + sum(${foo}) + sum(${foobar})', refId: 'A' },
          ],
        },
      ],
    };
    const result = renameDashboardVariable(dash, 'foo', 'baz');
    expect(result.errors).toEqual([]);
    const expr = (result.dashboard as {
      panels: Array<{ targets: Array<{ expr: string }> }>;
    }).panels[0]?.targets[0]?.expr;
    expect(expr).toBe('sum($baz) + sum($foobar) + sum(${baz}) + sum(${foobar})');
  });
});

describe('renameDashboardVariable - other reference sites', () => {
  it('rewrites variable refs in panel titles', () => {
    const dash = {
      title: 't',
      templating: { list: [{ name: 'processor', type: 'query' }] },
      panels: [
        {
          id: 1,
          type: 'row',
          title: 'Processor: $processor',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
        },
        {
          id: 2,
          type: 'timeseries',
          title: 'Rate for ${processor}',
          gridPos: { x: 0, y: 1, w: 12, h: 8 },
        },
      ],
    };
    const result = renameDashboardVariable(dash, 'processor', 'proc');
    expect(result.errors).toEqual([]);
    const panels = (result.dashboard as { panels: Array<{ title: string }> }).panels;
    expect(panels[0]?.title).toBe('Processor: $proc');
    expect(panels[1]?.title).toBe('Rate for ${proc}');
  });

  it('rewrites variable refs in panel descriptions', () => {
    const dash = {
      title: 't',
      templating: { list: [{ name: 'foo', type: 'query' }] },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 't',
          description: 'rate per ${foo}',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
      ],
    };
    const result = renameDashboardVariable(dash, 'foo', 'bar');
    expect(result.errors).toEqual([]);
    const panel = (result.dashboard as { panels: Array<{ description: string }> }).panels[0];
    expect(panel?.description).toBe('rate per ${bar}');
  });

  it('rewrites datasource references (string form and object.uid form)', () => {
    const dash = {
      title: 't',
      templating: { list: [{ name: 'ds', type: 'datasource' }] },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'string-form',
          datasource: '$ds',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [{ expr: 'up', refId: 'A', datasource: { uid: '${ds}', type: 'prometheus' } }],
        },
      ],
    };
    const result = renameDashboardVariable(dash, 'ds', 'datasource');
    expect(result.errors).toEqual([]);
    const panel = (result.dashboard as {
      panels: Array<{ datasource: string; targets: Array<{ datasource: { uid: string } }> }>;
    }).panels[0];
    expect(panel?.datasource).toBe('$datasource');
    expect(panel?.targets[0]?.datasource?.uid).toBe('${datasource}');
  });

  it('rewrites the panel/row `repeat` field when it exact-matches oldName', () => {
    // `repeat` names a variable to iterate over; it's an exact name, not an interpolation.
    const dash = {
      title: 't',
      templating: { list: [{ name: 'foo', type: 'query' }] },
      panels: [
        {
          id: 1,
          type: 'row',
          title: 'r',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          repeat: 'foo',
        },
        {
          id: 2,
          type: 'timeseries',
          title: 't',
          gridPos: { x: 0, y: 1, w: 12, h: 8 },
          repeat: 'foo',
        },
        {
          id: 3,
          type: 'timeseries',
          title: 't',
          gridPos: { x: 12, y: 1, w: 12, h: 8 },
          repeat: 'unrelated',
        },
      ],
    };
    const result = renameDashboardVariable(dash, 'foo', 'bar');
    expect(result.errors).toEqual([]);
    const panels = (result.dashboard as { panels: Array<{ repeat?: string }> }).panels;
    expect(panels[0]?.repeat).toBe('bar');
    expect(panels[1]?.repeat).toBe('bar');
    expect(panels[2]?.repeat).toBe('unrelated');
  });

  it('walks legacy row.panels[] nested panels too', () => {
    const dash = {
      title: 't',
      templating: { list: [{ name: 'foo', type: 'query' }] },
      panels: [
        {
          id: 1,
          type: 'row',
          title: 'R',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            {
              id: 2,
              type: 'timeseries',
              title: 'nested ${foo}',
              gridPos: { x: 0, y: 1, w: 12, h: 8 },
              targets: [{ expr: 'rate(m{x="$foo"}[1m])', refId: 'A' }],
            },
          ],
        },
      ],
    };
    const result = renameDashboardVariable(dash, 'foo', 'bar');
    expect(result.errors).toEqual([]);
    const nested = (result.dashboard as {
      panels: Array<{ panels?: Array<{ title: string; targets: Array<{ expr: string }> }> }>;
    }).panels[0]?.panels?.[0];
    expect(nested?.title).toBe('nested ${bar}');
    expect(nested?.targets[0]?.expr).toBe('rate(m{x="$bar"}[1m])');
  });
});

describe('renameDashboardVariable - errors', () => {
  const dash = {
    title: 't',
    templating: {
      list: [
        { name: 'foo', type: 'query' },
        { name: 'bar', type: 'query' },
      ],
    },
    panels: [],
  };

  it('errors when oldName is not declared in templating.list', () => {
    const result = renameDashboardVariable(dash, 'missing', 'whatever');
    expect(result.dashboard).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('templating.list');
    expect(result.errors[0]?.message).toMatch(/no variable named "missing"/);
  });

  it('errors when newName collides with an existing variable', () => {
    const result = renameDashboardVariable(dash, 'foo', 'bar');
    expect(result.dashboard).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('templating.list');
    expect(result.errors[0]?.message).toMatch(/already exists/);
  });

  it('errors when newName is empty', () => {
    const result = renameDashboardVariable(dash, 'foo', '');
    expect(result.dashboard).toBeUndefined();
    expect(result.errors[0]?.message).toMatch(/not a valid Grafana variable name/);
  });

  it('errors when newName starts with a digit', () => {
    const result = renameDashboardVariable(dash, 'foo', '1bad');
    expect(result.dashboard).toBeUndefined();
    expect(result.errors[0]?.message).toMatch(/not a valid Grafana variable name/);
  });

  it('errors when newName contains illegal characters', () => {
    const result = renameDashboardVariable(dash, 'foo', 'bad-name');
    expect(result.dashboard).toBeUndefined();
    expect(result.errors[0]?.message).toMatch(/not a valid Grafana variable name/);
  });

  it('errors when dashboard is not an object', () => {
    const result = renameDashboardVariable(null, 'a', 'b');
    expect(result.dashboard).toBeUndefined();
    expect(result.errors[0]?.path).toBe('$');
  });

  it('no-op succeeds when oldName equals newName (rewrites: 0)', () => {
    const result = renameDashboardVariable(dash, 'foo', 'foo');
    expect(result.errors).toEqual([]);
    expect(result.rewrites).toBe(0);
    expect(result.dashboard).toBeDefined();
  });
});

describe('renameDashboardVariable - bookkeeping', () => {
  it('reports a rewrite count and JSONPath locations', () => {
    const dash = {
      title: 't',
      templating: {
        list: [
          { name: 'foo', label: 'foo', type: 'query' },
        ],
      },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'rate $foo',
          description: 'in ${foo}',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [{ expr: 'rate(m{x="$foo"}[1m])', refId: 'A' }],
        },
      ],
    };
    const result = renameDashboardVariable(dash, 'foo', 'bar');
    expect(result.errors).toEqual([]);
    // 1 name + 1 label + 1 title + 1 description + 1 expr = 5
    expect(result.rewrites).toBe(5);
    // Spot-check some expected locations.
    expect(result.locations).toContain('templating.list[0].name');
    expect(result.locations).toContain('templating.list[0].label');
    expect(result.locations).toContain('panels[0].title');
    expect(result.locations).toContain('panels[0].description');
    expect(result.locations).toContain('panels[0].targets[0].expr');
  });

  it('does not mutate the input dashboard', () => {
    const dash = {
      title: 't',
      templating: { list: [{ name: 'foo', type: 'query' }] },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'rate $foo',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [{ expr: 'rate(m{x="$foo"}[1m])', refId: 'A' }],
        },
      ],
    };
    const before = JSON.stringify(dash);
    renameDashboardVariable(dash, 'foo', 'bar');
    expect(JSON.stringify(dash)).toBe(before);
  });
});
