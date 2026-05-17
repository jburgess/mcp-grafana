import { RowBuilder } from '@grafana/grafana-foundation-sdk/dashboard';
import { PanelBuilder } from '@grafana/grafana-foundation-sdk/timeseries';
import { DataqueryBuilder } from '@grafana/grafana-foundation-sdk/prometheus';
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
