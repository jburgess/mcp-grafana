import { describe, expect, it } from 'vitest';

import { findPanels } from '../../src/assets/find.js';

// findPanels returns the ids of every panel matching a closed-set
// filter. Designed as the precursor to bulk operations (#3 bulk_update):
// "find all timeseries panels with unit 'short' whose query uses
// rate()" → list of ids → bulk update them.

const fixture = (): Record<string, unknown> => ({
  title: 't',
  templating: { list: [] },
  panels: [
    { id: 1, type: 'row', title: 'Section A', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
    {
      id: 2,
      type: 'timeseries',
      title: 'Requests',
      description: 'Request rate',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 0, y: 1, w: 12, h: 8 },
      targets: [{ expr: 'rate(http_requests_total[5m])' }],
    },
    {
      id: 3,
      type: 'timeseries',
      title: 'Errors',
      // description missing
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 12, y: 1, w: 12, h: 8 },
      targets: [{ expr: 'rate(errors_total[5m])' }],
    },
    {
      id: 4,
      type: 'stat',
      title: 'Heap',
      description: 'd',
      fieldConfig: { defaults: { unit: 'bytes' } },
      gridPos: { x: 0, y: 9, w: 6, h: 4 },
      targets: [{ expr: 'go_memstats_heap_inuse_bytes' }],
    },
    {
      id: 5,
      type: 'row',
      title: 'Section B',
      gridPos: { x: 0, y: 13, w: 24, h: 1 },
      // Legacy row-nested panel
      panels: [
        {
          id: 6,
          type: 'timeseries',
          title: 'Nested',
          description: 'd',
          fieldConfig: { defaults: { unit: 'short' } },
          gridPos: { x: 0, y: 14, w: 12, h: 8 },
          targets: [{ query: 'sum by (job) (up)', refId: 'A' }],
        },
      ],
    },
  ],
});

describe('findPanels - filter combinations', () => {
  it('returns every panel id when filter is empty', () => {
    const result = findPanels(fixture(), {});
    expect(result.errors).toEqual([]);
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('filters by type: matches only that type', () => {
    const result = findPanels(fixture(), { type: 'timeseries' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([2, 3, 6]);
  });

  it('filters by type: row matches row panels too', () => {
    const result = findPanels(fixture(), { type: 'row' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([1, 5]);
  });

  it('filters by unit: matches panels with that fieldConfig.defaults.unit', () => {
    const result = findPanels(fixture(), { unit: 'reqps' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([2, 3]);
  });

  it('filters by hasDescription: true matches panels with a non-empty description', () => {
    // Per the project convention (PR #32): empty-string description
    // counts as missing. Rows are excluded entirely from
    // description-shaped filters (they're section markers).
    const result = findPanels(fixture(), { hasDescription: true });
    expect(result.errors).toEqual([]);
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([2, 4, 6]);
  });

  it('filters by hasDescription: false matches panels missing one (empty-string included)', () => {
    const dash = fixture();
    // Mutate panel 4 to have an empty-string description to verify
    // the empty-as-missing rule holds.
    (dash.panels as Array<Record<string, unknown>>)[3]!.description = '';
    const result = findPanels(dash, { hasDescription: false });
    expect(result.errors).toEqual([]);
    // Row panels (1, 5) are excluded entirely from description filtering.
    // Panel 3 has no description; panel 4 now has empty-string.
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([3, 4]);
  });

  it('filters by queryMatches: regex against expr / query / rawQuery', () => {
    const result = findPanels(fixture(), { queryMatches: 'rate\\(' });
    expect(result.errors).toEqual([]);
    // Panels 2 and 3 use rate(); panel 6 uses sum().
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([2, 3]);
  });

  it('queryMatches walks expr → query → rawQuery (matches lintPanel / validate precedent)', () => {
    // Panel 6's target uses `query:` not `expr:` (Loki/generic form).
    const result = findPanels(fixture(), { queryMatches: 'sum by' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds).toEqual([6]);
  });

  // BUG-1 regression: the `??` fallback used to read `asString(t.expr)`
  // which returns `""` for an empty string (defined), short-circuiting
  // the chain before `query`/`rawQuery` were tried. Same bug class as
  // PR #32 description, PR #32-round-2 legendFormat, PR #35 expr-
  // fallback. Now uses shared `nonEmptyString` so `""` falls through.
  it('queryMatches walks PAST an empty expr to query / rawQuery', () => {
    const dash = {
      title: 't',
      panels: [
        // expr is empty, query carries the real pattern — must match.
        {
          id: 1,
          type: 'timeseries',
          title: 'a',
          fieldConfig: { defaults: { unit: 'reqps' } },
          targets: [{ expr: '', query: 'rate(http_requests_total[5m])' }],
        },
        // expr is empty, query is empty, rawQuery carries it.
        {
          id: 2,
          type: 'timeseries',
          title: 'b',
          fieldConfig: { defaults: { unit: 'reqps' } },
          targets: [{ expr: '', query: '', rawQuery: 'rate(foo)' }],
        },
        // No matching content anywhere.
        {
          id: 3,
          type: 'timeseries',
          title: 'c',
          fieldConfig: { defaults: { unit: 'reqps' } },
          targets: [{ expr: 'sum(up)' }],
        },
      ],
    };
    const result = findPanels(dash, { queryMatches: 'rate' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([1, 2]);
  });

  it('combines filters with AND semantics: type AND unit', () => {
    const result = findPanels(fixture(), { type: 'timeseries', unit: 'reqps' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([2, 3]);
  });

  it('combines filters with AND semantics: hasDescription + queryMatches', () => {
    const result = findPanels(fixture(), {
      hasDescription: true,
      queryMatches: 'rate\\(',
    });
    expect(result.errors).toEqual([]);
    // Panel 2 has description AND uses rate(); panel 3 uses rate() but
    // is missing description; panel 6 has description but uses sum().
    expect(result.panelIds).toEqual([2]);
  });
});

// Issue #42: findPanels silently accepted unknown filter keys at the
// library entry point (the MCP boundary's `.strict()` from PR #38
// only covered tool-call callers). The library-entry parallel guard
// closes the gap. Same failure mode the closed-DSL design was
// chosen to prevent.
describe('findPanels - unknown filter keys (issue #42)', () => {
  it('rejects a single unknown filter key with a structured error', () => {
    const result = findPanels(fixture(), { typoKey: 'foo' } as never);
    expect(result.panelIds).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('filter.typoKey');
    expect(result.errors[0]?.message).toMatch(/unknown filter key "typoKey"/);
    expect(result.errors[0]?.message).toMatch(/allowed:/);
  });

  it('rejects multiple unknown filter keys with one error per key', () => {
    const result = findPanels(fixture(), {
      typoOne: 'a',
      typoTwo: 'b',
    } as never);
    expect(result.panelIds).toEqual([]);
    expect(result.errors).toHaveLength(2);
    const paths = result.errors.map((e) => e.path).sort();
    expect(paths).toEqual(['filter.typoOne', 'filter.typoTwo']);
  });

  it('accepts a mix of known and unknown keys but rejects on the unknown', () => {
    // The doc claim is "unknown keys reject" — a known-key + unknown-key
    // mix shouldn't sneak through just because some keys validate.
    const result = findPanels(fixture(), {
      type: 'timeseries',
      matches: 'rate', // typo of queryMatches
    } as never);
    expect(result.panelIds).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('filter.matches');
  });

  it('still accepts every known key without complaint', () => {
    // Regression: don't false-positive on the legitimate filter shape.
    const result = findPanels(fixture(), {
      type: 'timeseries',
      unit: 'reqps',
      hasUnit: true,
      hasDescription: true,
      queryMatches: 'rate',
    });
    expect(result.errors).toEqual([]);
  });
});

// Issue #43: hasUnit: boolean as the symmetric twin of hasDescription.
// Predicted gap from docs/guidance/units.md.
describe('findPanels - hasUnit filter (issue #43)', () => {
  it('hasUnit: true matches panels with a non-empty unit', () => {
    const result = findPanels(fixture(), { hasUnit: true });
    expect(result.errors).toEqual([]);
    // Panels 2, 3, 4 have units; panel 6 (nested) has unit "short";
    // panels 1, 5 are rows (excluded).
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([2, 3, 4, 6]);
  });

  it('hasUnit: false matches panels missing one (absent / empty / null counted)', () => {
    const dash = {
      title: 't',
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'no fieldConfig',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
        },
        {
          id: 2,
          type: 'timeseries',
          title: 'no unit',
          fieldConfig: { defaults: {} },
          gridPos: { x: 12, y: 0, w: 12, h: 8 },
        },
        {
          id: 3,
          type: 'timeseries',
          title: 'empty unit',
          fieldConfig: { defaults: { unit: '' } },
          gridPos: { x: 0, y: 8, w: 12, h: 8 },
        },
        {
          id: 4,
          type: 'timeseries',
          title: 'has unit',
          fieldConfig: { defaults: { unit: 'reqps' } },
          gridPos: { x: 12, y: 8, w: 12, h: 8 },
        },
      ],
    };
    const result = findPanels(dash, { hasUnit: false });
    expect(result.errors).toEqual([]);
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3]);
  });

  it('row panels are excluded entirely from hasUnit filtering', () => {
    const dash = {
      title: 't',
      panels: [
        // Row with NO unit — would match hasUnit:false if rows weren't excluded.
        { id: 1, type: 'row', title: 'R', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
      ],
    };
    const haveUnit = findPanels(dash, { hasUnit: true });
    expect(haveUnit.panelIds).toEqual([]);
    const lackUnit = findPanels(dash, { hasUnit: false });
    expect(lackUnit.panelIds).toEqual([]);
  });

  it('combines with other filters via AND', () => {
    const result = findPanels(fixture(), {
      type: 'timeseries',
      hasUnit: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.panelIds.sort((a, b) => Number(a) - Number(b))).toEqual([2, 3, 6]);
  });
});

describe('findPanels - regex safety', () => {
  it('returns an error for a regex pattern that exceeds the length cap', () => {
    const tooLong = 'a'.repeat(300); // cap is 200
    const result = findPanels(fixture(), { queryMatches: tooLong });
    expect(result.panelIds).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('filter.queryMatches');
    expect(result.errors[0]?.message).toMatch(/length/);
  });

  it('returns an error for a malformed regex pattern', () => {
    const result = findPanels(fixture(), { queryMatches: '[unclosed' });
    expect(result.panelIds).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('filter.queryMatches');
    expect(result.errors[0]?.message).toMatch(/regex/i);
  });
});

describe('findPanels - structural / edge cases', () => {
  it('returns an error when dashboard is not an object', () => {
    const result = findPanels(null, {});
    expect(result.panelIds).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.path).toBe('$');
  });

  it('skips panels without an id (cannot reference them)', () => {
    const dash = {
      title: 't',
      panels: [
        { type: 'timeseries', title: 'no id', fieldConfig: { defaults: { unit: 'short' } } },
        { id: 7, type: 'timeseries', title: 'has id', fieldConfig: { defaults: { unit: 'short' } } },
      ],
    };
    const result = findPanels(dash, { unit: 'short' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds).toEqual([7]);
  });

  it('returns ids in dashboard walk order (top-level then nested)', () => {
    // Verifies stable ordering so consumers (e.g. bulk_update) can rely on it.
    const result = findPanels(fixture(), { type: 'timeseries' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds).toEqual([2, 3, 6]);
  });

  it('emits deterministic output across repeat runs', () => {
    const a = findPanels(fixture(), { type: 'timeseries', unit: 'reqps' });
    const b = findPanels(fixture(), { type: 'timeseries', unit: 'reqps' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not mutate the input dashboard', () => {
    const dash = fixture();
    const before = JSON.stringify(dash);
    findPanels(dash, { type: 'timeseries', queryMatches: 'rate' });
    expect(JSON.stringify(dash)).toBe(before);
  });

  // Pin the "rows are excluded from hasDescription filtering" contract:
  // a row with a description is invisible to hasDescription:true. This
  // matches inspect.ts / lintPanel / lintDashboard but is undocumented
  // in the tool surface; this test makes the behavior load-bearing.
  it('rows are invisible to hasDescription even when they carry a description', () => {
    const dash = {
      title: 't',
      panels: [
        // Row with a description — unusual but legal.
        {
          id: 1,
          type: 'row',
          title: 'R',
          description: 'a row with prose',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
        },
      ],
    };
    const haveDesc = findPanels(dash, { hasDescription: true });
    expect(haveDesc.panelIds).toEqual([]);
    const lackDesc = findPanels(dash, { hasDescription: false });
    expect(lackDesc.panelIds).toEqual([]);
  });

  // hasDescription excludes rows, but type:'row' would match them.
  // Conflicting filters → row is excluded by hasDescription regardless
  // of the type match. Pin behavior so a future refactor doesn't
  // accidentally relax it.
  it('hasDescription + type:"row" returns empty (the description filter wins)', () => {
    const result = findPanels(fixture(), { hasDescription: false, type: 'row' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds).toEqual([]);
  });

  // Non-row panels with a stray `panels: [...]` field (e.g. an
  // exported dashboard with malformed nesting) should not be descended
  // into — only `type === 'row'` triggers the nested walk. This pins
  // the contract so a future refactor doesn't accidentally widen
  // recursion.
  it('does not descend into a non-row panel that has a panels: [] field', () => {
    const dash = {
      title: 't',
      panels: [
        {
          id: 1,
          type: 'timeseries',
          title: 'top',
          fieldConfig: { defaults: { unit: 'reqps' } },
          // Stray `panels` field on a non-row — should be ignored.
          panels: [
            { id: 99, type: 'timeseries', title: 'should not be found' },
          ],
        },
      ],
    };
    const result = findPanels(dash, { type: 'timeseries' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds).toEqual([1]);
    expect(result.panelIds).not.toContain(99);
  });

  // String panel ids are legal per the project's defensive normalization
  // in _internal.panelId(); exercise the contract.
  it('returns string panel ids alongside numeric ones', () => {
    const dash = {
      title: 't',
      panels: [
        { id: 1, type: 'timeseries', title: 'a', fieldConfig: { defaults: { unit: 'short' } } },
        { id: 'panel-uuid', type: 'timeseries', title: 'b', fieldConfig: { defaults: { unit: 'short' } } },
      ],
    };
    const result = findPanels(dash, { type: 'timeseries' });
    expect(result.errors).toEqual([]);
    expect(result.panelIds).toEqual([1, 'panel-uuid']);
  });
});
