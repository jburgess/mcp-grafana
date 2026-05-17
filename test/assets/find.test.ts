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
});
