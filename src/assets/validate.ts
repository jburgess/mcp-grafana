/**
 * Validation primitives for Grafana dashboards and panels. Returns
 * model-friendly error lists rather than throwing — the consuming LLM tool
 * call should not fail when validation finds issues; the *issues* are the
 * useful output.
 *
 * Scope of v0.1.x validation:
 *  - Schema: dashboard.title required; per-panel id required; gridPos
 *    well-formed if present.
 *  - Reference integrity: panel ids unique across the whole dashboard
 *    (including row-nested panels); panel-query and panel-datasource
 *    variable refs resolve against the dashboard's declared variables
 *    (with Grafana built-ins like $__rate_interval allowed).
 *
 * Out of scope (deferred): full Grafana JSON-schema validation, datasource
 * uid existence (datasources are deployment-level, not declared on the
 * dashboard), panel-type-specific field shape.
 */

export interface ValidationError {
  /** JSONPath-like locator, e.g. "panels[2].targets[0].expr". Single panels use "$". */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** True if errors[] was capped at MAX_ERRORS; caller knows more issues exist. */
  truncated?: boolean;
}

const MAX_ERRORS = 100;

// Any Grafana built-in starts with `__` (e.g. __interval, __rate_interval,
// __from, __to, __dashboard, __user, __org, __searchFilter, __all_variables,
// __field, __series, __value, __cell_N, …). Plus the legacy non-underscored
// timeFilter. Using a prefix rule keeps us forward-compatible as Grafana
// adds new built-ins.
const LEGACY_BUILTIN_VARIABLES = new Set<string>(['timeFilter']);

function isBuiltinVariable(name: string): boolean {
  return name.startsWith('__') || LEGACY_BUILTIN_VARIABLES.has(name);
}

// Grafana variable syntaxes:
//   $name              — bare
//   ${name}            — braced
//   ${name:format}     — braced with format (csv, regex, …)
//   [[name]]           — legacy
// Capture groups: 1=braced, 2=bare, 3=legacy. Exactly one is populated per match.
const VAR_RE = /\$\{([^}:]+)(?::[^}]*)?\}|\$([a-zA-Z_][a-zA-Z0-9_]*)|\[\[([^\]]+)\]\]/g;

function extractVariableRefs(text: string): string[] {
  const refs: string[] = [];
  VAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VAR_RE.exec(text)) !== null) {
    const name = m[1] ?? m[2] ?? m[3];
    if (name) refs.push(name);
  }
  return refs;
}

import { type Dict, asArray, asDict, asNumber, asString, panelId } from './_internal.js';

interface WalkedPanel {
  panel: Dict;
  path: string;
}

// Walks the dashboard's panel tree (top-level + legacy row.panels[]) yielding
// each panel with a JSONPath-style locator. Independent of inspect.ts's
// flattenPanels because validate needs paths and inspect doesn't.
function* walkPanels(dashboard: Dict): Generator<WalkedPanel> {
  const topPanels = asArray(dashboard.panels);
  for (let i = 0; i < topPanels.length; i++) {
    const panel = asDict(topPanels[i]);
    if (!panel) continue;
    const topPath = `panels[${i}]`;
    yield { panel, path: topPath };

    if (asString(panel.type) === 'row') {
      const nested = asArray(panel.panels);
      for (let j = 0; j < nested.length; j++) {
        const nestedPanel = asDict(nested[j]);
        if (!nestedPanel) continue;
        yield { panel: nestedPanel, path: `${topPath}.panels[${j}]` };
      }
    }
  }
}

function collectDeclaredVariables(dashboard: Dict): Set<string> {
  const declared = new Set<string>();
  for (const v of asArray(asDict(dashboard.templating)?.list)) {
    const name = asString(asDict(v)?.name);
    if (name) declared.add(name);
  }
  return declared;
}

function checkPanelSchema(panel: Dict, path: string, errors: ValidationError[]): void {
  if (panelId(panel) === undefined) {
    errors.push({
      path: `${path}.id`,
      message: 'panel is missing required field "id"',
    });
  }

  const g = panel.gridPos;
  if (g !== undefined) {
    const gd = asDict(g);
    if (!gd) {
      errors.push({
        path: `${path}.gridPos`,
        message: 'gridPos must be an object with numeric x, y, w, h',
      });
    } else {
      for (const field of ['x', 'y', 'w', 'h'] as const) {
        if (asNumber(gd[field]) === undefined) {
          errors.push({
            path: `${path}.gridPos.${field}`,
            message: `gridPos.${field} must be a number`,
          });
        }
      }
    }
  }
}

function checkPanelVariableRefs(
  panel: Dict,
  path: string,
  declared: Set<string>,
  errors: ValidationError[],
): void {
  // Datasource ref (string form or object.uid form)
  const ds = panel.datasource;
  const dsRef = typeof ds === 'string' ? ds : asString(asDict(ds)?.uid);
  if (dsRef !== undefined) {
    for (const ref of extractVariableRefs(dsRef)) {
      if (!isBuiltinVariable(ref) && !declared.has(ref)) {
        errors.push({
          path: `${path}.datasource`,
          message: `references unknown variable $${ref}`,
        });
      }
    }
  }

  // Target queries. Supports the common datasource fields: expr (Prometheus),
  // query (Loki / Elastic / generic), rawQuery (SQL).
  const targets = asArray(panel.targets);
  for (let i = 0; i < targets.length; i++) {
    const target = asDict(targets[i]);
    if (!target) continue;
    for (const field of ['expr', 'query', 'rawQuery'] as const) {
      const value = asString(target[field]);
      if (!value) continue;
      for (const ref of extractVariableRefs(value)) {
        if (!isBuiltinVariable(ref) && !declared.has(ref)) {
          errors.push({
            path: `${path}.targets[${i}].${field}`,
            message: `references unknown variable $${ref}`,
          });
        }
      }
    }
  }
}

function capErrors(errors: ValidationError[]): ValidationResult {
  if (errors.length > MAX_ERRORS) {
    return {
      valid: false,
      errors: errors.slice(0, MAX_ERRORS),
      truncated: true,
    };
  }
  return { valid: errors.length === 0, errors };
}

export function validateDashboard(dashboard: unknown): ValidationResult {
  const dash = asDict(dashboard);
  if (!dash) {
    return {
      valid: false,
      errors: [{ path: '$', message: 'dashboard must be an object' }],
    };
  }

  const errors: ValidationError[] = [];

  if (asString(dash.title) === undefined) {
    errors.push({
      path: 'title',
      message: 'dashboard is missing required field "title"',
    });
  }

  const declared = collectDeclaredVariables(dash);
  const idLocations = new Map<number | string, string[]>();

  for (const { panel, path } of walkPanels(dash)) {
    checkPanelSchema(panel, path, errors);
    checkPanelVariableRefs(panel, path, declared, errors);

    const id = panelId(panel);
    if (id !== undefined) {
      const existing = idLocations.get(id);
      if (existing) existing.push(path);
      else idLocations.set(id, [path]);
    }
  }

  for (const [id, paths] of idLocations) {
    if (paths.length < 2) continue;
    for (const p of paths) {
      const others = paths.filter((x) => x !== p).join(', ');
      errors.push({
        path: `${p}.id`,
        message: `duplicate panel id ${id} (also at ${others})`,
      });
    }
  }

  return capErrors(errors);
}

export function validatePanel(panel: unknown, dashboard?: unknown): ValidationResult {
  const p = asDict(panel);
  if (!p) {
    return {
      valid: false,
      errors: [{ path: '$', message: 'panel must be an object' }],
    };
  }

  const errors: ValidationError[] = [];
  checkPanelSchema(p, '$', errors);

  if (dashboard !== undefined) {
    const dash = asDict(dashboard);
    if (dash) {
      const declared = collectDeclaredVariables(dash);
      checkPanelVariableRefs(p, '$', declared, errors);
    }
  }

  return capErrors(errors);
}
