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
    ({ panel }) => asString(panel.type) !== 'row' && asString(panel.description) === undefined,
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
    const description = asString(p.description);
    if (description !== undefined) row.description = description;
    const unit = panelUnit(p);
    if (unit !== undefined) row.unit = unit;
    const gridPos = panelGridPos(p);
    if (gridPos !== undefined) row.gridPos = gridPos;
    const datasource = panelDatasource(p);
    if (datasource !== undefined) row.datasource = datasource;
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

  return {
    detail: 'conventions',
    panelSizeHistogram: sizeHistogram,
    topUnits,
    topPanelTypes,
    variables,
    rowCount,
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
