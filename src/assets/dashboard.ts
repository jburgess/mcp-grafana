import { DashboardBuilder } from '@grafana/grafana-foundation-sdk/dashboard';
import type * as cog from '@grafana/grafana-foundation-sdk/cog';
import type * as dashboard from '@grafana/grafana-foundation-sdk/dashboard';

export interface BuildDashboardInput {
  title: string;
  panels?: cog.Builder<dashboard.Panel>[];
}

export function buildDashboard(input: BuildDashboardInput): dashboard.Dashboard {
  const builder = new DashboardBuilder(input.title);
  for (const panel of input.panels ?? []) {
    builder.withPanel(panel);
  }
  return builder.build();
}
