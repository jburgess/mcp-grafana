export type InspectDetail = 'summary' | 'panels' | 'conventions';

export interface InspectDashboardOptions {
  detail?: InspectDetail | undefined;
}

export interface NamingPattern {
  prefix: string;
  count: number;
}

export interface RowSummary {
  id: number | string;
  title?: string;
  panelCount: number;
}

export interface DashboardSummary {
  detail: 'summary';
  title?: string;
  uid?: string;
  panelCount: number;
  variableNames: string[];
  datasourceRefs: string[];
  layoutBounds: { width: number; height: number };
  panelsMissingDescription: number;
  namingPatterns: NamingPattern[];
  rows: RowSummary[];
}

export interface PanelTarget {
  /**
   * Primary query expression. Sourced from the first non-empty of the
   * panel target's `expr` (PromQL), `query` (Loki / Elastic / generic), or
   * `rawQuery` (SQL) field. Capped at 512 JS string-length units; when the
   * source was longer, `truncated` is set to `true` and the text ends with
   * `…`. Datasource-specific fields beyond these three (e.g. CloudWatch's
   * `metricName` + `namespace`) are not surfaced — read the raw dashboard
   * JSON if you need them.
   */
  expr?: string;
  /** Legend format string from the panel target, e.g. `{{instance}}`. */
  legendFormat?: string;
  /** Reference id (A, B, …) used for cross-query references in the panel. */
  refId?: string;
  /**
   * `true` when the panel target is marked hidden (`target.hide === true`).
   * Absent for active targets. Surfaced so audit consumers don't conflate
   * hidden queries with active ones — a panel with 3 targets, 2 hidden,
   * reads as "1 active query" to the eye but `targetCount: 3` to a tool.
   */
  hide?: boolean;
  /**
   * `true` when this target's `expr` was capped at 512 characters. Mirrors
   * the `truncated` flag pattern on `ValidationResult`. Use this to detect
   * truncation instead of inspecting the trailing `…`, which could occur in
   * legitimate text.
   */
  truncated?: boolean;
}

export interface PanelRow {
  id: number | string;
  title?: string;
  type?: string;
  description?: string;
  unit?: string;
  gridPos?: { x: number; y: number; w: number; h: number };
  datasource?: string;
  targetCount: number;
  /**
   * Panel query targets, included so an audit workflow does not have to
   * follow up with a raw-JSON read. Present only when the panel has at
   * least one target; absent otherwise. Each `expr` is capped at 512
   * characters; if truncated, the suffix `…` marks the cut so the
   * truncation is observable. Field falls back across the common
   * datasource query field names (`expr` → `query` → `rawQuery`).
   */
  targets?: PanelTarget[];
  /**
   * The id of the row this panel belongs to, or undefined if the panel is at
   * the top level. For modern (Grafana 8+) dashboards, row membership is
   * inferred from array order — panels following a row panel belong to it.
   * For legacy dashboards (Grafana ≤7), row membership comes from the row's
   * own panels[] array. Row panels themselves always have rowId undefined.
   */
  rowId?: number | string;
}

export interface DashboardPanels {
  detail: 'panels';
  panels: PanelRow[];
}

export interface VariableRow {
  name: string;
  type?: string;
  default?: unknown;
}

export interface DashboardConventions {
  detail: 'conventions';
  panelSizeHistogram: Record<string, number>;
  topUnits: Array<{ unit: string; count: number }>;
  topPanelTypes: Array<{ type: string; count: number }>;
  variables: VariableRow[];
  rowCount: number;
  /**
   * Histogram of `options.graphMode` across stat panels (e.g. `area`, `none`,
   * `line`). Stat-only because graphMode is a stat-panel option. Empty when
   * no stat panels declare it. A stat-heavy dashboard whose stat panels are
   * mostly `area` is KPI-with-trend, not flat KPI — the histogram lets a
   * reviewer credit that without inspecting every panel.
   */
  statGraphModes: Record<string, number>;
  /**
   * Histogram of `options.colorMode` across stat panels (e.g. `value`,
   * `background`, `background_solid`, `none`). Empty when no stat panels
   * declare it.
   */
  statColorModes: Record<string, number>;
}

export type InspectResult = DashboardSummary | DashboardPanels | DashboardConventions;

import {
  type Dict,
  asArray,
  asDict,
  asNumber,
  asString,
  panelGridPos,
  panelId,
} from './_internal.js';

function panelDatasource(panel: Dict): string | undefined {
  const ds = panel.datasource;
  if (typeof ds === 'string') return ds;
  const dsObj = asDict(ds);
  return asString(dsObj?.uid);
}

function panelUnit(panel: Dict): string | undefined {
  return asString(asDict(asDict(panel.fieldConfig)?.defaults)?.unit);
}

// Returns the panel's description normalized to a non-empty string, or
// undefined if absent / empty / non-string. Grafana's UI renders absent and
// "" identically; treating them the same here keeps `panelsMissingDescription`
// honest on dashboards that have been touched by the UI.
function panelDescription(panel: Dict): string | undefined {
  const d = asString(panel.description);
  return d === undefined || d === '' ? undefined : d;
}

// Cap per-expression text to keep the inspect response bounded even when a
// dashboard has pathologically long queries (multiline PromQL with embedded
// comments, generated SQL). 512 is well above the ~95th-percentile real
// query length observed on the dashboards in test/fixtures/ and is the same
// order of magnitude as validate.ts's MAX_ERRORS cap.
const MAX_EXPR_LEN = 512;

// Returns the input verbatim when within the cap; otherwise a truncated copy
// with a trailing `…` marker. Surrogate-pair safe: if the cut would land in
// the middle of a JS surrogate pair (any astral codepoint — emoji, CJK
// extension, math symbols), backs off one code unit so the output is valid
// UTF-16. Returns a flag so the caller doesn't have to inspect the suffix
// to detect truncation (which could appear in legitimate text).
function capExpr(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_EXPR_LEN) return { text: s, truncated: false };
  let cut = MAX_EXPR_LEN - 1;
  const lastUnit = s.charCodeAt(cut - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) cut -= 1;
  return { text: `${s.slice(0, cut)}…`, truncated: true };
}

// `??` only short-circuits on nullish, so `asString("") ?? next` returns ""
// and never tries the next field. Treat "" as missing here too — Grafana's
// UI renders absent and empty identically, same precedent as the
// description fix in panelDescription().
function nonEmptyString(v: unknown): string | undefined {
  const s = asString(v);
  return s === undefined || s === '' ? undefined : s;
}

function panelTargets(panel: Dict): PanelTarget[] | undefined {
  const raw = asArray(panel.targets);
  if (raw.length === 0) return undefined;
  const out: PanelTarget[] = [];
  for (const item of raw) {
    const t = asDict(item);
    if (!t) continue;
    const target: PanelTarget = {};
    // The common datasource query field names — Prometheus uses `expr`,
    // Loki/Elasticsearch/generic use `query`, SQL uses `rawQuery`. Take the
    // first non-empty one so the LLM sees the query regardless of datasource.
    const expr = nonEmptyString(t.expr) ?? nonEmptyString(t.query) ?? nonEmptyString(t.rawQuery);
    if (expr !== undefined) {
      const capped = capExpr(expr);
      target.expr = capped.text;
      if (capped.truncated) target.truncated = true;
    }
    const legendFormat = asString(t.legendFormat);
    if (legendFormat !== undefined) target.legendFormat = legendFormat;
    const refId = asString(t.refId);
    if (refId !== undefined) target.refId = refId;
    if (t.hide === true) target.hide = true;
    // Skip entries we couldn't extract any signal from. `targetCount` on
    // the parent row still reports the raw array length so the consumer
    // sees there was a target there, just one we couldn't summarize.
    if (Object.keys(target).length > 0) out.push(target);
  }
  return out.length === 0 ? undefined : out;
}

function detectNamingPatterns(titles: string[]): NamingPattern[] {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const m = title.match(/^([^:|\-–—]+?)\s*[:|\-–—]\s+/);
    if (m && m[1]) {
      const prefix = m[1].trim();
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([prefix, count]) => ({ prefix, count }));
}

function topByCount<T extends string>(values: T[]): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
}

interface FlatPanel {
  panel: Dict;
  /** Parent row's id, or undefined if this panel is at the top level (or is itself a row). */
  rowId: number | string | undefined;
}

// Walks the dashboard panel tree and returns every panel flattened, tagging
// each with the id of its parent row (if any). Handles both Grafana storage
// formats:
//
//   - Legacy (Grafana ≤7): row panels have their own panels[] array; nested
//     panel gridPos is absolute (verified against Node Exporter Full).
//   - Modern (Grafana 8+): all panels are top-level siblings. A row panel
//     "owns" the non-row panels that follow it in array order, up to the
//     next row.
//
// Real dashboards often mix both styles (Node Exporter Full has 2 modern-style
// rows and 14 legacy-nested rows in the same file), so we handle both in one
// pass. Row panels themselves get rowId=undefined — rows aren't inside rows.
function flattenPanels(dashboard: Dict): FlatPanel[] {
  const out: FlatPanel[] = [];
  let activeRowId: number | string | undefined;

  for (const raw of asArray(dashboard.panels)) {
    const panel = asDict(raw);
    if (!panel) continue;

    if (asString(panel.type) === 'row') {
      out.push({ panel, rowId: undefined });
      const id = panelId(panel);
      activeRowId = id;

      // Legacy format: walk nested panels[] and assign rowId.
      for (const nestedRaw of asArray(panel.panels)) {
        const nested = asDict(nestedRaw);
        if (!nested) continue;
        out.push({ panel: nested, rowId: id });
      }
    } else {
      // Modern format: top-level non-row panel belongs to the most recent
      // row panel (or no row if none has appeared yet).
      out.push({ panel, rowId: activeRowId });
    }
  }
  return out;
}

function summarizeRows(flat: FlatPanel[]): RowSummary[] {
  const childCounts = new Map<number | string, number>();
  for (const { rowId } of flat) {
    if (rowId === undefined) continue;
    childCounts.set(rowId, (childCounts.get(rowId) ?? 0) + 1);
  }

  const rows: RowSummary[] = [];
  for (const { panel } of flat) {
    if (asString(panel.type) !== 'row') continue;
    const id = panelId(panel);
    if (id === undefined) continue;
    const row: RowSummary = { id, panelCount: childCounts.get(id) ?? 0 };
    const title = asString(panel.title);
    if (title !== undefined) row.title = title;
    rows.push(row);
  }
  return rows;
}

function summarize(dashboard: Dict): DashboardSummary {
  const flat = flattenPanels(dashboard);
  const variables = asArray(asDict(dashboard.templating)?.list)
    .map(asDict)
    .filter((v): v is Dict => v !== undefined);

  const datasourceRefs = Array.from(
    new Set(flat.map(({ panel }) => panelDatasource(panel)).filter((d): d is string => d !== undefined)),
  ).sort();

  let maxRight = 0;
  let maxBottom = 0;
  for (const { panel } of flat) {
    const g = panelGridPos(panel);
    if (!g) continue;
    maxRight = Math.max(maxRight, g.x + g.w);
    maxBottom = Math.max(maxBottom, g.y + g.h);
  }

  const panelsMissingDescription = flat.filter(
    ({ panel }) => asString(panel.type) !== 'row' && panelDescription(panel) === undefined,
  ).length;

  const titles = flat
    .map(({ panel }) => asString(panel.title))
    .filter((t): t is string => t !== undefined);

  const summary: DashboardSummary = {
    detail: 'summary',
    panelCount: flat.length,
    variableNames: variables
      .map((v) => asString(v.name))
      .filter((n): n is string => n !== undefined),
    datasourceRefs,
    layoutBounds: { width: maxRight, height: maxBottom },
    panelsMissingDescription,
    namingPatterns: detectNamingPatterns(titles),
    rows: summarizeRows(flat),
  };
  const title = asString(dashboard.title);
  if (title !== undefined) summary.title = title;
  const uid = asString(dashboard.uid);
  if (uid !== undefined) summary.uid = uid;
  return summary;
}

function listPanels(dashboard: Dict): DashboardPanels {
  const panels = flattenPanels(dashboard).map<PanelRow>(({ panel: p, rowId }) => {
    const id = panelId(p);
    const row: PanelRow = {
      id: id ?? 0,
      targetCount: asArray(p.targets).length,
    };
    const title = asString(p.title);
    if (title !== undefined) row.title = title;
    const type = asString(p.type);
    if (type !== undefined) row.type = type;
    const description = panelDescription(p);
    if (description !== undefined) row.description = description;
    const unit = panelUnit(p);
    if (unit !== undefined) row.unit = unit;
    const gridPos = panelGridPos(p);
    if (gridPos !== undefined) row.gridPos = gridPos;
    const datasource = panelDatasource(p);
    if (datasource !== undefined) row.datasource = datasource;
    const targets = panelTargets(p);
    if (targets !== undefined) row.targets = targets;
    if (rowId !== undefined) row.rowId = rowId;
    return row;
  });
  return { detail: 'panels', panels };
}

function extractConventions(dashboard: Dict): DashboardConventions {
  const flat = flattenPanels(dashboard);

  // Size histogram excludes row panels — they're section markers (typically
  // 24x1) and would drown out the real visualization-panel size distribution
  // an LLM needs to mimic when cloning a dashboard.
  const sizeHistogram: Record<string, number> = {};
  for (const { panel } of flat) {
    if (asString(panel.type) === 'row') continue;
    const g = panelGridPos(panel);
    if (!g) continue;
    const key = `${g.w}x${g.h}`;
    sizeHistogram[key] = (sizeHistogram[key] ?? 0) + 1;
  }

  const units = flat
    .map(({ panel }) => panelUnit(panel))
    .filter((u): u is string => u !== undefined);
  const topUnits = topByCount(units).map(({ value, count }) => ({ unit: value, count }));

  const types = flat
    .map(({ panel }) => asString(panel.type))
    .filter((t): t is string => t !== undefined);
  const topPanelTypes = topByCount(types).map(({ value, count }) => ({ type: value, count }));

  const variables = asArray(asDict(dashboard.templating)?.list)
    .map(asDict)
    .filter((v): v is Dict => v !== undefined)
    .map<VariableRow>((v) => {
      const row: VariableRow = { name: asString(v.name) ?? '' };
      const type = asString(v.type);
      if (type !== undefined) row.type = type;
      const current = asDict(v.current);
      if (current && 'value' in current) row.default = current.value;
      return row;
    })
    .filter((v) => v.name !== '');

  const rowCount = flat.filter(({ panel }) => asString(panel.type) === 'row').length;

  // Stat-panel-only histograms — graphMode and colorMode are stat-panel
  // options (`options.graphMode`, `options.colorMode`). Other panel types
  // (timeseries' `fieldConfig.defaults.custom.drawStyle`, gauge's
  // `options.showThresholdLabels`, table's `options.cellHeight`) also
  // have mode-ish fields, but stat is surfaced first because graphMode
  // swings the panel's visual identity hardest — area sparkline vs. flat
  // number is the difference between a KPI-with-trend dashboard and a
  // flat-KPI one, which is the original misgrade case from issue #31.
  // Extend per panel type as need is shown.
  const statGraphModes: Record<string, number> = {};
  const statColorModes: Record<string, number> = {};
  for (const { panel } of flat) {
    if (asString(panel.type) !== 'stat') continue;
    const options = asDict(panel.options);
    if (!options) continue;
    const graphMode = asString(options.graphMode);
    if (graphMode !== undefined) {
      statGraphModes[graphMode] = (statGraphModes[graphMode] ?? 0) + 1;
    }
    const colorMode = asString(options.colorMode);
    if (colorMode !== undefined) {
      statColorModes[colorMode] = (statColorModes[colorMode] ?? 0) + 1;
    }
  }

  return {
    detail: 'conventions',
    panelSizeHistogram: sizeHistogram,
    topUnits,
    topPanelTypes,
    variables,
    rowCount,
    statGraphModes,
    statColorModes,
  };
}

export function inspectDashboard(
  dashboard: unknown,
  options: InspectDashboardOptions = {},
): InspectResult {
  const dash = asDict(dashboard) ?? {};
  switch (options.detail ?? 'summary') {
    case 'panels':
      return listPanels(dash);
    case 'conventions':
      return extractConventions(dash);
    case 'summary':
    default:
      return summarize(dash);
  }
}
