/**
 * Predicate-based panel selection for dashboards-as-code workflows.
 *
 * `findPanels(dashboard, filter)` returns the ids of panels matching
 * every supplied filter field (AND semantics). Closed filter set per
 * the issue #31 team-review reshape — open predicate objects invite
 * silent-no-op typos ("`matches:`" instead of "`queryMatches:`" would
 * return zero results with no error).
 *
 * Typical use case: precursor to a bulk operation. "Find every
 * timeseries panel with unit `short` whose query uses `rate(`" →
 * pipe the id list into a forthcoming `panel_update_bulk`.
 *
 * Filter fields:
 *   - `type`            — exact match on `panel.type` (`timeseries`,
 *                         `stat`, `row`, `table`, `gauge`, …).
 *   - `unit`            — exact match on
 *                         `panel.fieldConfig.defaults.unit`.
 *   - `hasDescription`  — when true, panel has a non-empty description;
 *                         when false, panel has none (empty-string
 *                         counts as missing, matching inspectDashboard
 *                         and lintPanel). Row panels are excluded from
 *                         this filter entirely — they're section markers,
 *                         not visualizations with descriptions.
 *   - `queryMatches`    — JavaScript regex pattern (as a string). At
 *                         least one target's `expr` / `query` /
 *                         `rawQuery` must match. Pattern is capped at
 *                         200 characters to keep ReDoS attack surface
 *                         bounded; longer patterns return an error.
 *                         Invalid regex syntax also returns an error.
 *
 * Empty filter (`{}`) matches every panel. Multiple filters AND
 * together. Results are returned in dashboard walk order (top-level
 * panels first, then legacy `row.panels[]`) so consumers can rely on
 * a stable ordering.
 *
 * Returns `{ panelIds, errors }`. On any error (malformed dashboard,
 * malformed regex, regex too long), `panelIds` is empty and `errors`
 * carries the diagnostic. Errors are returned, never thrown — matches
 * the project convention (validate / insert / lint / etc.).
 */

import type { ValidationError } from './validate.js';
import { type Dict, asArray, asDict, asString, panelId } from './_internal.js';

const MAX_QUERY_MATCHES_LEN = 200;

export interface PanelsFindFilter {
  /** Exact match on `panel.type`. */
  type?: string;
  /** Exact match on `panel.fieldConfig.defaults.unit`. */
  unit?: string;
  /**
   * When true, match panels with a non-empty description. When false,
   * match panels missing one (empty-string counted as missing). Row
   * panels are excluded entirely from this filter.
   */
  hasDescription?: boolean;
  /**
   * Regex pattern (as a string). At least one of the panel's
   * `targets[].expr` / `.query` / `.rawQuery` fields must match.
   * Pattern length is capped at 200 chars; longer patterns produce
   * an error rather than running. Invalid regex syntax produces an
   * error.
   */
  queryMatches?: string;
}

export interface PanelsFindResult {
  /** Ids of matching panels in dashboard walk order. */
  panelIds: Array<number | string>;
  /** Structural problems (malformed dashboard, malformed regex, etc.). */
  errors: ValidationError[];
}

function panelUnit(panel: Dict): string | undefined {
  return asString(asDict(asDict(panel.fieldConfig)?.defaults)?.unit);
}

function hasNonEmptyDescription(panel: Dict): boolean {
  const d = asString(panel.description);
  return d !== undefined && d !== '';
}

// Match against the first non-empty of expr / query / rawQuery on any
// of the panel's targets. Mirrors lintPanel and validate.ts.
function anyTargetMatches(panel: Dict, re: RegExp): boolean {
  const targets = asArray(panel.targets);
  for (const item of targets) {
    const t = asDict(item);
    if (!t) continue;
    const expr =
      asString(t.expr) ?? asString(t.query) ?? asString(t.rawQuery);
    if (expr !== undefined && re.test(expr)) return true;
  }
  return false;
}

// Returns true when `panel` matches every supplied filter field.
function matchesFilter(panel: Dict, filter: PanelsFindFilter, queryRe: RegExp | undefined): boolean {
  if (filter.type !== undefined) {
    if (asString(panel.type) !== filter.type) return false;
  }
  if (filter.unit !== undefined) {
    if (panelUnit(panel) !== filter.unit) return false;
  }
  if (filter.hasDescription !== undefined) {
    // Rows are excluded from description filtering — they're section
    // markers, not visualizations. Returning false for the row case
    // means the filter never matches a row, regardless of true/false.
    if (asString(panel.type) === 'row') return false;
    const has = hasNonEmptyDescription(panel);
    if (has !== filter.hasDescription) return false;
  }
  if (queryRe !== undefined) {
    if (!anyTargetMatches(panel, queryRe)) return false;
  }
  return true;
}

export function findPanels(
  dashboard: unknown,
  filter: PanelsFindFilter,
): PanelsFindResult {
  const dash = asDict(dashboard);
  if (!dash) {
    return {
      panelIds: [],
      errors: [{ path: '$', message: 'dashboard must be a JSON object' }],
    };
  }

  // Compile the queryMatches regex once. Cap length and capture
  // compile errors so the caller learns about the problem rather than
  // getting a silent empty result.
  let queryRe: RegExp | undefined;
  if (filter.queryMatches !== undefined) {
    if (filter.queryMatches.length > MAX_QUERY_MATCHES_LEN) {
      return {
        panelIds: [],
        errors: [
          {
            path: 'filter.queryMatches',
            message: `regex pattern length ${filter.queryMatches.length} exceeds the cap of ${MAX_QUERY_MATCHES_LEN} (capped to bound ReDoS surface)`,
          },
        ],
      };
    }
    try {
      queryRe = new RegExp(filter.queryMatches);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        panelIds: [],
        errors: [
          {
            path: 'filter.queryMatches',
            message: `invalid regex pattern: ${message}`,
          },
        ],
      };
    }
  }

  const out: Array<number | string> = [];
  const collect = (panel: Dict): void => {
    if (!matchesFilter(panel, filter, queryRe)) return;
    const id = panelId(panel);
    // Skip panels without an id — callers can't reference them
    // downstream (bulk_update et al. lookup by id).
    if (id === undefined) return;
    out.push(id);
  };

  for (const raw of asArray(dash.panels)) {
    const p = asDict(raw);
    if (!p) continue;
    collect(p);
    if (asString(p.type) === 'row') {
      for (const nestedRaw of asArray(p.panels)) {
        const np = asDict(nestedRaw);
        if (np) collect(np);
      }
    }
  }

  return { panelIds: out, errors: [] };
}
