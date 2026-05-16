export { buildDashboard } from './assets/dashboard.js';
export type { BuildDashboardInput, PanelInput } from './assets/dashboard.js';

export { buildTimeseriesPanel } from './assets/panel.js';
export type { BuildTimeseriesPanelInput, PromqlTarget } from './assets/panel.js';

export { inspectDashboard } from './assets/inspect.js';
export type {
  InspectDetail,
  InspectDashboardOptions,
  InspectResult,
  DashboardSummary,
  DashboardPanels,
  DashboardConventions,
  PanelRow,
  RowSummary,
  VariableRow,
  NamingPattern,
} from './assets/inspect.js';
