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
