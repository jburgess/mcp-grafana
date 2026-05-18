/**
 * Atomic, escape-safe rename of a templating variable across a dashboard.
 *
 * The bug this prevents (cited in issue #31 item 2): the shell-out workflow
 * "iterate variables, run sed on every panel" turned the regex `\$` into a
 * mangled escape, silently breaking 75 expressions while the templating
 * list said "done". Only `validateDashboard` caught the dangling refs.
 *
 * A first-class rename primitive sidesteps the entire class of shell-escape
 * bugs by walking the dashboard's known reference sites and rewriting each
 * with a JS-side regex that knows the four Grafana interpolation syntaxes:
 *
 *   $name              — bare
 *   ${name}            — braced
 *   ${name:format}     — braced with format (csv, regex, …)
 *   [[name]]           — legacy
 *   [[name:csv]]       — legacy with format
 *
 * Reference sites covered:
 *   - templating.list[i].name — the variable definition itself
 *   - templating.list[i].label — when label exactly equals oldName
 *   - templating.list[i].definition — interpolation in another variable's def
 *   - templating.list[i].query — string form, { query: string } shape, or
 *     { query: string, datasource: {uid} } where the datasource may itself
 *     interpolate the variable being renamed
 *   - templating.list[i].current.text / .current.value — the variable's
 *     persisted default selection, which can reference another variable
 *   - panel datasource — string form ("$ds") or { uid } object
 *   - panel title / description — interpolation
 *   - panel targets[j].expr / .query / .rawQuery — primary query fields
 *   - panel targets[j].datasource — per-target datasource override
 *   - panel.repeat / row.repeat — names a variable to iterate over
 *   - Legacy row.panels[] — recursively walked
 *
 * Not covered (deferred — flagged in MCP tool description so the LLM
 * sees the boundary at call time):
 *   - dashboard.annotations.list[i].* — annotation query expressions
 *   - dashboard.links[i].url / panel.links[i].url — dashboard/panel link URLs
 *   - templating.list[i].regex — variable post-process regex
 *   - templating.list[i].options[] — static option lists on custom variables
 *   - panel.transformations[i].options.* — transformation options can
 *     interpolate variables
 *   - panel.fieldConfig.overrides[i].matcher / .properties[] — override
 *     matchers and properties
 * These are less common in real dashboards; add when a captured fixture
 * proves the need. validateDashboard will catch dangling refs in
 * `expr`/`query`/`rawQuery`/`datasource` after a rename, which covers the
 * highest-impact correctness cases.
 *
 * Immutability: input dashboard is never mutated. Result is a deep clone
 * with rewrites applied.
 *
 * Errors: returned in result.errors[] (model-friendly), not thrown. When
 * errors[] is non-empty, result.dashboard is undefined and no rewriting
 * occurred. Error path uses the same JSONPath convention as validate.ts.
 */

import type { ValidationError } from './validate.js';
import { type Dict, asArray, asDict, asString, deepClone } from './_internal.js';

export interface RenameVariableResult {
  /** Present on success; absent when errors[] is non-empty. */
  dashboard?: Dict;
  /** Empty on success; contains structural problems otherwise. */
  errors: ValidationError[];
  /** Number of textual rewrites made across the dashboard. Zero on a same-name no-op. */
  rewrites: number;
  /** JSONPath locations where rewrites occurred — for verification and audit. */
  locations: string[];
}

// Grafana variable name shape. Matches the rule embedded in validate.ts's VAR_RE.
const VARIABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Rewrites every interpolation form of `oldName` to `newName` in a single
// string. Preserves the syntactic form: ${old:csv} → ${new:csv}, [[old]] →
// [[new]], $old → $new. The lookahead on the bare form prevents $foo from
// matching inside $foobar.
function rewriteText(
  text: string,
  oldName: string,
  newName: string,
): { text: string; rewrites: number } {
  const escapedOld = escapeRegex(oldName);
  let rewrites = 0;
  let out = text;

  // ${oldName} or ${oldName:fmt}
  out = out.replace(
    new RegExp(`\\$\\{${escapedOld}(:[^}]*)?\\}`, 'g'),
    (_match: string, fmt: string | undefined) => {
      rewrites++;
      return `\${${newName}${fmt ?? ''}}`;
    },
  );

  // [[oldName]] or [[oldName:fmt]]
  out = out.replace(
    new RegExp(`\\[\\[${escapedOld}(:[^\\]]*)?\\]\\]`, 'g'),
    (_match: string, fmt: string | undefined) => {
      rewrites++;
      return `[[${newName}${fmt ?? ''}]]`;
    },
  );

  // $oldName (bare) — must NOT be followed by a name character. The
  // lookahead deliberately permits `:` (so `$foo:csv` rewrites — Grafana
  // doesn't accept that syntax in practice, but if it ever appears it's
  // still a reference to $foo, not $foo:csv).
  out = out.replace(new RegExp(`\\$${escapedOld}(?![a-zA-Z0-9_])`, 'g'), () => {
    rewrites++;
    return `$${newName}`;
  });

  return { text: out, rewrites };
}

// Rewrites a string-valued field on `obj` in place. If rewrites occurred,
// records the path in `locations`. Returns the rewrite count contributed.
function rewriteStringField(
  obj: Dict,
  field: string,
  oldName: string,
  newName: string,
  path: string,
  locations: string[],
): number {
  const current = asString(obj[field]);
  if (current === undefined) return 0;
  const r = rewriteText(current, oldName, newName);
  if (r.rewrites === 0) return 0;
  obj[field] = r.text;
  locations.push(path);
  return r.rewrites;
}

// Rewrites a datasource reference, which Grafana stores as either a bare
// string ("$ds") or an object { uid, type }. Returns the rewrite count.
function rewriteDatasource(
  parent: Dict,
  field: string,
  oldName: string,
  newName: string,
  path: string,
  locations: string[],
): number {
  const ds = parent[field];
  if (typeof ds === 'string') {
    const r = rewriteText(ds, oldName, newName);
    if (r.rewrites === 0) return 0;
    parent[field] = r.text;
    locations.push(path);
    return r.rewrites;
  }
  const dsObj = asDict(ds);
  if (!dsObj) return 0;
  return rewriteStringField(dsObj, 'uid', oldName, newName, `${path}.uid`, locations);
}

// Walks a panel and rewrites every known reference site. Recurses into
// legacy row.panels[]. Mutates `panel` in place (caller is operating on a
// deep clone) and appends locations.
function renameInPanel(
  panel: Dict,
  oldName: string,
  newName: string,
  path: string,
  locations: string[],
): number {
  let rewrites = 0;

  rewrites += rewriteStringField(panel, 'title', oldName, newName, `${path}.title`, locations);
  rewrites += rewriteStringField(
    panel,
    'description',
    oldName,
    newName,
    `${path}.description`,
    locations,
  );
  rewrites += rewriteDatasource(panel, 'datasource', oldName, newName, `${path}.datasource`, locations);

  // `repeat` names a variable to iterate over (exact match, not interpolation).
  if (asString(panel.repeat) === oldName) {
    panel.repeat = newName;
    rewrites += 1;
    locations.push(`${path}.repeat`);
  }

  const targets = asArray(panel.targets);
  for (let i = 0; i < targets.length; i++) {
    const target = asDict(targets[i]);
    if (!target) continue;
    const tPath = `${path}.targets[${i}]`;
    for (const field of ['expr', 'query', 'rawQuery'] as const) {
      rewrites += rewriteStringField(
        target,
        field,
        oldName,
        newName,
        `${tPath}.${field}`,
        locations,
      );
    }
    rewrites += rewriteDatasource(
      target,
      'datasource',
      oldName,
      newName,
      `${tPath}.datasource`,
      locations,
    );
  }

  // Legacy row format: walk nested panels.
  if (asString(panel.type) === 'row') {
    const nested = asArray(panel.panels);
    for (let i = 0; i < nested.length; i++) {
      const nestedPanel = asDict(nested[i]);
      if (!nestedPanel) continue;
      rewrites += renameInPanel(
        nestedPanel,
        oldName,
        newName,
        `${path}.panels[${i}]`,
        locations,
      );
    }
  }

  return rewrites;
}

export function renameVariable(
  dashboard: unknown,
  oldName: string,
  newName: string,
): RenameVariableResult {
  const dash = asDict(dashboard);
  if (!dash) {
    return {
      errors: [{ path: '$', message: 'dashboard must be an object', code: 'dashboard-not-object' }],
      rewrites: 0,
      locations: [],
    };
  }

  if (!VARIABLE_NAME_RE.test(newName)) {
    return {
      errors: [
        {
          path: 'templating.list',
          message: `"${newName}" is not a valid Grafana variable name (must match [a-zA-Z_][a-zA-Z0-9_]*)`,
          code: 'variable-name-invalid',
        },
      ],
      rewrites: 0,
      locations: [],
    };
  }

  const list = asArray(asDict(dash.templating)?.list);
  let oldIndex = -1;
  for (let i = 0; i < list.length; i++) {
    const v = asDict(list[i]);
    if (v && asString(v.name) === oldName) {
      oldIndex = i;
      break;
    }
  }
  if (oldIndex === -1) {
    return {
      errors: [
        {
          path: 'templating.list',
          message: `no variable named "${oldName}" is declared in templating.list`,
          code: 'variable-not-found',
        },
      ],
      rewrites: 0,
      locations: [],
    };
  }

  // No-op short-circuit. Avoid the rewrite work (which would still return
  // rewrites > 0 because the regex would match-and-replace with itself).
  // Deliberately ordered BEFORE the collision check below — renaming a
  // variable to its own name is a no-op regardless of any pre-existing
  // duplicate-name state in templating.list (which is the dashboard's
  // problem, not this tool's).
  if (oldName === newName) {
    return { dashboard: deepClone(dash), errors: [], rewrites: 0, locations: [] };
  }

  // Collision check: newName must not already exist as a *different* variable.
  for (let i = 0; i < list.length; i++) {
    if (i === oldIndex) continue;
    const v = asDict(list[i]);
    if (v && asString(v.name) === newName) {
      return {
        errors: [
          {
            path: 'templating.list',
            message: `cannot rename to "${newName}": a variable with that name already exists`,
            code: 'variable-name-collision',
          },
        ],
        rewrites: 0,
        locations: [],
      };
    }
  }

  // Perform the rename on a deep clone.
  const out = deepClone(dash);
  const locations: string[] = [];
  let rewrites = 0;

  const outList = asArray(asDict(out.templating)?.list);
  for (let i = 0; i < outList.length; i++) {
    const v = asDict(outList[i]);
    if (!v) continue;
    const vPath = `templating.list[${i}]`;
    if (i === oldIndex) {
      v.name = newName;
      rewrites += 1;
      locations.push(`${vPath}.name`);
      // Rename label only when it exactly matches oldName — labels are
      // human-facing and unrelated labels should be left alone.
      if (asString(v.label) === oldName) {
        v.label = newName;
        rewrites += 1;
        locations.push(`${vPath}.label`);
      }
    }
    // Rewrite any reference to oldName in this variable's own definition
    // and query (string OR { query: string } shape).
    rewrites += rewriteStringField(
      v,
      'definition',
      oldName,
      newName,
      `${vPath}.definition`,
      locations,
    );
    if (typeof v.query === 'string') {
      rewrites += rewriteStringField(v, 'query', oldName, newName, `${vPath}.query`, locations);
    } else {
      const qObj = asDict(v.query);
      if (qObj) {
        rewrites += rewriteStringField(
          qObj,
          'query',
          oldName,
          newName,
          `${vPath}.query.query`,
          locations,
        );
        // The nested query object can carry its own datasource that
        // interpolates the variable being renamed (e.g. `${ds}` in a
        // multi-datasource setup). Walk it the same way as panel.datasource.
        rewrites += rewriteDatasource(
          qObj,
          'datasource',
          oldName,
          newName,
          `${vPath}.query.datasource`,
          locations,
        );
      }
    }
    // `current` is the variable's persisted default selection. Both `text`
    // and `value` can carry a `$otherVar` interpolation (chained defaults).
    // Multi-select variables store arrays here; we only rewrite the string
    // form — the array form is rare and pulls in array-walk complexity.
    const current = asDict(v.current);
    if (current) {
      rewrites += rewriteStringField(
        current,
        'text',
        oldName,
        newName,
        `${vPath}.current.text`,
        locations,
      );
      rewrites += rewriteStringField(
        current,
        'value',
        oldName,
        newName,
        `${vPath}.current.value`,
        locations,
      );
    }
  }

  const panels = asArray(out.panels);
  for (let i = 0; i < panels.length; i++) {
    const panel = asDict(panels[i]);
    if (!panel) continue;
    rewrites += renameInPanel(panel, oldName, newName, `panels[${i}]`, locations);
  }

  return { dashboard: out, errors: [], rewrites, locations };
}
