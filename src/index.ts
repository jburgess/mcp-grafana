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

export { validateDashboard, validatePanel } from './assets/validate.js';
export type { ValidationError, ValidationResult } from './assets/validate.js';

export { insertPanel } from './assets/insert.js';
export type { InsertPosition, InsertResult } from './assets/insert.js';

export { updatePanel } from './assets/update.js';
export type { UpdateResult } from './assets/update.js';
