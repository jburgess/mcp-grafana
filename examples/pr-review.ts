/**
 * Example: review a dashboard change — turn two dashboard JSONs into a
 * risk-ordered changelist.
 *
 * Runnable demonstration of `docs/guidance/pr-review.md` (served at
 * `mcp://grafana/docs/guidance/pr-review.md`). The flow:
 *
 *   diffDashboards(base, head)           ← deterministic facts (the tool)
 *     → triage by risk: removals / datasource / query first  (the judgement)
 *     → emit a risk-ordered changelist
 *
 * IMPORTANT: the risk ordering in `triage()` is ONE worked application of
 * the recipe — the way an LLM reading the guidance would order the facts.
 * It is NOT a general `risk()` function, and `grafana_dashboard_diff`
 * emits no verdict of its own: deciding a datasource swap outranks a
 * description edit is judgement that lives in the markdown the model reads,
 * not in code (AGENTS.md §1.8). This file exists so CI proves the diff
 * primitive surfaces the changes the recipe triages.
 */

import { diffDashboards, type DashboardDiff, type PanelChange } from '../src/index.js';

// The "before" dashboard.
export const BASE: Record<string, unknown> = {
  title: 'API service',
  uid: 'api-dash',
  tags: ['api', 'prod'],
  templating: { list: [{ name: 'datasource' }, { name: 'region' }] },
  panels: [
    {
      id: 1,
      type: 'timeseries',
      title: 'Request rate',
      fieldConfig: { defaults: { unit: 'reqps' } },
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      datasource: { uid: 'prom' },
      targets: [{ refId: 'A', expr: 'rate(http_requests_total[5m])' }],
    },
    {
      id: 2,
      type: 'stat',
      title: 'Error ratio',
      description: 'Fraction of 5xx responses.',
      fieldConfig: { defaults: { unit: 'percentunit' } },
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
      datasource: { uid: 'prom' },
      targets: [{ refId: 'A', expr: 'sum(rate(errors_total[5m])) / sum(rate(http_requests_total[5m]))' }],
    },
    {
      id: 3,
      type: 'timeseries',
      title: 'Latency p99',
      fieldConfig: { defaults: { unit: 's' } },
      gridPos: { x: 0, y: 8, w: 12, h: 8 },
      datasource: { uid: 'prom' },
      targets: [{ refId: 'A', expr: 'histogram_quantile(0.99, rate(latency_bucket[5m]))' }],
    },
  ],
};

// The "after" dashboard, with a planted change at every risk tier:
//  - panel 3 (Latency p99) REMOVED        → highest risk
//  - panel 2 datasource prom → mimir       → datasource swap
//  - panel 1 query 5m → 1h window          → query rewrite
//  - panel 1 unit reqps → cps              → unit change
//  - a new panel added                     → new surface
//  - uid changed                           → breaks external links
export const HEAD: Record<string, unknown> = {
  title: 'API service',
  uid: 'api-dash-v2',
  tags: ['api', 'prod'],
  templating: { list: [{ name: 'datasource' }, { name: 'region' }] },
  panels: [
    {
      id: 1,
      type: 'timeseries',
      title: 'Request rate',
      fieldConfig: { defaults: { unit: 'cps' } },
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      datasource: { uid: 'prom' },
      targets: [{ refId: 'A', expr: 'rate(http_requests_total[1h])' }],
    },
    {
      id: 2,
      type: 'stat',
      title: 'Error ratio',
      description: 'Fraction of 5xx responses.',
      fieldConfig: { defaults: { unit: 'percentunit' } },
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
      datasource: { uid: 'mimir' },
      targets: [{ refId: 'A', expr: 'sum(rate(errors_total[5m])) / sum(rate(http_requests_total[5m]))' }],
    },
    {
      id: 4,
      type: 'gauge',
      title: 'Saturation',
      fieldConfig: { defaults: { unit: 'percent' } },
      gridPos: { x: 0, y: 8, w: 12, h: 8 },
      datasource: { uid: 'prom' },
      targets: [{ refId: 'A', expr: 'cpu_utilization' }],
    },
  ],
};

export interface ReviewItem {
  tier: number;
  kind: string;
  panel?: string;
  detail: string;
}

// One worked triage of the diff facts into a risk-ordered changelist —
// the ordering the recipe's prose prescribes (removals → datasource →
// query → unit → type → additions → layout → cosmetic).
export function triage(diff: DashboardDiff): ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const p of diff.panelsRemoved) {
    items.push({ tier: 1, kind: 'panel-removed', ...(p.title !== undefined ? { panel: p.title } : {}), detail: 'signal deleted — intended?' });
  }

  const fieldTier: Record<string, { tier: number; kind: string }> = {
    datasource: { tier: 2, kind: 'datasource-swap' },
    targets: { tier: 3, kind: 'query-rewrite' },
    unit: { tier: 4, kind: 'unit-change' },
    type: { tier: 5, kind: 'type-change' },
  };
  for (const pc of diff.panelsChanged) {
    for (const ch of pc.changes) {
      const t = fieldTier[ch.field];
      if (!t) continue; // gridPos / rowId / description / title handled below
      items.push({
        tier: t.tier,
        kind: t.kind,
        ...(pc.title !== undefined ? { panel: pc.title } : {}),
        detail: `${ch.field}: ${JSON.stringify(ch.before)} → ${JSON.stringify(ch.after)}`,
      });
    }
  }

  for (const p of diff.panelsAdded) {
    items.push({ tier: 6, kind: 'panel-added', ...(p.title !== undefined ? { panel: p.title } : {}), detail: 'new surface — run the audit pass' });
  }

  // Layout-only churn and cosmetic edits, lowest priority.
  for (const pc of diff.panelsChanged) {
    if (pc.changes.some((c) => c.field === 'gridPos' || c.field === 'rowId')) {
      items.push({ tier: 7, kind: 'layout', ...(pc.title !== undefined ? { panel: pc.title } : {}), detail: 'moved/resized' });
    }
  }

  for (const dc of diff.dashboardChanges) {
    const tier = dc.field === 'uid' || dc.field === 'variableNames' ? 2 : 8;
    items.push({ tier, kind: `dashboard-${dc.field}`, detail: `${JSON.stringify(dc.before)} → ${JSON.stringify(dc.after)}` });
  }

  return items.sort((a, b) => a.tier - b.tier);
}

export interface ReviewResult {
  diff: DashboardDiff;
  changelist: ReviewItem[];
}

export function main(): ReviewResult {
  const diff = diffDashboards(BASE, HEAD);
  return { diff, changelist: triage(diff) };
}

// Re-export for the test's convenience.
export type { PanelChange };
