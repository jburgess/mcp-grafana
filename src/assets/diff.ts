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
 * Per AGENTS.md §1.8 this module emits FACTS only — it never judges which
 * changes are risky. That judgement lives in docs/guidance/pr-review.md
 * (served as an MCP resource), which an LLM reads to interpret the diff.
 */

import { type Dict, asArray, asDict, asString } from './_internal.js';
import { type PanelRow, listPanelRows } from './inspect.js';

export interface FieldChange {
  /** The changed field's name, e.g. `unit`, `datasource`, `gridPos`. */
  field: string;
  /** Value in the "before" dashboard (`undefined` when the field was absent). */
  before: unknown;
  /** Value in the "after" dashboard (`undefined` when the field was removed). */
  after: unknown;
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
  changes: FieldChange[];
}

export interface DashboardDiff {
  /** Panels present in `b` but not matched in `a`. */
  panelsAdded: PanelRow[];
  /** Panels present in `a` but not matched in `b`. */
  panelsRemoved: PanelRow[];
  /** Panels matched in both whose normalized projection differs. */
  panelsChanged: PanelChange[];
  /** Dashboard-level (non-panel) field changes. */
  dashboardChanges: FieldChange[];
}

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

// Deep value-equality over JSON-shaped projections. Adequate here because
// PanelRow / the dashboard-level fields are built deterministically (fixed
// key order from inspect.ts and from this file), so a structural difference
// always shows up as a string difference and a non-difference never does.
function jsonEqual(x: unknown, y: unknown): boolean {
  return JSON.stringify(x) === JSON.stringify(y);
}

// A stable key for matching a panel across the two dashboards: its id when
// present (the well-formed case — Grafana always assigns ids), else its
// title. Panels with neither can't be matched and surface as added/removed.
function matchKey(p: PanelRow): string | undefined {
  if (p.id !== undefined) return `id:${p.id}`;
  if (p.title !== undefined) return `title:${p.title}`;
  return undefined;
}

// Groups panels by match key, preserving array order within each group, so
// that when a key is non-unique (two id-less panels sharing a title) the
// members can be zipped positionally instead of collapsing into one.
function groupByKey(panels: PanelRow[]): Map<string, PanelRow[]> {
  const groups = new Map<string, PanelRow[]>();
  for (const p of panels) {
    const key = matchKey(p);
    if (key === undefined) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(p);
    else groups.set(key, [p]);
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
// meaning), variables as their ordered name list (captures add / remove /
// rename without dragging in every option/current-value edit, which is a
// per-variable concern a panel-style diff shouldn't adjudicate).
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
 * zipped positionally. A matched pair with no field differences is omitted
 * from `panelsChanged` (a clean panel is not a change).
 */
export function diffDashboards(a: unknown, b: unknown): DashboardDiff {
  const dashA = asDict(a) ?? {};
  const dashB = asDict(b) ?? {};

  const panelsA = listPanelRows(dashA);
  const panelsB = listPanelRows(dashB);

  const groupsA = groupByKey(panelsA);
  const groupsB = groupByKey(panelsB);

  const panelsAdded: PanelRow[] = [];
  const panelsRemoved: PanelRow[] = [];
  const panelsChanged: PanelChange[] = [];

  // Panels with no match key on either side can't be paired — count them
  // as added / removed so they aren't silently dropped.
  for (const p of panelsA) {
    if (matchKey(p) === undefined) panelsRemoved.push(p);
  }
  for (const p of panelsB) {
    if (matchKey(p) === undefined) panelsAdded.push(p);
  }

  const allKeys = new Set([...groupsA.keys(), ...groupsB.keys()]);
  for (const key of allKeys) {
    const bucketA = groupsA.get(key) ?? [];
    const bucketB = groupsB.get(key) ?? [];
    const paired = Math.min(bucketA.length, bucketB.length);

    for (let i = 0; i < paired; i++) {
      const before = bucketA[i]!;
      const after = bucketB[i]!;
      const changes = diffPanelPair(before, after);
      if (changes.length === 0) continue;
      const change: PanelChange = { changes };
      const id = after.id ?? before.id;
      if (id !== undefined) change.id = id;
      const title = after.title ?? before.title;
      if (title !== undefined) change.title = title;
      panelsChanged.push(change);
    }

    // Extra members on either side are unmatched within this key group.
    for (let i = paired; i < bucketA.length; i++) panelsRemoved.push(bucketA[i]!);
    for (let i = paired; i < bucketB.length; i++) panelsAdded.push(bucketB[i]!);
  }

  return {
    panelsAdded,
    panelsRemoved,
    panelsChanged,
    dashboardChanges: diffDashboardLevel(dashA, dashB),
  };
}
