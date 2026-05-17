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
  PanelTarget,
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

export { movePanel } from './assets/move.js';
export type { MoveResult } from './assets/move.js';

export { removePanel } from './assets/remove.js';
export type { RemoveResult } from './assets/remove.js';

export { renameVariable } from './assets/rename.js';
export type { RenameVariableResult } from './assets/rename.js';

export { lintPanel, lintDashboard } from './assets/lint.js';
export type {
  GrafanaStyleGuide,
  PanelStyleGuide,
  DashboardStyleGuide,
  TimeseriesPanelStyle,
  TimeseriesLegendStyle,
  UnitStyleGuide,
  DescriptionStyleGuide,
  LintIssue,
  LintResult,
} from './assets/lint.js';
