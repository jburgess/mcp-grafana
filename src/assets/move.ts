/**
 * Moves a panel (or row, since a row IS a panel) within a dashboard.
 *
 * Implementation: locate the panel, splice it out of its current container,
 * re-insert at the new position via the same logic insertPanel uses. The
 * `to` argument reuses InsertPosition so the LLM uses one positional API
 * for both insert and move.
 *
 * Modern-format row moves carry trailing siblings along: when the moved
 * panel is a row that lives at the top level *and* has no nested panels[]
 * (modern style), its contiguous run of non-row siblings in the top-level
 * array moves with it. Matches "move the CPU section above the Memory
 * section" intent. Legacy rows carry their nested children automatically
 * (the children live inside `row.panels[]`).
 *
 * Returns { dashboard?, errors[] } — same shape as insert/update. Input
 * never mutated.
 */

import { insertPanel, type InsertPosition, type InsertResult } from './insert.js';
import type { ValidationError } from './validate.js';

export type MoveResult = InsertResult;

import { type Dict, asDict, asString, deepClone, panelId } from './_internal.js';

/**
 * Removes the panel with the given id from its container (top-level OR
 * legacy row.panels[]) and returns the removed panel. If the panel is a
 * modern-format row at top level — meaning it has no nested panels[] —
 * also removes the contiguous run of non-row siblings that follow it,
 * and returns them along with the row.
 *
 * Mutates the provided dashboard in place (caller controls cloning).
 */
function spliceOut(
  dashboard: Dict,
  targetId: number | string,
): { items: Dict[]; wasModernRow: boolean } | undefined {
  const top = dashboard.panels as unknown[];
  if (!Array.isArray(top)) return undefined;

  // Top-level search
  for (let i = 0; i < top.length; i++) {
    const p = asDict(top[i]);
    if (!p) continue;
    if (panelId(p) !== targetId) continue;

    // Found at top level. Is this a modern-format row?
    const isRow = asString(p.type) === 'row';
    const hasNestedPanels = Array.isArray(p.panels);
    if (isRow && !hasNestedPanels) {
      // Modern row: walk forward to find the contiguous run of non-row siblings.
      let runEnd = i;
      for (let j = i + 1; j < top.length; j++) {
        const next = asDict(top[j]);
        if (!next) continue;
        if (asString(next.type) === 'row') break;
        runEnd = j;
      }
      const removed = top.splice(i, runEnd - i + 1) as Dict[];
      return { items: removed, wasModernRow: true };
    }

    // Single panel (or legacy row that carries its panels[] with it)
    const removed = top.splice(i, 1)[0] as Dict;
    return { items: [removed], wasModernRow: false };
  }

  // Nested search — legacy rows only have panels[] here.
  for (const rawRow of top) {
    const row = asDict(rawRow);
    if (!row) continue;
    if (asString(row.type) !== 'row') continue;
    const nested = row.panels;
    if (!Array.isArray(nested)) continue;
    for (let j = 0; j < nested.length; j++) {
      const child = asDict(nested[j]);
      if (!child) continue;
      if (panelId(child) === targetId) {
        const removed = nested.splice(j, 1)[0] as Dict;
        return { items: [removed], wasModernRow: false };
      }
    }
  }

  return undefined;
}

/**
 * Re-inserts a modern-format row plus its trailing siblings. The row's
 * position is determined by `to`; siblings are placed immediately after
 * the row in the top-level array (preserving their relative order and
 * their original gridPos).
 *
 * Returns null if the operation is invalid (e.g. inRow on a row).
 */
function reinsertModernRowGroup(
  dashboard: Dict,
  group: Dict[],
  to: InsertPosition,
): InsertResult {
  const [row, ...siblings] = group;
  if (!row) {
    return { errors: [{ path: '$', message: 'internal: empty group' }] };
  }

  // Can't put a row inside another row.
  if (to.mode === 'inRow') {
    return {
      errors: [
        {
          path: 'to',
          message: 'cannot move a row into another row (rows cannot nest)',
        },
      ],
    };
  }

  // Use insertPanel to place the row at the requested position. This
  // handles append/gridPos/after consistently with single-panel moves.
  const rowInsert = insertPanel(dashboard, row, to);
  if (rowInsert.errors.length > 0 || !rowInsert.dashboard) return rowInsert;

  // Now splice the siblings into the top-level array immediately after
  // the row's new index. They keep their original gridPos — the LLM can
  // patch positions later if it wants to reflow.
  const out = rowInsert.dashboard;
  const top = out.panels as unknown[];
  const rowIdx = top.findIndex((p) => {
    const pd = asDict(p);
    return pd ? panelId(pd) === panelId(row) : false;
  });
  if (rowIdx >= 0 && siblings.length > 0) {
    top.splice(rowIdx + 1, 0, ...siblings);
  }
  return { dashboard: out, errors: [] };
}

export function movePanel(
  dashboard: unknown,
  panelIdArg: number | string,
  to: InsertPosition,
): MoveResult {
  const dash = asDict(dashboard);
  if (!dash) {
    return {
      errors: [{ path: '$', message: 'dashboard must be an object' }],
    };
  }

  const out = deepClone(dash);
  const removed = spliceOut(out, panelIdArg);

  if (!removed) {
    return {
      errors: [
        {
          path: 'panelId',
          message: `panel id ${panelIdArg} not found in dashboard`,
        },
      ],
    };
  }

  const errors: ValidationError[] = [];

  if (removed.wasModernRow) {
    return reinsertModernRowGroup(out, removed.items, to);
  }

  // Single-panel move. The panel already has an id; insertPanel won't
  // re-assign because panelId(item) is defined.
  const [item] = removed.items;
  if (!item) {
    errors.push({ path: '$', message: 'internal: nothing removed' });
    return { errors };
  }
  return insertPanel(out, item, to);
}
