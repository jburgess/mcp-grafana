/**
 * Inserts a panel into an existing Grafana dashboard at a chosen position.
 *
 * The LLM workflow this serves: "add a panel to dashboard X" (W1). The LLM
 * builds a panel via grafana_timeseries_panel_build, then calls this tool
 * with a position. Without a dedicated insert primitive, the LLM would have
 * to reconstruct the full dashboard JSON to weave the new panel in — which
 * is brittle and loses fields the LLM doesn't know about.
 *
 * Modes:
 *   - append (default): place at the bottom of the dashboard, top-level.
 *   - gridPos: explicit placement; honored verbatim.
 *   - after panelId: directly below the named panel in its container
 *     (top-level OR row.panels[] if the named panel is row-nested).
 *   - inRow rowId: make the panel a child of the named row. Handles both
 *     legacy (row.panels[]) and modern (siblings ordered in the top-level
 *     panels[] array) row formats.
 *
 * Auto-id: if the incoming panel has no id, the next free id (max + 1
 * across the full panel tree, starting at 1) is assigned. Explicit ids
 * are preserved.
 *
 * Immutability: the input dashboard and panel are never mutated. The result
 * is a deep clone with the panel inserted.
 *
 * Errors: returned in result.errors[] (model-friendly), not thrown. When
 * errors[] is non-empty, result.dashboard is undefined and no insertion
 * occurred.
 */

import type { ValidationError } from './validate.js';

export type InsertPosition =
  | { mode: 'append' }
  | { mode: 'gridPos'; x: number; y: number; w: number; h: number }
  | { mode: 'after'; panelId: number | string }
  | { mode: 'inRow'; rowId: number | string };

export interface InsertResult {
  /** Present on success; absent when errors[] is non-empty. */
  dashboard?: Record<string, unknown>;
  /** Empty on success; contains structural problems otherwise. */
  errors: ValidationError[];
}

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function panelId(panel: Dict): number | string | undefined {
  return asNumber(panel.id) ?? asString(panel.id);
}

interface GridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

function panelGridPos(panel: Dict): GridPos | undefined {
  const g = asDict(panel.gridPos);
  if (!g) return undefined;
  const x = asNumber(g.x);
  const y = asNumber(g.y);
  const w = asNumber(g.w);
  const h = asNumber(g.h);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x, y, w, h };
}

const DEFAULT_W = 12;
const DEFAULT_H = 8;

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Walks every panel (top-level + legacy nested) yielding the panel object.
// Used for id collision detection and bottom-of-dashboard math.
function* flatten(dashboard: Dict): Generator<Dict> {
  for (const raw of asArray(dashboard.panels)) {
    const panel = asDict(raw);
    if (!panel) continue;
    yield panel;
    if (asString(panel.type) === 'row') {
      for (const nestedRaw of asArray(panel.panels)) {
        const nested = asDict(nestedRaw);
        if (nested) yield nested;
      }
    }
  }
}

function nextFreeId(dashboard: Dict): number {
  let max = 0;
  for (const panel of flatten(dashboard)) {
    const id = panelId(panel);
    if (typeof id === 'number' && id > max) max = id;
  }
  return max + 1;
}

function maxBottom(dashboard: Dict): number {
  let bottom = 0;
  for (const panel of flatten(dashboard)) {
    const g = panelGridPos(panel);
    if (!g) continue;
    bottom = Math.max(bottom, g.y + g.h);
  }
  return bottom;
}

function incomingWH(panel: Dict): { w: number; h: number } {
  const g = panelGridPos(panel);
  return { w: g?.w ?? DEFAULT_W, h: g?.h ?? DEFAULT_H };
}

/**
 * Finds the named panel and the array+index it lives at. Searches the
 * top-level array first, then each row's nested panels[].
 */
function locatePanel(
  dashboard: Dict,
  targetId: number | string,
): { container: unknown[]; index: number; panel: Dict } | undefined {
  const top = asArray(dashboard.panels);
  for (let i = 0; i < top.length; i++) {
    const p = asDict(top[i]);
    if (!p) continue;
    if (panelId(p) === targetId) {
      return { container: top, index: i, panel: p };
    }
    if (asString(p.type) === 'row') {
      const nested = asArray(p.panels);
      for (let j = 0; j < nested.length; j++) {
        const np = asDict(nested[j]);
        if (np && panelId(np) === targetId) {
          return { container: nested, index: j, panel: np };
        }
      }
    }
  }
  return undefined;
}

/**
 * Finds the index of the LAST modern-format child of a row in the
 * top-level panels[] array. Modern children are non-row panels appearing
 * after the row and before the next row. Returns the row's own index if
 * the row has no following non-row siblings.
 */
function lastModernChildIndex(top: unknown[], rowIndex: number): number {
  let last = rowIndex;
  for (let i = rowIndex + 1; i < top.length; i++) {
    const p = asDict(top[i]);
    if (!p) continue;
    if (asString(p.type) === 'row') break;
    last = i;
  }
  return last;
}

export function insertPanel(
  dashboard: unknown,
  panel: unknown,
  position: InsertPosition = { mode: 'append' },
): InsertResult {
  const dash = asDict(dashboard);
  if (!dash) {
    return {
      errors: [{ path: '$', message: 'dashboard must be an object' }],
    };
  }

  const incoming = asDict(panel);
  if (!incoming) {
    return {
      errors: [{ path: 'panel', message: 'panel must be an object' }],
    };
  }

  const out = deepClone(dash);
  // Ensure panels[] exists and is an array on the clone.
  if (!Array.isArray(out.panels)) out.panels = [];

  const newPanel: Dict = deepClone(incoming);
  if (panelId(newPanel) === undefined) {
    newPanel.id = nextFreeId(out);
  }

  const { w: incomingW, h: incomingH } = incomingWH(newPanel);

  switch (position.mode) {
    case 'gridPos': {
      newPanel.gridPos = {
        x: position.x,
        y: position.y,
        w: position.w,
        h: position.h,
      };
      (out.panels as unknown[]).push(newPanel);
      return { dashboard: out, errors: [] };
    }

    case 'append': {
      newPanel.gridPos = {
        x: 0,
        y: maxBottom(out),
        w: incomingW,
        h: incomingH,
      };
      (out.panels as unknown[]).push(newPanel);
      return { dashboard: out, errors: [] };
    }

    case 'after': {
      const located = locatePanel(out, position.panelId);
      if (!located) {
        return {
          errors: [
            {
              path: 'position.panelId',
              message: `panel id ${position.panelId} not found in dashboard`,
            },
          ],
        };
      }
      const { container, index, panel: anchor } = located;
      const anchorPos = panelGridPos(anchor);
      const baseY = anchorPos !== undefined ? anchorPos.y + anchorPos.h : 0;
      newPanel.gridPos = { x: 0, y: baseY, w: incomingW, h: incomingH };
      container.splice(index + 1, 0, newPanel);
      return { dashboard: out, errors: [] };
    }

    case 'inRow': {
      const located = locatePanel(out, position.rowId);
      if (!located) {
        return {
          errors: [
            {
              path: 'position.rowId',
              message: `row id ${position.rowId} not found in dashboard`,
            },
          ],
        };
      }
      const { panel: row } = located;
      if (asString(row.type) !== 'row') {
        return {
          errors: [
            {
              path: 'position.rowId',
              message: `panel id ${position.rowId} is not a row (type=${asString(row.type) ?? 'unknown'})`,
            },
          ],
        };
      }

      const rowPos = panelGridPos(row);
      const rowBaseY = rowPos !== undefined ? rowPos.y + rowPos.h : 0;

      // Legacy: row has its own panels[]. Push there.
      if (Array.isArray(row.panels)) {
        const existing = (row.panels as unknown[]).map(asDict).filter((p): p is Dict => p !== undefined);
        let bottom = rowBaseY;
        for (const child of existing) {
          const g = panelGridPos(child);
          if (g) bottom = Math.max(bottom, g.y + g.h);
        }
        newPanel.gridPos = { x: 0, y: bottom, w: incomingW, h: incomingH };
        (row.panels as unknown[]).push(newPanel);
        return { dashboard: out, errors: [] };
      }

      // Modern: find the row's index at the top level and the last following
      // non-row sibling. Insert immediately after that sibling.
      const top = out.panels as unknown[];
      const rowIndex = top.findIndex((p) => {
        const pd = asDict(p);
        return pd ? panelId(pd) === position.rowId : false;
      });
      const lastChildIndex = lastModernChildIndex(top, rowIndex);

      let bottom = rowBaseY;
      for (let i = rowIndex + 1; i <= lastChildIndex; i++) {
        const child = asDict(top[i]);
        if (!child) continue;
        const g = panelGridPos(child);
        if (g) bottom = Math.max(bottom, g.y + g.h);
      }
      newPanel.gridPos = { x: 0, y: bottom, w: incomingW, h: incomingH };
      top.splice(lastChildIndex + 1, 0, newPanel);
      return { dashboard: out, errors: [] };
    }
  }
}
