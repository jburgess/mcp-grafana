import { DashboardBuilder } from '@grafana/grafana-foundation-sdk/dashboard';
import type * as cog from '@grafana/grafana-foundation-sdk/cog';
import type * as dashboard from '@grafana/grafana-foundation-sdk/dashboard';

export type PanelInput = cog.Builder<dashboard.Panel> | dashboard.Panel;

export interface BuildDashboardInput {
  title: string;
  panels?: PanelInput[] | undefined;
}

function toPanelBuilder(input: PanelInput): cog.Builder<dashboard.Panel> {
  if (typeof (input as cog.Builder<dashboard.Panel>).build === 'function') {
    return input as cog.Builder<dashboard.Panel>;
  }
  const panel = input as dashboard.Panel;
  return { build: () => panel };
}

export function buildDashboard(input: BuildDashboardInput): dashboard.Dashboard {
  const builder = new DashboardBuilder(input.title);
  for (const panel of input.panels ?? []) {
    builder.withPanel(toPanelBuilder(panel));
  }
  return builder.build();
}
