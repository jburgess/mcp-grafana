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

import type { ValidationError } from './validate.js';

export interface RemoveResult {
  dashboard?: Record<string, unknown>;
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

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

  // Top-level search
  for (let i = 0; i < top.length; i++) {
    const p = asDict(top[i]);
    if (!p) continue;
    if (panelId(p) === targetIdMatch(panelIdArg, p)) {
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
      if (panelId(child) === panelIdArg) {
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

// Defensive helper — panel ids can be number or string. We compare directly,
// but route through this for clarity.
function targetIdMatch(targetId: number | string, panel: Dict): number | string | undefined {
  const id = panelId(panel);
  return id === targetId ? id : undefined;
}
