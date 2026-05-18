/**
 * Applies a JSON Merge Patch (RFC 7396) to a specific panel in a dashboard.
 *
 * The W2 (audit) workflow needs to fix small things on specific panels:
 * "add a description here", "change the unit to decbytes", "drop the legend
 * format". Rebuilding the panel from scratch via the panel-build tools would
 * lose fields that the build tools don't surface (color, thresholds, custom
 * transforms, overrides). Patch semantics let the LLM target a single field
 * without disturbing anything else.
 *
 * RFC 7396 in three rules:
 *   - If patch[k] is null, delete target[k].
 *   - If patch[k] is an object (not array, not null), recurse — target[k]
 *     and patch[k] are deep-merged.
 *   - Otherwise (primitive, array), patch[k] replaces target[k].
 *
 * Arrays are replaced wholesale by design. If the LLM wants to add one
 * target to a panel that already has three, it must include all four in
 * the patch.
 *
 * Returns { dashboard?, errors[] } — same shape as insert/validate. The
 * input dashboard and patch are never mutated.
 */

import type { ValidationError } from './validate.js';

export interface UpdateResult {
  /** Present on success; absent when errors[] is non-empty. */
  dashboard?: Record<string, unknown>;
  /** Empty on success; populated on failure (unknown panelId, bad input). */
  errors: ValidationError[];
}

import { type Dict, asArray, asDict, asString, deepClone, panelId } from './_internal.js';

/**
 * RFC 7396 JSON Merge Patch. Pure function — neither target nor patch
 * is mutated; returns the merged value.
 */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    // Primitive / array / null at this level → patch replaces target.
    return patch;
  }

  const patchObj = patch as Dict;
  const targetObj: Dict =
    target !== null && typeof target === 'object' && !Array.isArray(target)
      ? { ...(target as Dict) }
      : {};

  for (const [key, value] of Object.entries(patchObj)) {
    if (value === null) {
      delete targetObj[key];
    } else {
      targetObj[key] = mergePatch(targetObj[key], value);
    }
  }
  return targetObj;
}

/**
 * Walks the dashboard's panel tree (top-level + legacy row.panels[])
 * looking for the target id. Mutates the dashboard in place when found,
 * applying the merge in situ. Returns true if the panel was located and
 * patched, false otherwise.
 */
function patchPanelInPlace(
  dashboard: Dict,
  targetId: number | string,
  patch: Dict,
): boolean {
  const top = asArray(dashboard.panels);
  for (let i = 0; i < top.length; i++) {
    const panel = asDict(top[i]);
    if (!panel) continue;

    if (panelId(panel) === targetId) {
      top[i] = mergePatch(panel, patch);
      // Re-assign panels array so the outer dashboard sees the update.
      dashboard.panels = top;
      return true;
    }

    if (asString(panel.type) === 'row') {
      const nested = asArray(panel.panels);
      for (let j = 0; j < nested.length; j++) {
        const child = asDict(nested[j]);
        if (!child) continue;
        if (panelId(child) === targetId) {
          nested[j] = mergePatch(child, patch);
          panel.panels = nested;
          return true;
        }
      }
    }
  }
  return false;
}

export function updatePanel(
  dashboard: unknown,
  panelIdArg: number | string,
  patch: unknown,
): UpdateResult {
  const dash = asDict(dashboard);
  if (!dash) {
    return {
      errors: [{ path: '$', message: 'dashboard must be an object', code: 'dashboard-not-object' }],
    };
  }

  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return {
      errors: [
        {
          path: 'patch',
          message: 'patch must be an object (RFC 7396 JSON Merge Patch)',
          code: 'patch-not-object',
        },
      ],
    };
  }

  const out = deepClone(dash);
  const found = patchPanelInPlace(out, panelIdArg, patch as Dict);

  if (!found) {
    return {
      errors: [
        {
          path: 'panelId',
          message: `panel id ${panelIdArg} not found in dashboard`,
          code: 'panel-not-found',
        },
      ],
    };
  }

  return { dashboard: out, errors: [] };
}
