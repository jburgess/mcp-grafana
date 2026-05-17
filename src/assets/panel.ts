import { ReduceDataOptionsBuilder } from '@grafana/grafana-foundation-sdk/common';
import { RowBuilder } from '@grafana/grafana-foundation-sdk/dashboard';
import { DataqueryBuilder } from '@grafana/grafana-foundation-sdk/prometheus';
import { PanelBuilder as StatPanelBuilder } from '@grafana/grafana-foundation-sdk/stat';
import { PanelBuilder as StateTimelinePanelBuilder } from '@grafana/grafana-foundation-sdk/statetimeline';
import { PanelBuilder as TablePanelBuilder } from '@grafana/grafana-foundation-sdk/table';
import { PanelBuilder } from '@grafana/grafana-foundation-sdk/timeseries';
import type * as common from '@grafana/grafana-foundation-sdk/common';
import type * as dashboard from '@grafana/grafana-foundation-sdk/dashboard';

export interface PromqlTarget {
  expr: string;
  legendFormat?: string | undefined;
  refId?: string | undefined;
}

export interface BuildTimeseriesPanelInput {
  title: string;
  description?: string | undefined;
  targets: PromqlTarget[];
  unit?: string | undefined;
}

export function buildTimeseriesPanel(input: BuildTimeseriesPanelInput): dashboard.Panel {
  const builder = new PanelBuilder().title(input.title);
  if (input.description !== undefined) builder.description(input.description);
  if (input.unit !== undefined) builder.unit(input.unit);

  for (const target of input.targets) {
    const t = new DataqueryBuilder().expr(target.expr);
    if (target.legendFormat !== undefined) t.legendFormat(target.legendFormat);
    if (target.refId !== undefined) t.refId(target.refId);
    builder.withTarget(t);
  }

  return builder.build();
}

/**
 * Input shape for {@link buildRowPanel}. Minimal by design — only the
 * two fields a section-header LLM would set. Other RowBuilder options
 * (datasource, gridPos, id, repeat, withPanel for build-time row–child
 * association) are deliberately out of scope: gridPos is auto-assigned
 * by `buildDashboard`, id is auto-assigned by the same pass, and
 * row–child grouping is decided by panel order in the dashboard's
 * `panels[]` array (modern Grafana row format).
 */
export interface BuildRowPanelInput {
  /** Title shown on the collapsible section header. */
  title: string;
  /**
   * When true, the row starts collapsed (children hidden until the user
   * expands the section). Omit for the SDK default (false / expanded).
   */
  collapsed?: boolean | undefined;
}

/**
 * Builds a Grafana row panel (`"type": "row"`) — the collapsible section
 * header used to group panels into named segments. Rows carry no query
 * targets; they are structural, not data visualisations. Using a regular
 * panel as a stand-in produces wrong JSON and defeats Grafana's
 * collapsible-section feature.
 *
 * Pass the result to `buildDashboard`'s `panels` array; `buildDashboard`
 * routes row-shaped inputs through the SDK's `withRow` (correct row
 * layout) rather than `withPanel` (which would assign panel-shaped
 * gridPos to the row).
 */
export function buildRowPanel(input: BuildRowPanelInput): dashboard.RowPanel {
  const builder = new RowBuilder(input.title);
  if (input.collapsed !== undefined) builder.collapsed(input.collapsed);
  return builder.build();
}

/**
 * Sparkline mode for stat panels — the deterministic comparison signal
 * the `panels.stat.requiresComparison` lint rule (`src/assets/lint.ts`)
 * keys on. Mirrors `common.BigValueGraphMode`'s value set.
 */
export type StatGraphMode = 'area' | 'line' | 'none';

/**
 * Input shape for {@link buildStatPanel}. `graphMode` defaults to
 * `'area'` per the project's `panels.stat.requiresComparison` style
 * rule — a stat panel without a comparison signal is the "aggregate ≠
 * summary" anti-pattern (Tufte's *service-engine-soon* critique).
 * Callers who genuinely want a bare KPI must explicitly opt out via
 * `graphMode: 'none'`.
 */
export interface BuildStatPanelInput {
  /** Panel title shown above the stat. */
  title: string;
  /** Panel description shown in the info tooltip. */
  description?: string | undefined;
  /** One or more query targets — typically a single reduced expression. */
  targets: PromqlTarget[];
  /** Display unit code (e.g. `'percentunit'`, `'reqps'`, `'bytes'`). */
  unit?: string | undefined;
  /**
   * Sparkline render mode. Defaults to `'area'` (filled sparkline) when
   * omitted, satisfying `panels.stat.requiresComparison` without the
   * caller having to think about it. Pass `'none'` to explicitly drop
   * the sparkline (the linter will then flag it; that is intended).
   */
  graphMode?: StatGraphMode | undefined;
  /**
   * Reduction calculation applied to each series before display
   * (e.g. `'lastNotNull'`, `'mean'`, `'max'`). Defaults to
   * `'lastNotNull'` — Grafana's own canonical stat-panel default and
   * the right choice for current-state KPI reads. The Foundation
   * SDK's raw default is `calcs: []`, which renders no value; we set
   * `'lastNotNull'` so a freshly-built stat panel actually displays a
   * number without the caller having to think about it.
   */
  reduceCalc?: string | undefined;
}

/**
 * Builds a Grafana stat panel (`"type": "stat"`) for single-value KPI
 * displays — current error rate, SLO status, active alerts count.
 * Pairs with the `panels.stat.requiresComparison` lint rule: the
 * default `graphMode: 'area'` keeps every freshly-built stat panel
 * compliant out of the box.
 */
export function buildStatPanel(input: BuildStatPanelInput): dashboard.Panel {
  const builder = new StatPanelBuilder().title(input.title);
  if (input.description !== undefined) builder.description(input.description);
  if (input.unit !== undefined) builder.unit(input.unit);

  const graphMode: StatGraphMode = input.graphMode ?? 'area';
  // `as common.BigValueGraphMode`: StatGraphMode is structurally exhaustive
  // against the SDK's BigValueGraphMode enum (verified against
  // common/types.gen.d.ts: None | Line | Area). The local literal type
  // keeps the SDK enum off the public API surface.
  builder.graphMode(graphMode as common.BigValueGraphMode);

  // Defaults to 'lastNotNull' (Grafana's stat-panel canonical default)
  // when omitted — the SDK's raw default is `calcs: []` which renders
  // no value. Spelled out so a freshly-built stat panel displays a
  // number without the caller having to think about it.
  const reduceCalc = input.reduceCalc ?? 'lastNotNull';
  builder.reduceOptions(new ReduceDataOptionsBuilder().calcs([reduceCalc]));

  for (const target of input.targets) {
    const t = new DataqueryBuilder().expr(target.expr);
    if (target.legendFormat !== undefined) t.legendFormat(target.legendFormat);
    if (target.refId !== undefined) t.refId(target.refId);
    builder.withTarget(t);
  }

  return builder.build();
}

/**
 * Input shape for {@link buildTablePanel}. Minimal by design — most of
 * a table panel's column configuration comes from the query shape and
 * Grafana transformations, not from the builder. Column overrides
 * (`sortBy`, `footer`, `cellHeight`, `displayMode`, `cellOptions`),
 * thresholds, and per-column color/unit are deliberately out of scope
 * (apply via `grafana_dashboard_panel_update` if needed).
 */
export interface BuildTablePanelInput {
  /** Panel title shown above the table. */
  title: string;
  /** Panel description shown in the info tooltip. */
  description?: string | undefined;
  /** One or more query targets — typically a single ranked or enumerated expression. */
  targets: PromqlTarget[];
  /** Display unit code for numeric columns (e.g. `'short'`, `'reqps'`, `'bytes'`). */
  unit?: string | undefined;
  /**
   * When true, enables per-column filter UI in the table header (the
   * little funnel icon). Useful for service-inventory or top-N tables
   * where the operator wants to slice the rows live. Omit to leave at
   * the SDK default (no filter UI).
   */
  filterable?: boolean | undefined;
}

/**
 * Builds a Grafana table panel (`"type": "table"`) — the standard
 * visualisation for ranked or enumerated data (top-N endpoints by
 * latency, per-service error counts, service inventory). Column
 * configuration is mostly driven by the query shape and Grafana
 * transformations; this builder exposes the small set of panel-level
 * options that vary across most table use cases.
 */
export function buildTablePanel(input: BuildTablePanelInput): dashboard.Panel {
  const builder = new TablePanelBuilder().title(input.title);
  if (input.description !== undefined) builder.description(input.description);
  if (input.unit !== undefined) builder.unit(input.unit);
  if (input.filterable !== undefined) builder.filterable(input.filterable);

  for (const target of input.targets) {
    const t = new DataqueryBuilder().expr(target.expr);
    if (target.legendFormat !== undefined) t.legendFormat(target.legendFormat);
    if (target.refId !== undefined) t.refId(target.refId);
    builder.withTarget(t);
  }

  return builder.build();
}

/**
 * Input shape for {@link buildStateTimelinePanel}. Minimal by design —
 * the SDK's `showValue`, `alignValue`, `fillOpacity`, `lineWidth`,
 * `spanNulls`, `legend`, and `tooltip` options are deliberately out of
 * scope here (apply via `grafana_dashboard_panel_update` if needed).
 * Non-Prometheus datasources also out of scope, matching the other
 * panel builders.
 */
export interface BuildStateTimelinePanelInput {
  /** Panel title shown above the timeline. */
  title: string;
  /** Panel description shown in the info tooltip. */
  description?: string | undefined;
  /** One or more query targets — typically categorical status signals. */
  targets: PromqlTarget[];
  /**
   * When true, contiguous samples carrying the same value are merged
   * into one band (one wide UP segment, not 30 one-minute UP segments).
   * Useful for sparse-event status signals. Omit to leave at the SDK
   * default (typically true for state-timeline).
   */
  mergeValues?: boolean | undefined;
  /**
   * Row height as a fraction of the lane (0..1). Smaller values stack
   * more service rows in less vertical space; useful for overview
   * dashboards with many services.
   */
  rowHeight?: number | undefined;
}

/**
 * Builds a Grafana state-timeline panel (`"type": "state-timeline"`)
 * for categorical health / status signals across a time window —
 * UP/DOWN/DEGRADED, OK/WARNING/CRITICAL. Shows discrete state
 * transitions as coloured bands.
 *
 * Use this distinct from {@link buildTimeseriesPanel}: timeseries
 * applies numerical interpolation and continuous axes to data that
 * is inherently discrete and non-numerical — a fidelity loss for
 * categorical health signals. State-timeline is the correct
 * visualisation for the discrete case.
 */
export function buildStateTimelinePanel(
  input: BuildStateTimelinePanelInput,
): dashboard.Panel {
  const builder = new StateTimelinePanelBuilder().title(input.title);
  if (input.description !== undefined) builder.description(input.description);
  if (input.mergeValues !== undefined) builder.mergeValues(input.mergeValues);
  if (input.rowHeight !== undefined) builder.rowHeight(input.rowHeight);

  for (const target of input.targets) {
    const t = new DataqueryBuilder().expr(target.expr);
    if (target.legendFormat !== undefined) t.legendFormat(target.legendFormat);
    if (target.refId !== undefined) t.refId(target.refId);
    builder.withTarget(t);
  }

  return builder.build();
}
