import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { movePanel } from '../../src/assets/move.js';

const fixture = () => ({
  title: 't',
  panels: [
    { id: 1, type: 'timeseries', title: 'A', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
    { id: 2, type: 'timeseries', title: 'B', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
    {
      id: 10,
      type: 'row',
      title: 'CPU',
      gridPos: { x: 0, y: 8, w: 24, h: 1 },
      panels: [
        { id: 11, type: 'timeseries', title: 'cpu1', gridPos: { x: 0, y: 9, w: 12, h: 8 } },
        { id: 12, type: 'timeseries', title: 'cpu2', gridPos: { x: 12, y: 9, w: 12, h: 8 } },
      ],
    },
  ],
});

const modernFixture = () => ({
  title: 't',
  // Two modern-style rows: members follow each row by array order.
  panels: [
    { id: 10, type: 'row', title: 'CPU', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
    { id: 11, type: 'timeseries', title: 'cpu1', gridPos: { x: 0, y: 1, w: 12, h: 8 } },
    { id: 12, type: 'timeseries', title: 'cpu2', gridPos: { x: 12, y: 1, w: 12, h: 8 } },
    { id: 20, type: 'row', title: 'Mem', gridPos: { x: 0, y: 9, w: 24, h: 1 } },
    { id: 21, type: 'stat', title: 'mem1', gridPos: { x: 0, y: 10, w: 6, h: 4 } },
  ],
});

describe('movePanel - top-level panel moves', () => {
  it('moves a top-level panel to mode=append', () => {
    const result = movePanel(fixture(), 1, { mode: 'append' });
    expect(result.errors).toEqual([]);
    const ids = (result.dashboard as { panels: Array<{ id: number }> }).panels.map((p) => p.id);
    // Panel 1 was first; now it's last (only counts top-level slots)
    expect(ids[ids.length - 1]).toBe(1);
  });

  it('moves a top-level panel to mode=gridPos with new coordinates', () => {
    const result = movePanel(fixture(), 1, { mode: 'gridPos', x: 6, y: 20, w: 18, h: 6 });
    expect(result.errors).toEqual([]);
    const moved = (result.dashboard as { panels: Array<{ id: number; gridPos: { x: number; y: number; w: number; h: number } }> })
      .panels.find((p) => p.id === 1);
    expect(moved?.gridPos).toEqual({ x: 6, y: 20, w: 18, h: 6 });
  });

  it('moves a top-level panel to mode=after another top-level panel', () => {
    const result = movePanel(fixture(), 1, { mode: 'after', panelId: 2 });
    expect(result.errors).toEqual([]);
    const top = (result.dashboard as { panels: Array<{ id: number }> }).panels;
    const ids = top.map((p) => p.id);
    // Should be: 2, 1, 10 (1 moved to right after 2)
    expect(ids).toEqual([2, 1, 10]);
  });
});

describe('movePanel - across containers', () => {
  it('moves a nested panel out of its row into top-level (mode=append)', () => {
    const result = movePanel(fixture(), 11, { mode: 'append' });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as {
      panels: Array<{ id: number; panels?: Array<{ id: number }> }>;
    };
    // Panel 11 no longer inside row 10
    const row = updated.panels.find((p) => p.id === 10);
    expect(row?.panels?.map((p) => p.id)).toEqual([12]);
    // Panel 11 now at top level (at the end via append)
    const topIds = updated.panels.map((p) => p.id);
    expect(topIds).toContain(11);
    expect(topIds[topIds.length - 1]).toBe(11);
  });

  it('moves a top-level panel into a legacy row (mode=inRow)', () => {
    const result = movePanel(fixture(), 1, { mode: 'inRow', rowId: 10 });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as {
      panels: Array<{ id: number; panels?: Array<{ id: number }> }>;
    };
    // Panel 1 gone from top-level
    expect(updated.panels.map((p) => p.id)).toEqual([2, 10]);
    // Panel 1 now inside row 10's panels[]
    const row = updated.panels.find((p) => p.id === 10);
    expect(row?.panels?.map((p) => p.id)).toEqual([11, 12, 1]);
  });

  it('moves a nested panel from one row to another row (mode=inRow)', () => {
    const dashboard = {
      title: 't',
      panels: [
        {
          id: 10, type: 'row', gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [{ id: 11, type: 'timeseries', gridPos: { x: 0, y: 1, w: 12, h: 8 } }],
        },
        {
          id: 20, type: 'row', gridPos: { x: 0, y: 9, w: 24, h: 1 },
          panels: [{ id: 21, type: 'timeseries', gridPos: { x: 0, y: 10, w: 12, h: 8 } }],
        },
      ],
    };
    const result = movePanel(dashboard, 11, { mode: 'inRow', rowId: 20 });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as {
      panels: Array<{ id: number; panels?: Array<{ id: number }> }>;
    };
    expect(updated.panels.find((p) => p.id === 10)?.panels?.map((p) => p.id)).toEqual([]);
    expect(updated.panels.find((p) => p.id === 20)?.panels?.map((p) => p.id)).toEqual([21, 11]);
  });
});

describe('movePanel - modern-format row moves carry trailing siblings', () => {
  it('moving the first row to the end carries its non-row siblings', () => {
    const result = movePanel(modernFixture(), 10, { mode: 'after', panelId: 21 });
    expect(result.errors).toEqual([]);
    const ids = (result.dashboard as { panels: Array<{ id: number }> }).panels.map((p) => p.id);
    // Row 10 + its modern children 11, 12 should now appear after panel 21.
    // Original: [10, 11, 12, 20, 21]
    // After moving 10 after 21: [20, 21, 10, 11, 12]
    expect(ids).toEqual([20, 21, 10, 11, 12]);
  });

  it('moving a modern row via gridPos relocates the row; siblings keep their gridPos', () => {
    const result = movePanel(modernFixture(), 10, { mode: 'gridPos', x: 0, y: 100, w: 24, h: 1 });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as {
      panels: Array<{ id: number; gridPos: { y: number } }>;
    };
    // Row 10 gridPos updated; siblings 11, 12 follow in array order
    const ids = updated.panels.map((p) => p.id);
    expect(ids).toEqual([20, 21, 10, 11, 12]);
    expect(updated.panels.find((p) => p.id === 10)?.gridPos.y).toBe(100);
  });

  it('legacy row move keeps its nested children (they live in row.panels[])', () => {
    const result = movePanel(fixture(), 10, { mode: 'append' });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as {
      panels: Array<{ id: number; panels?: Array<{ id: number }> }>;
    };
    // Row 10 should now be last at top-level, still carrying panels 11+12
    const ids = updated.panels.map((p) => p.id);
    expect(ids[ids.length - 1]).toBe(10);
    const row = updated.panels[updated.panels.length - 1];
    expect(row?.panels?.map((p) => p.id)).toEqual([11, 12]);
  });
});

describe('movePanel - errors and immutability', () => {
  it('returns an error for unknown panelId', () => {
    const result = movePanel(fixture(), 999, { mode: 'append' });
    expect(result.dashboard).toBeUndefined();
    expect(result.errors[0]?.message).toMatch(/999/);
  });

  it('does not mutate the input dashboard', () => {
    const dashboard = fixture();
    const before = JSON.parse(JSON.stringify(dashboard));
    movePanel(dashboard, 1, { mode: 'append' });
    expect(dashboard).toEqual(before);
  });
});
