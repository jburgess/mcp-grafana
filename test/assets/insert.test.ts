import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { insertPanel } from '../../src/assets/insert.js';

// Minimal panel for inserts where the contents don't matter, just placement.
const newPanel = () => ({
  type: 'timeseries',
  title: 'New panel',
  targets: [{ expr: 'up' }],
});

describe('insertPanel - append (default)', () => {
  it('appends below the bottom-most panel', () => {
    const dashboard = {
      title: 't',
      panels: [
        { id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
        { id: 2, type: 'timeseries', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
      ],
    };

    const result = insertPanel(dashboard, newPanel());

    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ id: number; gridPos: { x: number; y: number; w: number; h: number } }> };
    expect(updated.panels).toHaveLength(3);
    const inserted = updated.panels[2];
    expect(inserted?.gridPos).toEqual({ x: 0, y: 8, w: 12, h: 8 });
  });

  it('places at y=0 when the dashboard has no panels', () => {
    const dashboard = { title: 't', panels: [] };
    const result = insertPanel(dashboard, newPanel());
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ gridPos: { y: number } }> };
    expect(updated.panels[0]?.gridPos.y).toBe(0);
  });

  it('appends below row-nested panels (uses absolute gridPos)', () => {
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
    const result = insertPanel(dashboard, newPanel());
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<unknown> };
    // New panel is appended at top level (not into the row), at y=9 (below row children)
    expect(updated.panels).toHaveLength(2);
    const inserted = updated.panels[1] as { gridPos: { x: number; y: number } };
    expect(inserted.gridPos.y).toBe(9);
  });

  it('uses w/h from the incoming panel when its gridPos is present', () => {
    const dashboard = { title: 't', panels: [] };
    const panel = { ...newPanel(), gridPos: { x: 99, y: 99, w: 6, h: 4 } };
    const result = insertPanel(dashboard, panel);
    const updated = result.dashboard as { panels: Array<{ gridPos: { x: number; y: number; w: number; h: number } }> };
    // x/y overwritten by append logic; w/h preserved from input
    expect(updated.panels[0]?.gridPos).toEqual({ x: 0, y: 0, w: 6, h: 4 });
  });
});

describe('insertPanel - gridPos mode (explicit placement)', () => {
  it('honors the provided gridPos verbatim', () => {
    const dashboard = {
      title: 't',
      panels: [{ id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    };
    const result = insertPanel(dashboard, newPanel(), {
      mode: 'gridPos',
      x: 3,
      y: 7,
      w: 9,
      h: 6,
    });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ gridPos: { x: number; y: number; w: number; h: number } }> };
    expect(updated.panels[1]?.gridPos).toEqual({ x: 3, y: 7, w: 9, h: 6 });
  });
});

describe('insertPanel - after panelId', () => {
  it('places the new panel directly below the named top-level panel', () => {
    const dashboard = {
      title: 't',
      panels: [
        { id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
        { id: 2, type: 'timeseries', gridPos: { x: 0, y: 20, w: 12, h: 8 } },
      ],
    };
    const result = insertPanel(dashboard, newPanel(), { mode: 'after', panelId: 1 });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ id: number; gridPos: { x: number; y: number } }> };
    // Inserted in the top-level array right after panel id 1
    expect(updated.panels.map((p) => p.id)).toEqual([1, expect.any(Number), 2]);
    // New panel goes at y = 0 + 8 = 8 (right below panel 1)
    const inserted = updated.panels[1];
    expect(inserted?.gridPos).toEqual({ x: 0, y: 8, w: 12, h: 8 });
  });

  it('inserts after a row-nested panel within its parent row', () => {
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
    const result = insertPanel(dashboard, newPanel(), { mode: 'after', panelId: 11 });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ panels?: Array<{ id: number; gridPos: { y: number } }> }> };
    const rowChildren = updated.panels[0]?.panels;
    expect(rowChildren).toHaveLength(3);
    expect(rowChildren?.[1]?.id).not.toBe(11);
    expect(rowChildren?.[2]?.id).toBe(12);
    expect(rowChildren?.[1]?.gridPos.y).toBe(9); // below panel 11 (y=1, h=8)
  });

  it('returns an error if panelId is not found', () => {
    const dashboard = {
      title: 't',
      panels: [{ id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    };
    const result = insertPanel(dashboard, newPanel(), { mode: 'after', panelId: 999 });
    expect(result.dashboard).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/panel id 999/i);
  });
});

describe('insertPanel - inRow rowId', () => {
  it('pushes into row.panels[] for a legacy-nested row', () => {
    const dashboard = {
      title: 't',
      panels: [
        {
          id: 10,
          type: 'row',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            { id: 11, type: 'timeseries', gridPos: { x: 0, y: 1, w: 12, h: 8 } },
          ],
        },
      ],
    };
    const result = insertPanel(dashboard, newPanel(), { mode: 'inRow', rowId: 10 });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ panels?: Array<{ id: number; gridPos: { x: number; y: number } }> }> };
    const rowChildren = updated.panels[0]?.panels;
    expect(rowChildren).toHaveLength(2);
    // New child sits below the existing one: y = 1 + 8 = 9
    expect(rowChildren?.[1]?.gridPos).toEqual({ x: 0, y: 9, w: 12, h: 8 });
  });

  it('pushes into an empty legacy row at the row\'s baseline y', () => {
    const dashboard = {
      title: 't',
      panels: [
        {
          id: 10,
          type: 'row',
          gridPos: { x: 0, y: 5, w: 24, h: 1 },
          panels: [],
        },
      ],
    };
    const result = insertPanel(dashboard, newPanel(), { mode: 'inRow', rowId: 10 });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ panels?: Array<{ gridPos: { y: number } }> }> };
    expect(updated.panels[0]?.panels?.[0]?.gridPos.y).toBe(6); // row.y + row.h
  });

  it('inserts at top-level after the last modern-format child of the row', () => {
    // Modern flat: row at top level, "members" follow in array order until next row.
    const dashboard = {
      title: 't',
      panels: [
        { id: 10, type: 'row', title: 'CPU', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
        { id: 11, type: 'timeseries', gridPos: { x: 0, y: 1, w: 12, h: 8 } },
        { id: 12, type: 'timeseries', gridPos: { x: 12, y: 1, w: 12, h: 8 } },
        { id: 20, type: 'row', title: 'Memory', gridPos: { x: 0, y: 9, w: 24, h: 1 } },
        { id: 21, type: 'stat', gridPos: { x: 0, y: 10, w: 6, h: 4 } },
      ],
    };
    const result = insertPanel(dashboard, newPanel(), { mode: 'inRow', rowId: 10 });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ id: number; gridPos: { y: number } }> };
    // New panel sits between panel 12 (last child of row 10) and row 20
    const ids = updated.panels.map((p) => p.id);
    const insertedIdx = ids.indexOf(20) - 1;
    expect(insertedIdx).toBe(3);
    expect(updated.panels[insertedIdx]?.gridPos.y).toBe(9); // below panel 12 (y=1, h=8)
  });

  it('inserts at top-level after a modern row with no following children', () => {
    const dashboard = {
      title: 't',
      panels: [
        { id: 10, type: 'row', gridPos: { x: 0, y: 0, w: 24, h: 1 } },
      ],
    };
    const result = insertPanel(dashboard, newPanel(), { mode: 'inRow', rowId: 10 });
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: Array<{ id: number; gridPos: { y: number } }> };
    expect(updated.panels).toHaveLength(2);
    expect(updated.panels[1]?.gridPos.y).toBe(1); // row.y + row.h
  });

  it('returns an error if rowId is not found', () => {
    const dashboard = { title: 't', panels: [] };
    const result = insertPanel(dashboard, newPanel(), { mode: 'inRow', rowId: 42 });
    expect(result.dashboard).toBeUndefined();
    expect(result.errors[0]?.message).toMatch(/row.*42/i);
  });

  it('returns an error if rowId resolves to a non-row panel', () => {
    const dashboard = {
      title: 't',
      panels: [{ id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    };
    const result = insertPanel(dashboard, newPanel(), { mode: 'inRow', rowId: 1 });
    expect(result.dashboard).toBeUndefined();
    expect(result.errors[0]?.message).toMatch(/not a row/i);
  });
});

describe('insertPanel - auto id assignment', () => {
  it('assigns max(existingIds)+1 when the incoming panel has no id', () => {
    const dashboard = {
      title: 't',
      panels: [
        { id: 3, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
        { id: 7, type: 'timeseries', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
      ],
    };
    const result = insertPanel(dashboard, newPanel());
    const updated = result.dashboard as { panels: Array<{ id: number }> };
    expect(updated.panels[2]?.id).toBe(8);
  });

  it('preserves an explicit id on the incoming panel', () => {
    const dashboard = {
      title: 't',
      panels: [{ id: 3, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    };
    const result = insertPanel(dashboard, { ...newPanel(), id: 42 });
    const updated = result.dashboard as { panels: Array<{ id: number }> };
    expect(updated.panels[1]?.id).toBe(42);
  });

  it('starts at id=1 for an empty dashboard', () => {
    const result = insertPanel({ title: 't', panels: [] }, newPanel());
    const updated = result.dashboard as { panels: Array<{ id: number }> };
    expect(updated.panels[0]?.id).toBe(1);
  });

  it('considers ids inside row.panels[] when computing max+1', () => {
    const dashboard = {
      title: 't',
      panels: [
        {
          id: 10,
          type: 'row',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            { id: 99, type: 'timeseries', gridPos: { x: 0, y: 1, w: 12, h: 8 } },
          ],
        },
      ],
    };
    const result = insertPanel(dashboard, newPanel());
    const updated = result.dashboard as { panels: Array<{ id: number }> };
    expect(updated.panels[1]?.id).toBe(100);
  });

  it('does not collide on repeated inserts', () => {
    let dashboard: unknown = { title: 't', panels: [] };
    for (let i = 0; i < 5; i++) {
      const r = insertPanel(dashboard, newPanel());
      dashboard = r.dashboard;
    }
    const final = dashboard as { panels: Array<{ id: number }> };
    const ids = final.panels.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('insertPanel - immutability', () => {
  it('does not mutate the input dashboard', () => {
    const dashboard = {
      title: 't',
      panels: [{ id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    };
    const before = JSON.parse(JSON.stringify(dashboard));
    insertPanel(dashboard, newPanel());
    expect(dashboard).toEqual(before);
  });

  it('does not mutate the input panel', () => {
    const dashboard = { title: 't', panels: [] };
    const panel = newPanel();
    const before = JSON.parse(JSON.stringify(panel));
    insertPanel(dashboard, panel);
    expect(panel).toEqual(before);
  });

  it('returned dashboard.panels has a different array reference', () => {
    const dashboard = { title: 't', panels: [] };
    const result = insertPanel(dashboard, newPanel());
    const updated = result.dashboard as { panels: unknown[] };
    expect(updated.panels).not.toBe(dashboard.panels);
  });
});

describe('insertPanel - against real fixture (Node Exporter Full)', () => {
  const loadFixture = () =>
    JSON.parse(
      readFileSync(new URL('../fixtures/node-exporter-full.json', import.meta.url), 'utf8'),
    ) as { title: string; panels: Array<unknown> };

  it('appends a panel without errors and bumps the panel count by one', () => {
    const dashboard = loadFixture();
    const result = insertPanel(dashboard, newPanel());
    expect(result.errors).toEqual([]);
    const updated = result.dashboard as { panels: unknown[] };
    expect(updated.panels.length).toBe(dashboard.panels.length + 1);
  });

  it('inserts into the first row by id (legacy or modern, whichever it is)', () => {
    const dashboard = loadFixture();
    // Row id 261 = "Quick CPU / Mem / Disk" (a modern-format row in this fixture).
    const result = insertPanel(dashboard, newPanel(), { mode: 'inRow', rowId: 261 });
    expect(result.errors).toEqual([]);
    expect(result.dashboard).toBeDefined();
  });
});

describe('insertPanel - error handling', () => {
  it('rejects a non-object dashboard', () => {
    const result = insertPanel('nope', newPanel());
    expect(result.errors[0]?.message).toMatch(/dashboard/i);
  });

  it('rejects a non-object panel', () => {
    const result = insertPanel({ title: 't', panels: [] }, null);
    expect(result.errors[0]?.message).toMatch(/panel/i);
  });
});
