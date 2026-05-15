import { DashboardBuilder } from '@grafana/grafana-foundation-sdk/dashboard';
import type * as dashboard from '@grafana/grafana-foundation-sdk/dashboard';

export interface BuildDashboardInput {
  title: string;
}

export function buildDashboard(input: BuildDashboardInput): dashboard.Dashboard {
  return new DashboardBuilder(input.title).build();
}
