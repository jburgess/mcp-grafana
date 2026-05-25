/**
 * Semantic dashboard diff — the "review" leg of the workflow (build / audit /
 * review). Given two dashboard JSONs, report what CHANGED in human-meaningful
 * terms: panels added, panels removed, per-panel field changes, and
 * dashboard-level field changes.
 *
 * Why this exists: a Grafana dashboard PR is a diff over deeply-nested,
 * frequently-reordered JSON. The textual diff a reviewer sees in the PR is
 * dominated by noise (a panel moved in the array → every following panel's
 * `gridPos.y` shifts; a re-export reorders object keys) and buries the one
 * thing that mattered — a threshold flipped, a datasource swapped, a unit
 * dropped. This primitive emits only the semantic deltas, computed over the
 * same normalized per-panel projection (`PanelRow`) that
 * grafana_dashboard_inspect surfaces.
 *
 * The projection is shallow by design (id, title, type, description, unit,
 * datasource, targets, gridPos, rowId) — it does NOT carry thresholds,
 * colors, fieldConfig overrides, transformations, panel options, or links.
 * To avoid the trap of reporting a confident "no change" when one of those
 * uncovered fields actually changed, each matched panel also carries an
 * `otherChanges` flag: true when the raw panel differs OUTSIDE the projected
 * fields, telling the reviewer to read the raw JSON for that panel.
 *
 * Per AGENTS.md §1.8 this module emits FACTS only — it never judges which
 * changes are risky. That judgement lives in docs/guidance/pr-review.md
 * (served as an MCP resource), which an LLM reads to interpret the diff.
 */

import { type Dict, asArray, asDict, asString, deepClone } from './_internal.js';
import { type PanelEntry, type PanelRow, listPanelEntries } from './inspect.js';

export interface FieldChange {
  /** The changed field's name, e.g. `unit`, `datasource`, `gridPos`. */
  field: string;
  /** Value in the "before" dashboard (absent in the JSON output when the field was added). */
  before?: unknown;
  /** Value in the "after" dashboard (absent in the JSON output when the field was removed). */
  after?: unknown;
}

export interface PanelChange {
  /**
   * The matched panel's id. Panels are matched by id when present, falling
   * back to title; this is absent only for an id-less panel matched by title
   * (in which case `title` identifies it). Well-formed dashboards always
   * carry ids, so this is normally present.
   */
  id?: number | string;
  /** The panel's title (from the "after" side when present, else "before"), for readability. */
  title?: string;
  /** Projected-field changes (see PANEL_FIELDS). May be empty when only `otherChanges` is set. */
  changes: FieldChange[];
  /**
   * True when the raw panel differs in fields the projection does NOT cover
   * (thresholds, color, fieldConfig.overrides, transformations, options,
   * links, …). Present only when true. When set, read the raw panel JSON —
   * `changes` alone does not tell the whole story.
   */
  otherChanges?: boolean;
}

export interface DashboardDiff {
  /** Panels present in `b` but not matched in `a`. */
  panelsAdded: PanelRow[];
  /** Panels present in `a` but not matched in `b`. */
  panelsRemoved: PanelRow[];
  /** Panels matched in both whose projection differs (or that have out-of-projection changes). */
  panelsChanged: PanelChange[];
  /** Dashboard-level (non-panel) field changes. */
  dashboardChanges: FieldChange[];
  /**
   * True when any of the three panel arrays was capped at MAX_PANEL_ENTRIES.
   * A diff over a near-total rewrite of a large dashboard would otherwise
   * re-inject the whole dashboard into the LLM context — defeating the
   * point of working by registry URI. Present only when truncation occurred.
   */
  truncated?: boolean;
}

// Per-array cap on emitted panel entries. Mirrors the bounded-output
// discipline of validateDashboard / lintDashboard (which cap their issue
// lists). Generous enough that a normal review diff is never truncated, but
// bounds the pathological base-vs-empty / wholesale-rewrite case.
const MAX_PANEL_ENTRIES = 200;

// The normalized PanelRow fields compared between a matched pair. `id` is
// excluded — it's the match key, not a change. Order here is the order
// changes are reported in.
const PANEL_FIELDS: Array<keyof PanelRow> = [
  'title',
  'type',
  'description',
  'unit',
  'datasource',
  'targetCount',
  'gridPos',
  'rowId',
  'targets',
];

// Raw top-level panel keys the projection already covers. Stripped (along
// with fieldConfig.defaults.unit) before the out-of-projection comparison so
// that a change the projection DID surface isn't double-counted as an
// "other" change.
const PROJECTED_RAW_KEYS = ['id', 'title', 'type', 'description', 'datasource', 'gridPos', 'targets'];

// Deep value-equality over JSON-shaped projections. Adequate here because
// PanelRow / the dashboard-level fields are built deterministically (fixed
// key order from inspect.ts and from this file), so a structural difference
// always shows up as a string difference and a non-difference never does.
function jsonEqual(x: unknown, y: unknown): boolean {
  return JSON.stringify(x) === JSON.stringify(y);
}

// Returns a copy of the raw panel with the projection-covered fields removed,
// so two such copies compare equal iff the panels agree on everything the
// projection does NOT surface. Covers the deep case: `fieldConfig.defaults.unit`
// is the only projected leaf under fieldConfig, so thresholds / color /
// custom / overrides under fieldConfig all survive and are compared.
function outsideProjection(raw: Dict): Dict {
  const clone = deepClone(raw);
  for (const key of PROJECTED_RAW_KEYS) delete clone[key];
  const fieldConfig = asDict(clone.fieldConfig);
  if (fieldConfig) {
    const defaults = asDict(fieldConfig.defaults);
    if (defaults) delete defaults.unit;
  }
  return clone;
}

// A stable key for matching a panel across the two dashboards: its id when
// present (the well-formed case — Grafana always assigns ids), else its
// title. Panels with neither can't be matched and surface as added/removed.
function matchKey(p: PanelRow): string | undefined {
  if (p.id !== undefined) return `id:${p.id}`;
  if (p.title !== undefined) return `title:${p.title}`;
  return undefined;
}

// Groups entries by their projection's match key, preserving array order
// within each group, so that when a key is non-unique (two id-less panels
// sharing a title) the members can be zipped positionally instead of
// collapsing into one.
function groupByKey(entries: PanelEntry[]): Map<string, PanelEntry[]> {
  const groups = new Map<string, PanelEntry[]>();
  for (const e of entries) {
    const key = matchKey(e.row);
    if (key === undefined) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }
  return groups;
}

function diffPanelPair(a: PanelRow, b: PanelRow): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of PANEL_FIELDS) {
    const before = a[field];
    const after = b[field];
    if (!jsonEqual(before, after)) {
      changes.push({ field, before, after });
    }
  }
  return changes;
}

// Dashboard-level fields compared, normalized so cosmetic noise doesn't
// register: tags are compared as a sorted set (Grafana tag order carries no
// meaning), variables as their ordered name list. NOTE the variable-name
// list captures add / remove / rename only — an intra-variable edit (a
// variable's query, datasource, or current value changing while its name
// stays put) is NOT visible here; the pr-review recipe says so and points
// at grafana_dashboard_validate for dangling-ref checks.
function dashboardFields(dash: Dict): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const title = asString(dash.title);
  if (title !== undefined) out.title = title;
  const uid = asString(dash.uid);
  if (uid !== undefined) out.uid = uid;
  const timezone = asString(dash.timezone);
  if (timezone !== undefined) out.timezone = timezone;
  // `refresh` is a string ("30s") in modern dashboards but historically
  // could be `false`; pass it through verbatim when present and primitive.
  if (typeof dash.refresh === 'string' || typeof dash.refresh === 'boolean') {
    out.refresh = dash.refresh;
  }
  if (typeof dash.schemaVersion === 'number') out.schemaVersion = dash.schemaVersion;

  const tags = asArray(dash.tags)
    .filter((t): t is string => typeof t === 'string')
    .sort();
  if (tags.length > 0) out.tags = tags;

  const variableNames = asArray(asDict(dash.templating)?.list)
    .map((v) => asString(asDict(v)?.name))
    .filter((n): n is string => n !== undefined);
  if (variableNames.length > 0) out.variableNames = variableNames;

  return out;
}

function diffDashboardLevel(a: Dict, b: Dict): FieldChange[] {
  const fa = dashboardFields(a);
  const fb = dashboardFields(b);
  const fields = Array.from(new Set([...Object.keys(fa), ...Object.keys(fb)])).sort();
  const changes: FieldChange[] = [];
  for (const field of fields) {
    if (!jsonEqual(fa[field], fb[field])) {
      changes.push({ field, before: fa[field], after: fb[field] });
    }
  }
  return changes;
}

/**
 * Diffs two Grafana dashboards on their normalized projections and returns
 * the semantic deltas. Inputs are `unknown` (Grafana JSON is user-supplied);
 * non-object inputs are treated as empty dashboards (everything in the other
 * side reads as wholly added / removed). Neither input is mutated.
 *
 * Panel matching: by `id` when present, else by `title`; non-unique keys are
 * zipped positionally. A matched pair with no projected-field difference and
 * no out-of-projection difference is omitted from `panelsChanged`.
 */
export function diffDashboards(a: unknown, b: unknown): DashboardDiff {
  const dashA = asDict(a) ?? {};
  const dashB = asDict(b) ?? {};

  const entriesA = listPanelEntries(dashA);
  const entriesB = listPanelEntries(dashB);

  const groupsA = groupByKey(entriesA);
  const groupsB = groupByKey(entriesB);

  const panelsAdded: PanelRow[] = [];
  const panelsRemoved: PanelRow[] = [];
  const panelsChanged: PanelChange[] = [];

  // Panels with no match key on either side can't be paired — count them
  // as added / removed so they aren't silently dropped.
  for (const e of entriesA) {
    if (matchKey(e.row) === undefined) panelsRemoved.push(e.row);
  }
  for (const e of entriesB) {
    if (matchKey(e.row) === undefined) panelsAdded.push(e.row);
  }

  const allKeys = new Set([...groupsA.keys(), ...groupsB.keys()]);
  for (const key of allKeys) {
    const bucketA = groupsA.get(key) ?? [];
    const bucketB = groupsB.get(key) ?? [];
    const paired = Math.min(bucketA.length, bucketB.length);

    for (let i = 0; i < paired; i++) {
      const before = bucketA[i]!;
      const after = bucketB[i]!;
      const changes = diffPanelPair(before.row, after.row);
      const otherChanges = !jsonEqual(outsideProjection(before.raw), outsideProjection(after.raw));
      if (changes.length === 0 && !otherChanges) continue;
      const change: PanelChange = { changes };
      const id = after.row.id ?? before.row.id;
      if (id !== undefined) change.id = id;
      const title = after.row.title ?? before.row.title;
      if (title !== undefined) change.title = title;
      if (otherChanges) change.otherChanges = true;
      panelsChanged.push(change);
    }

    // Extra members on either side are unmatched within this key group.
    for (let i = paired; i < bucketA.length; i++) panelsRemoved.push(bucketA[i]!.row);
    for (let i = paired; i < bucketB.length; i++) panelsAdded.push(bucketB[i]!.row);
  }

  let truncated = false;
  const cap = <T>(arr: T[]): T[] => {
    if (arr.length <= MAX_PANEL_ENTRIES) return arr;
    truncated = true;
    return arr.slice(0, MAX_PANEL_ENTRIES);
  };

  const diff: DashboardDiff = {
    panelsAdded: cap(panelsAdded),
    panelsRemoved: cap(panelsRemoved),
    panelsChanged: cap(panelsChanged),
    dashboardChanges: diffDashboardLevel(dashA, dashB),
  };
  if (truncated) diff.truncated = true;
  return diff;
}
