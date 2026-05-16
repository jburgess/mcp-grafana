/**
 * Removes a panel from a dashboard by id.
 *
 * Behaviors by panel kind:
 *   - Regular panel (top-level OR row-nested): removed from its container.
 *   - Legacy row (has `panels[]`): the row AND its nested children are
 *     removed together (the children only existed inside the row).
 *   - Modern row (no `panels[]`): the row is removed; trailing siblings
 *     are PROMOTED to no-row status — they stay at their gridPos but lose
 *     their implicit row affiliation. This matches "delete the section
 *     header but keep the charts under it" intent.
 *
 * Returns { dashboard?, errors[] } — same shape as insert/update/move.
 * Input never mutated.
 */

import { asArray, asDict, asString, deepClone, panelId } from './_internal.js';
import type { ValidationError } from './validate.js';

export interface RemoveResult {
  dashboard?: Record<string, unknown>;
  errors: ValidationError[];
}

export function removePanel(
  dashboard: unknown,
  panelIdArg: number | string,
): RemoveResult {
  const dash = asDict(dashboard);
  if (!dash) {
    return {
      errors: [{ path: '$', message: 'dashboard must be an object' }],
    };
  }

  const out = deepClone(dash);
  const top = out.panels;
  if (!Array.isArray(top)) {
    return {
      errors: [
        { path: 'panelId', message: `panel id ${panelIdArg} not found in dashboard` },
      ],
    };
  }

  // Top-level search. Compare ids only when the panel HAS an id — comparing
  // panelId(p) (undefined) against panelIdArg (e.g. 999) used to false-match
  // via the old targetIdMatch helper that returned undefined on miss.
  for (let i = 0; i < top.length; i++) {
    const p = asDict(top[i]);
    if (!p) continue;
    const id = panelId(p);
    if (id !== undefined && id === panelIdArg) {
      // For legacy rows, the nested panels[] is removed together with the
      // row (they live inside it). For modern rows (no panels[]), trailing
      // siblings stay at top level — we just remove the row itself.
      top.splice(i, 1);
      return { dashboard: out, errors: [] };
    }
  }

  // Nested search — legacy rows only.
  for (const rawRow of top) {
    const row = asDict(rawRow);
    if (!row) continue;
    if (asString(row.type) !== 'row') continue;
    const nested = row.panels;
    if (!Array.isArray(nested)) continue;
    for (let j = 0; j < nested.length; j++) {
      const child = asDict(nested[j]);
      if (!child) continue;
      const id = panelId(child);
      if (id !== undefined && id === panelIdArg) {
        nested.splice(j, 1);
        return { dashboard: out, errors: [] };
      }
    }
  }

  return {
    errors: [
      { path: 'panelId', message: `panel id ${panelIdArg} not found in dashboard` },
    ],
  };
}
