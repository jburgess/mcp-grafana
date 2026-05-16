import { describe, expect, it } from 'vitest';

import { removePanel } from '../../src/assets/remove.js';

describe('removePanel - basic removal', () => {
  it('removes a top-level non-row panel', () => {
    const dashboard = {
      title: 't',
      panels: [
        { id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
        { id: 2, type: 'timeseries', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
      ],
    };
    const result = removePanel(dashboard, 1);
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ id: number }> };
    expect(updated.panels).toHaveLength(1);
    expect(updated.panels[0]?.id).toBe(2);
  });

  it('removes a row-nested panel from its parent row', () => {
    const dashboard = {
      title: 't',
      panels: [
        {
          id: 10,
          type: 'row',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            { id: 11, type: 'timeseries', gridPos: { x: 0, y: 1, w: 12, h: 8 } },
            { id: 12, type: 'timeseries', gridPos: { x: 12, y: 1, w: 12, h: 8 } },
          ],
        },
      ],
    };
    const result = removePanel(dashboard, 11);
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as {
      panels: Array<{ id: number; panels?: Array<{ id: number }> }>;
    };
    expect(updated.panels[0]?.panels?.map((p) => p.id)).toEqual([12]);
  });
});

describe('removePanel - row removal', () => {
  it('removes a legacy row together with its nested children', () => {
    const dashboard = {
      title: 't',
      panels: [
        { id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
        {
          id: 10,
          type: 'row',
          gridPos: { x: 0, y: 8, w: 24, h: 1 },
          panels: [
            { id: 11, type: 'timeseries', gridPos: { x: 0, y: 9, w: 12, h: 8 } },
            { id: 12, type: 'timeseries', gridPos: { x: 12, y: 9, w: 12, h: 8 } },
          ],
        },
      ],
    };
    const result = removePanel(dashboard, 10);
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ id: number }> };
    // Row + its nested children all gone; panel 1 remains
    expect(updated.panels.map((p) => p.id)).toEqual([1]);
  });

  it('removes a modern row but leaves trailing siblings in place (promoted)', () => {
    // Modern format: row has no panels[]; "members" follow in array order.
    const dashboard = {
      title: 't',
      panels: [
        { id: 10, type: 'row', title: 'CPU', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
        { id: 11, type: 'timeseries', gridPos: { x: 0, y: 1, w: 12, h: 8 } },
        { id: 12, type: 'timeseries', gridPos: { x: 12, y: 1, w: 12, h: 8 } },
        { id: 20, type: 'row', title: 'Mem', gridPos: { x: 0, y: 9, w: 24, h: 1 } },
        { id: 21, type: 'stat', gridPos: { x: 0, y: 10, w: 6, h: 4 } },
      ],
    };
    const result = removePanel(dashboard, 10);
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ id: number }> };
    // Row 10 is gone. Its trailing siblings (11, 12) stay at top-level.
    // Row 20 + sibling 21 unaffected.
    expect(updated.panels.map((p) => p.id)).toEqual([11, 12, 20, 21]);
  });
});

describe('removePanel - errors and immutability', () => {
  it('returns an error for unknown panelId', () => {
    const dashboard = { title: 't', panels: [] };
    const result = removePanel(dashboard, 42);
    expect(result.dashboard).toBeUndefined();
    expect(result.errors[0]?.message).toMatch(/42/);
  });

  it('does not mutate the input dashboard', () => {
    const dashboard = {
      title: 't',
      panels: [{ id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    };
    const before = JSON.parse(JSON.stringify(dashboard));
    removePanel(dashboard, 1);
    expect(dashboard).toEqual(before);
  });
});
