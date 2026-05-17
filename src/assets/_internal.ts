/**
 * Shared internal helpers for the dashboard mutation tools.
 *
 * Naming convention: the leading underscore marks this as a private module —
 * not part of the public package API. Imported only by sibling files in
 * src/assets/. If you find yourself reaching for these from src/mcp/ or
 * elsewhere, surface a typed wrapper in the calling module instead.
 *
 * Why this exists: insert/update/move/remove/inspect/validate all defensively
 * narrow `unknown` inputs (Grafana JSON is user-supplied — could be
 * hand-edited, partially imported, or built by different tooling). Each
 * module was hand-rolling the same dozen helpers, and a real bug (the
 * `remove.ts` id-less-panel false-match) crept in via the duplication. One
 * source of truth.
 */

/** A plain JS object — what JSON.parse hands back for `{...}`. */
export type Dict = Record<string, unknown>;

export function asDict(v: unknown): Dict | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : undefined;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Like `asString` but treats `""` as missing too. Use this when the
 * project convention is "absent and empty are semantically the same"
 * — Grafana's UI renders `description: ""` and a missing description
 * identically, so the rule "empty counts as missing" applies to
 * descriptions, legendFormat, refId, panel target expr fallback, etc.
 *
 * History: this pattern bit three reviews in a row (PR #32 description
 * undercount; PR #32 round-2 legendFormat/refId leak; PR #38 expr
 * fallback short-circuit). Lifting it here once means every site uses
 * the same definition of "empty is missing" and future sites don't
 * re-introduce the `??` short-circuit bug.
 */
export function nonEmptyString(v: unknown): string | undefined {
  const s = asString(v);
  return s === undefined || s === '' ? undefined : s;
}

export function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/**
 * Returns the panel's id, normalized to number or string, or undefined if
 * the panel has no id at all. Importantly: a missing id is distinct from
 * `undefined === undefined` comparison results — callers comparing ids
 * must guard against undefined explicitly. See remove.ts regression for
 * the bug this caused historically.
 */
export function panelId(panel: Dict): number | string | undefined {
  return asNumber(panel.id) ?? asString(panel.id);
}

export interface GridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function panelGridPos(panel: Dict): GridPos | undefined {
  const g = asDict(panel.gridPos);
  if (!g) return undefined;
  const x = asNumber(g.x);
  const y = asNumber(g.y);
  const w = asNumber(g.w);
  const h = asNumber(g.h);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x, y, w, h };
}

/**
 * Deep-clones JSON-shaped data via round-trip. Adequate for dashboards
 * (no functions, no dates, no undefined values that matter). Used by every
 * mutation tool so the input is never modified.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Walks every panel in a dashboard's `panels[]` array — top-level entries
 * plus legacy-format row-nested children (`row.panels[]`) — yielding each
 * panel as a `Dict`. Tolerates a missing or non-array `panels` (yields
 * nothing). Shared by `buildDashboard` and `insertPanel` so the build
 * path and the insert path agree on what "every panel in the tree" means.
 */
export function* walkPanelsDeep(panels: unknown): Generator<Dict> {
  for (const raw of asArray(panels)) {
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

/**
 * Computes the next free integer panel id for a dashboard: `max(existing
 * numeric ids) + 1`, or `1` when no panel carries one. Walks top-level
 * and legacy row-nested panels via `walkPanelsDeep`. String ids and
 * non-numeric ids are ignored for the max calculation (they cannot
 * collide with a number-typed assignment anyway).
 *
 * Treats `id: 0` as missing for the purposes of "id is assigned" — `0`
 * is the Foundation SDK's default-initialised value and Grafana's UI
 * treats it as unassigned. Counted toward max only when a panel
 * explicitly carries a numeric id ≥ 1.
 */
export function nextFreePanelId(panels: unknown): number {
  let max = 0;
  for (const panel of walkPanelsDeep(panels)) {
    const id = asNumber(panel.id);
    if (id !== undefined && id > max) max = id;
  }
  return max + 1;
}
