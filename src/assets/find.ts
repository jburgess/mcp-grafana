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
 *                         `rawQuery` must match. Pattern length is
 *                         capped at 200 characters (length only — NOT
 *                         complexity; a short pathological pattern
 *                         like `^(a+)+$` can still catastrophic-
 *                         backtrack). Longer patterns return an error.
 *                         Invalid regex syntax also returns an error.
 *                         Callers should avoid nested quantifiers and
 *                         overlapping alternations regardless of cap.
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
import {
  type Dict,
  asArray,
  asDict,
  asString,
  nonEmptyString,
  panelId,
} from './_internal.js';

// Cap caps PATTERN LENGTH, not regex COMPLEXITY. A short pathological
// pattern like `^(a+)+$` (8 chars, well under the cap) can still
// catastrophic-backtrack on adversarial input. Real ReDoS protection
// would require a per-call regex timeout or a complexity analyzer
// (the v8 regex engine is non-backtracking-optional). The cap exists
// to bound the obvious bomb shape — multi-kilobyte patterns — and to
// make sure no caller accidentally pastes a payload. Callers should
// avoid nested quantifiers and overlapping alternations regardless of
// length. The number itself (200) comfortably accommodates the
// longest realistic query-matching pattern observed in real Grafana
// dashboards (PromQL function-name + label-matcher patterns max out
// around 80 chars) with ~2.5× headroom.
const MAX_QUERY_MATCHES_LEN = 200;

export interface PanelsFindFilter {
  /** Exact match on `panel.type`. */
  type?: string;
  /** Exact match on `panel.fieldConfig.defaults.unit`. */
  unit?: string;
  /**
   * When true, match panels with a non-empty unit. When false, match
   * panels missing one (`null` / `undefined` / `""` all count as
   * missing — the empty-string-as-missing rule from `_internal.ts`'s
   * `nonEmptyString`). Row panels are excluded entirely (rows don't
   * carry units), matching how `hasDescription` excludes rows.
   *
   * Use this when the audit pattern needs "panels with no unit set"
   * — the `unit` filter only does exact-string match, so there's no
   * other way to surface unit-less panels. See
   * `docs/guidance/units.md` for the canonical workflow.
   */
  hasUnit?: boolean;
  /**
   * When true, match panels with a non-empty description. When false,
   * match panels missing one (empty-string counted as missing). Row
   * panels are excluded entirely from this filter.
   */
  hasDescription?: boolean;
  /**
   * Regex pattern (as a string). At least one of the panel's
   * `targets[].expr` / `.query` / `.rawQuery` fields must match.
   * Pattern length is capped at 200 chars (length only — NOT
   * complexity; `^(a+)+$` can still backtrack catastrophically).
   * Longer patterns and invalid regex syntax produce errors.
   */
  queryMatches?: string;
}

// Closed set of allowed filter keys, used by `findPanels` to reject
// typos like `matches:` (typo of `queryMatches:`) at the library entry
// point. The MCP boundary in `src/mcp/server.ts` enforces the same set
// via Zod's `.strict()` — this is the parallel enforcement for direct
// library callers (issue #42 fix).
//
// Drift discipline: the `keyof PanelsFindFilter` type catches the
// forward direction (an entry here that isn't on the interface). The
// reverse direction — new interface field forgotten here — is NOT
// caught by the type system. When adding a key to `PanelsFindFilter`,
// update three places in lock-step: this Set, the Zod schema in
// `src/mcp/server.ts`, and the tool description's filter-fields
// bullet list. A drifted Set silently produces unknown-key errors on
// valid library calls — the integration test "every known filter key
// passes" in `test/assets/find.test.ts` catches that exact case for
// the keys it enumerates.
const ALLOWED_FILTER_KEYS: ReadonlySet<keyof PanelsFindFilter> = new Set<keyof PanelsFindFilter>([
  'type',
  'unit',
  'hasUnit',
  'hasDescription',
  'queryMatches',
]);

// Additions to this filter set are a public-API commitment. Before
// adding `panelType in [...]`, `gridPos`, `hasField: 'path.to.field'`,
// etc., consider whether composing two `findPanels` calls or one
// `findPanels` plus a client-side filter solves the same problem —
// the closed set is a budget, not a freezer. New fields should land
// with an ADR weighing the precedent ("does this become the predicate
// DSL the team-review reshape rejected?") against the use case.
// `hasUnit` (issue #43) was added as the symmetric twin of
// `hasDescription` — a strict parallel of an existing primitive, not
// the start of a generic DSL.
//
// Naysayer hook (issue #31 team-review): the closed DSL was chosen
// to prevent silent-no-op typos AND to bound the maintenance surface
// against drift toward an open predicate.

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

function hasNonEmptyUnit(panel: Dict): boolean {
  const u = panelUnit(panel);
  return u !== undefined && u !== '';
}

// Match against the first non-empty of expr / query / rawQuery on any
// of the panel's targets. Mirrors lintPanel and validate.ts. Uses
// `nonEmptyString` (not raw `asString`) so the `??` fallback walks
// past `expr: ""` — Grafana panels sometimes ship that shape and the
// query the user actually wants to match lives in `query` or
// `rawQuery`. The history of this bug is documented in
// _internal.ts:nonEmptyString.
function anyTargetMatches(panel: Dict, re: RegExp): boolean {
  const targets = asArray(panel.targets);
  for (const item of targets) {
    const t = asDict(item);
    if (!t) continue;
    const expr =
      nonEmptyString(t.expr) ?? nonEmptyString(t.query) ?? nonEmptyString(t.rawQuery);
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
  if (filter.hasUnit !== undefined) {
    // Rows don't carry units — exclude them from the filter entirely,
    // matching the hasDescription convention. A user asking for
    // "panels with no unit" doesn't want rows in the result.
    if (asString(panel.type) === 'row') return false;
    if (hasNonEmptyUnit(panel) !== filter.hasUnit) return false;
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

  // Reject unknown filter keys (issue #42). The MCP boundary already
  // enforces this via Zod `.strict()` — this is the parallel guard
  // for direct library callers, who otherwise sail past `matchesFilter`
  // (which silently ignores unrecognised keys) and get back every
  // panel in the dashboard. Documented invariant; closed-DSL design
  // depends on it.
  const filterObj = asDict(filter) ?? {};
  const unknown = Object.keys(filterObj).filter(
    (k) => !ALLOWED_FILTER_KEYS.has(k as keyof PanelsFindFilter),
  );
  if (unknown.length > 0) {
    const allowed = [...ALLOWED_FILTER_KEYS].join(', ');
    return {
      panelIds: [],
      errors: unknown.map((k) => ({
        path: `filter.${k}`,
        message: `unknown filter key "${k}" (allowed: ${allowed})`,
      })),
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
