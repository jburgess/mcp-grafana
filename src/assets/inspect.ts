export type InspectDetail = 'summary' | 'panels' | 'conventions';

export interface InspectDashboardOptions {
  detail?: InspectDetail | undefined;
}

export interface NamingPattern {
  prefix: string;
  count: number;
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

function panelDatasource(panel: Dict): string | undefined {
  const ds = panel.datasource;
  if (typeof ds === 'string') return ds;
  const dsObj = asDict(ds);
  return asString(dsObj?.uid);
}

function panelUnit(panel: Dict): string | undefined {
  return asString(asDict(asDict(panel.fieldConfig)?.defaults)?.unit);
}

function panelGridPos(panel: Dict): { x: number; y: number; w: number; h: number } | undefined {
  const g = asDict(panel.gridPos);
  if (!g) return undefined;
  const x = asNumber(g.x);
  const y = asNumber(g.y);
  const w = asNumber(g.w);
  const h = asNumber(g.h);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x, y, w, h };
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

function summarize(dashboard: Dict): DashboardSummary {
  const panels = asArray(dashboard.panels).map(asDict).filter((p): p is Dict => p !== undefined);
  const variables = asArray(asDict(dashboard.templating)?.list)
    .map(asDict)
    .filter((v): v is Dict => v !== undefined);

  const datasourceRefs = Array.from(
    new Set(panels.map(panelDatasource).filter((d): d is string => d !== undefined)),
  ).sort();

  let maxRight = 0;
  let maxBottom = 0;
  for (const panel of panels) {
    const g = panelGridPos(panel);
    if (!g) continue;
    maxRight = Math.max(maxRight, g.x + g.w);
    maxBottom = Math.max(maxBottom, g.y + g.h);
  }

  const panelsMissingDescription = panels.filter(
    (p) => p.type !== 'row' && asString(p.description) === undefined,
  ).length;

  const titles = panels
    .map((p) => asString(p.title))
    .filter((t): t is string => t !== undefined);

  const summary: DashboardSummary = {
    detail: 'summary',
    panelCount: panels.length,
    variableNames: variables
      .map((v) => asString(v.name))
      .filter((n): n is string => n !== undefined),
    datasourceRefs,
    layoutBounds: { width: maxRight, height: maxBottom },
    panelsMissingDescription,
    namingPatterns: detectNamingPatterns(titles),
  };
  const title = asString(dashboard.title);
  if (title !== undefined) summary.title = title;
  const uid = asString(dashboard.uid);
  if (uid !== undefined) summary.uid = uid;
  return summary;
}

function listPanels(dashboard: Dict): DashboardPanels {
  const panels = asArray(dashboard.panels)
    .map(asDict)
    .filter((p): p is Dict => p !== undefined)
    .map<PanelRow>((p) => {
      const id = (asNumber(p.id) ?? asString(p.id)) as number | string | undefined;
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
      return row;
    });
  return { detail: 'panels', panels };
}

function extractConventions(dashboard: Dict): DashboardConventions {
  const panels = asArray(dashboard.panels).map(asDict).filter((p): p is Dict => p !== undefined);

  const sizeHistogram: Record<string, number> = {};
  for (const panel of panels) {
    const g = panelGridPos(panel);
    if (!g) continue;
    const key = `${g.w}x${g.h}`;
    sizeHistogram[key] = (sizeHistogram[key] ?? 0) + 1;
  }

  const units = panels.map(panelUnit).filter((u): u is string => u !== undefined);
  const topUnits = topByCount(units).map(({ value, count }) => ({ unit: value, count }));

  const types = panels.map((p) => asString(p.type)).filter((t): t is string => t !== undefined);
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

  const rowCount = panels.filter((p) => asString(p.type) === 'row').length;

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
