# mcp-grafana

Strongly-typed Grafana asset builders (dashboards, panels, alerts, contact
points, …) with an MCP surface for LLM clients. Targets **Grafana 12.x**.

> **Status:** pre-1.0 (`0.2.0`). The library is usable for a small but
> growing set of Grafana assets and exposes them through an MCP server.
> The API may change as the surface grows. See `AGENTS.md` and
> `research.md` for the design and the open decisions.

## Install

> **Not yet published to npm.** The commands below describe the intended
> install once `@jburgess-js/mcp-grafana` is on the registry. Until then,
> use it from a [local build](#running-from-a-local-build-development).

```bash
# As a library or CLI
pnpm add @jburgess-js/mcp-grafana
# or: npm i @jburgess-js/mcp-grafana
# or: yarn add @jburgess-js/mcp-grafana

# As an MCP server, no install needed — npx fetches on demand
npx -y @jburgess-js/mcp-grafana
```

## Why this exists

Grafana dashboards-as-code in TypeScript, with three layers:

1. **Typed builders** over the official Apache-2.0
   [`@grafana/grafana-foundation-sdk`][foundation-sdk] — schema-valid
   Grafana JSON, deterministic output, narrow composable functions.
2. **Deterministic primitives** for the things an LLM can't reliably do
   itself: parsing Prometheus exposition format, validating dashboard
   shape, walking and patching existing dashboards. Opinion (RED /
   USE / golden signals patterns, panel style conventions) lives in
   markdown — under `docs/guidance/` for project-authored guidance and
   under `skills/` for user-installable shareable opinions — so the
   model can read and reason about it without us encoding heuristic
   rules in TypeScript that duplicate its training (see
   [`AGENTS.md`](./AGENTS.md) §1.8 and [`research.md`](./research.md)
   Entry 011).
3. **An MCP server** that exposes the builders and primitives as tools,
   and serves the markdown guidance + skills as resources, so LLM
   clients can compose Grafana assets and commit them as code.

Grafana's own [Metrics Drilldown][drilldown] already solves *interactive,
runtime* automatic exploration of metrics. This project is for the
**committable, versioned, asset-as-code** half of the problem.

### Where the "intelligence" comes from

When a workflow like [scaffolding a dashboard from `/metrics`](./docs/guidance/scaffold-from-metrics.md)
turns raw metrics into a complete dashboard, it's fair to ask: *what
decides which panels to build?* The deliberate answer is **not a
hardcoded generator**. There is no `scaffold_dashboard()` function that
embeds "a counter with a `status` label means an errors panel" — that
kind of judgement would duplicate what an LLM already knows and rot into
brittle taste-in-code (the reason it's excluded — `AGENTS.md` §1.8,
`research.md` Entry 011). The intelligence is the **LLM, reading two
things this project ships**:

1. **Curated, source-backed conventions** in
   [`skills/grafana-style-guide/SKILL.md`](./skills/grafana-style-guide/SKILL.md).
   This is where the best practices live — RED / USE / golden-signals,
   row sequencing (categorical "fold" first), unit conventions, legend
   cardinality, repeating-panel caps. They aren't invented; the skill's
   *References* section cites the kubernetes-mixin / monitoring-mixins
   corpus, **Grafana Labs' own Mimir / Loki / Tempo reference
   dashboards**, Shneiderman (1996), Tufte, the Google SRE Workbook, and
   the RED / USE method papers.
2. **An operational recipe** —
   [`docs/guidance/scaffold-from-metrics.md`](./docs/guidance/scaffold-from-metrics.md)
   — that connects the parsed facts to those conventions to the builders.

What the project itself *guarantees* (vs. what the model is merely
guided toward) splits in two:

- **Machine-enforced** by `grafana_dashboard_lint` (the conventions that
  are structural and deterministic): units allow/deny, descriptions
  required, timeseries-legend rules, `stat.requiresComparison` /
  `handlesUnknown`, `gauge.requiresBounds`, `targets.promqlValid` /
  `promqlSemantic`, `datasourceDeclared`,
  `duplicateTitles`, `maxRepeat`, `orphanRow`,
  `layout.firstRowCategorical`, `layout.panelOverlap`, the
  variable-hygiene rules
  (`hiddenButReferenced`, `emptyDefault`, `unreferenced`), and
  `links.preservesVariables` — the full rule set in
  [`skills/grafana-style-guide/SKILL.md`](./skills/grafana-style-guide/SKILL.md).
- **Prose-guided only** (taste a linter can't mechanically check): the
  deeper signal-first hierarchy — system-wide RED on row 2,
  pipeline-ordered per-component rows, multi-timescale strips.

So the value over "just ask an LLM for a dashboard" is **curated opinion
+ schema-valid builders (no hallucinated JSON) + PromQL validation + a
lint feedback loop** that mechanically catches the checkable mistakes.
It is verification-backed, not a deterministic oracle — which is why
generated output is honestly a **correct first draft to commit and
refine**, not a guaranteed-finished dashboard. Want more of it
guaranteed rather than guided? The lever is adding more *structural*
lint rules (moving conventions from the second list to the first); taste
stays in the skill by design.

## Quickstart

```ts
import {
  buildDashboard,
  buildRowPanel,
  buildStatPanel,
  buildTimeseriesPanel,
} from '@jburgess-js/mcp-grafana';

const ds = { uid: '$datasource', type: 'prometheus' };

const dashboard = buildDashboard({
  title: 'HTTP service',
  panels: [
    buildRowPanel({ title: 'Overview' }),
    buildStatPanel({
      title: 'Error rate (last 5m)',
      description: '5xx as a fraction of total requests.',
      unit: 'percentunit',
      targets: [{ expr: 'sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))' }],
      datasource: ds,
    }),
    buildRowPanel({ title: 'Request flow' }),
    buildTimeseriesPanel({
      title: 'HTTP requests',
      description: 'The total number of processed HTTP requests.',
      unit: 'reqps',
      targets: [
        { expr: 'sum(rate(http_requests_total[$__rate_interval])) by (status)',
          legendFormat: '{{ status }}' },
      ],
      datasource: ds,
    }),
  ],
});
```

The builders are thin wrappers over the Apache-2.0
[`@grafana/grafana-foundation-sdk`][foundation-sdk]. They produce
JSON-serializable Grafana objects you can post to Grafana's HTTP API,
write to a provisioning file, or commit to git.

**Set `datasource` on every data-bearing panel.** Without it Grafana
falls back to the instance default; if no default is set the panel
queries nothing and renders blank — the "silent broken dashboard"
failure mode. Use a templating-variable reference like
`{ uid: "$datasource" }` for multi-environment dashboards.
`grafana_dashboard_lint`'s `dashboards.panels.datasourceDeclared` rule
catches omissions.

For lower-level control you can still pass raw SDK panel builders into
`buildDashboard({ panels: [new PanelBuilder()...] })` directly;
`buildTimeseriesPanel` and siblings return the same shape they do.
Row panels are detected and routed through the SDK's `withRow()` for
correct 24×1 layout — see the `PanelInput` and "dashboard registry"
glossary entries for the type widening.

The quickstart above is mirrored by a runnable file at
[`examples/build-and-inspect.ts`](./examples/build-and-inspect.ts),
which is compiled and run in CI on every commit (per AGENTS.md §4: "No
stale examples. Examples are compiled and run in CI. A broken example
fails the build."). The example's test asserts the dashboard's
*structure* (title, panel count, rows) — so the example can't silently
stop building or producing a valid dashboard, though the exact panel
copy here is illustrative and not byte-for-byte pinned to the example.

### Working with large existing dashboards

When auditing or modifying a dashboard that already exists, **load it
once into the session registry** and pass its URI to every subsequent
tool. The full JSON enters your LLM's context exactly once (at export,
if at all) rather than on every call.

```jsonc
// 1. Load once — JSON does not enter context.
{ "tool": "grafana_dashboard_load", "arguments": { "path": "./prod.json" } }
// → { "uri": "mcp://grafana/session/dashboard/1" }

// 2. Inspect / lint / find via URI — bounded outputs only.
{ "tool": "grafana_dashboard_inspect",
  "arguments": { "dashboardUri": "mcp://grafana/session/dashboard/1",
                 "detail": "summary" } }
// → { title, panelCount, variables, rows, … }

// 3. Mutate via URI — registry is updated in place; response is a
//    bounded summary, not the full modified dashboard.
{ "tool": "grafana_dashboard_panel_update",
  "arguments": { "dashboardUri": "mcp://grafana/session/dashboard/1",
                 "panelId": 42,
                 "patch": { "fieldConfig": { "defaults": { "unit": "reqps" } } } } }
// → { uri, summary, errors: [] }

// 4. Export at the end — the only step that puts the full JSON in
//    context. Skip if you only need to know whether the audit succeeded.
{ "tool": "grafana_dashboard_export",
  "arguments": { "uri": "mcp://grafana/session/dashboard/1" } }
// → { dashboard }
```

Per [AGENTS.md §1.8](./AGENTS.md) the server never writes to your
filesystem; export hands the JSON back so the host can persist it via
its own write tool (Claude Code's `Write`, Cursor's edit primitives,
etc.). See
[`docs/guidance/session-resource-registry.md`](./docs/guidance/session-resource-registry.md)
for the full lifecycle, when-to-use heuristic, and worked audit-and-
fix example.

## Using the MCP server

The library ships with an MCP server that exposes builders as tools so
LLM clients (Claude Desktop, Cursor, Codex, etc.) can compose Grafana
assets.

### Install as a plugin (Claude Code / Codex)

This repo is a **plugin marketplace** for both Claude Code and Codex. A
plugin install wires up the MCP server *and* the Grafana style-guide
skill in one step — no manual config.

**Claude Code:**

```text
/plugin marketplace add jburgess/mcp-grafana
/plugin install mcp-grafana@mcp-grafana
```

**Codex:**

```bash
codex marketplace add github:jburgess/mcp-grafana
# then install the `mcp-grafana` plugin from the marketplace picker
```

Both pull the same pieces: the MCP server runs via `npx -y
@jburgess-js/mcp-grafana` (declared in the shared
[`.mcp.json`](./.mcp.json)), and the skill is bundled from
[`skills/grafana-style-guide/SKILL.md`](./skills/grafana-style-guide/SKILL.md).
The Claude manifests live in
[`.claude-plugin/`](./.claude-plugin/); the Codex manifests in
[`.codex-plugin/plugin.json`](./.codex-plugin/plugin.json) and
[`.agents/plugins/marketplace.json`](./.agents/plugins/marketplace.json).
The plugin tracks the latest published npm release; pin a version in
`.mcp.json` (`@jburgess-js/mcp-grafana@<version>`) if you want reproducible
installs.

> The plugin install delivers value once `@jburgess-js/mcp-grafana` is
> published to npm (`npx` resolves it on demand). Until then, use the
> local-build wiring below.

If you don't use a plugin marketplace, wire the server directly instead:

### Wiring the published package

> Requires `@jburgess-js/mcp-grafana` to be published to npm (not yet — see
> the note under [Install](#install)). Until then, use the
> [local build](#running-from-a-local-build-development) wiring below.

Wire it into an MCP-aware client by running it over stdio:

```jsonc
// e.g. ~/.config/claude/claude_desktop_config.json
{
  "mcpServers": {
    "grafana": {
      "command": "npx",
      "args": ["-y", "@jburgess-js/mcp-grafana"]
    }
  }
}
```

The package name is scoped (`@jburgess-js/mcp-grafana`); the bin it
installs is the unscoped `mcp-grafana` command.

### Running from a local build (development)

If you're working in this repo and want your MCP client to point at
your **local checkout** (rather than the published npm package) — for
dogfooding before publishing, testing an unmerged branch, or
iterating on changes — build the package and point the client at the
built executable.

```bash
pnpm install
pnpm build
# produces dist/mcp/stdio.js (the bin entry the published package exposes too)
```

Then configure your MCP client with an **absolute path** to that built
file. Two common clients shown below; the pattern is the same for any
MCP-aware client.

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.grafana-local]
command = "node"
args = ["/absolute/path/to/mcp-grafana/dist/mcp/stdio.js"]
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS; equivalent path on Linux/Windows):

```jsonc
{
  "mcpServers": {
    "grafana-local": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-grafana/dist/mcp/stdio.js"]
    }
  }
}
```

Restart the client to pick up the new config — MCP servers are
launched at client startup, not hot-loaded.

**Verify the tools loaded.** Ask the model:

> *What `grafana_*` tools do you have access to?*

You should see twenty-five: `grafana_dashboard_build`,
`grafana_dashboard_load`, `grafana_dashboard_export`,
`grafana_dashboard_close`, `grafana_dashboard_inspect`,
`grafana_dashboard_diff`, `grafana_dashboard_validate`,
`grafana_panel_validate`, `grafana_panel_lint`, `grafana_dashboard_lint`,
`grafana_dashboard_panel_insert`, `grafana_dashboard_panel_update`,
`grafana_dashboard_panel_move`, `grafana_dashboard_panel_remove`,
`grafana_dashboard_panel_find`, `grafana_dashboard_variable_rename`,
`grafana_timeseries_panel_build`, `grafana_row_panel_build`,
`grafana_stat_panel_build`, `grafana_table_panel_build`,
`grafana_state_timeline_panel_build`, `grafana_heatmap_panel_build`,
`grafana_gauge_panel_build`, `grafana_promql_validate`,
`prometheus_metric_parse`. The MCP server also exposes the skill at
`mcp://grafana/skills/grafana-style-guide.md` as a read-only resource.

**Iterating on changes.** The MCP client runs the server as a
long-lived subprocess; it does not hot-reload source changes. After
editing `src/`:

```bash
pnpm build
```

then restart the MCP client. (The published-package wiring above
doesn't have this problem because each `npx -y` invocation re-resolves
the latest version, but you also don't see your unpublished changes.)

**Common gotchas:**

- **Use an absolute path.** Relative paths are resolved against the
  client's working directory, which is usually not your project root.
- **`node` must be on PATH when the client launches.** If you use a
  Node version manager (nvm, asdf, fnm), the client may not inherit
  your shell's PATH. Use the explicit node binary path:
  `command = "/Users/you/.nvm/versions/node/v22.x.x/bin/node"`.
- **Name local and published distinctly.** If you have both wired
  (e.g. `grafana` for the published package and `grafana-local` for
  your build), you can tell from the tool-call namespace which one
  the model picked. Don't share a name across both or you'll chase
  ghost behavior changes.
- **Tools missing entirely?** Check the client's MCP log
  (Claude Desktop: `~/Library/Logs/Claude/mcp*.log` on macOS).
  Common causes: typo in the absolute path, Node not found, the
  `pnpm build` step was skipped so `dist/mcp/stdio.js` doesn't exist.

The server exposes 25 tools:

| Tool                              | Inputs                                  | Returns                                                            |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `grafana_dashboard_load`          | `{ path }`                              | `{ uri }` — read a dashboard JSON file from disk and register it in the session-scoped registry; the JSON does NOT enter the LLM context, only the URI does |
| `grafana_dashboard_export`        | `{ uri }`                               | `{ dashboard }` — retrieve a registered dashboard (e.g. to hand to the host's Write tool or POST to Grafana); use `grafana_dashboard_inspect` for review-without-pulling |
| `grafana_dashboard_close`         | `{ uri }`                               | `{ removed }` — free a registry slot before session end (idempotent) |
| `grafana_dashboard_build`         | `{ title, panels?, tags? }`             | A Grafana dashboard as JSON text. `tags` sets Grafana's native `tags[]` (used for foldering and as the opt-in signal `dashboards.layout.firstRowCategorical` keys on) |
| `grafana_dashboard_inspect`       | `{ dashboard, detail? }`                | Structured view of an existing dashboard (summary / panels / conventions); per-panel `targets` and stat-panel mode histograms surface audit signal without a follow-up raw-JSON read |
| `grafana_dashboard_diff`          | `{ base, head }` (or `baseUri` / `headUri`) | `{ panelsAdded[], panelsRemoved[], panelsChanged[], dashboardChanges[], truncated? }` — semantic diff over the normalized panel projection; the "review" leg (pair to build + lint). Array reorders / key churn don't register; `otherChanges` flags changes outside the projection (thresholds, overrides). See `docs/guidance/pr-review.md` |
| `grafana_dashboard_validate`      | `{ dashboard }`                         | `{ valid, errors[] }` — required fields, unique panel ids, unique target refIds per panel, resolvable variable refs |
| `grafana_panel_validate`          | `{ panel, dashboard? }`                 | `{ valid, errors[] }` — schema only without context; + variable-ref checks with context |
| `grafana_panel_lint`              | `{ panel, styleGuide }`                 | `{ issues: [{ path, ruleId, severity: 'warn'\|'info', message }], truncated? }` — style-axis checks (units allow/deny, descriptions required, timeseries legend); never returns `error` severity (that's `grafana_panel_validate`'s axis) |
| `grafana_dashboard_lint`          | `{ dashboard, styleGuide }`             | Same `LintResult` shape — walks every panel via `lintPanel` and adds dashboard-level rules (`duplicateTitles`, `maxRepeat`, `datasourceDeclared`, `orphanRow`, `hiddenButReferenced`, `emptyDefault`, `unreferenced`, `preservesVariables`, `layout.firstRowCategorical`, `layout.panelOverlap`). Paths are rebased onto `panels[N].*` so consumers can group by panel |
| `grafana_dashboard_panel_insert`  | `{ dashboard, panel, position? }`       | `{ dashboard?, errors[] }` — insert a panel (append / gridPos / after id / in row) with auto-id assignment |
| `grafana_dashboard_panel_update`  | `{ dashboard, panelId, patch }`         | `{ dashboard?, errors[] }` — apply a JSON Merge Patch (RFC 7396) to a single panel |
| `grafana_dashboard_panel_move`    | `{ dashboard, panelId, to }`            | `{ dashboard?, errors[] }` — relocate a panel/row using the same position modes as insert |
| `grafana_dashboard_panel_remove`  | `{ dashboard, panelId }`                | `{ dashboard?, errors[] }` — remove a panel; modern rows leave trailing siblings in place |
| `grafana_dashboard_panel_find`   | `{ dashboard, filter }`                 | `{ panelIds[], errors[] }` — closed-set filter (`type` / `unit` / `hasUnit` / `hasDescription` / `queryMatches`) returns ids in walk order; precursor to bulk operations |
| `grafana_dashboard_variable_rename` | `{ dashboard, oldName, newName }`     | `{ dashboard?, errors[], rewrites, locations[] }` — atomic, escape-safe rename across templating, panel targets, datasources, titles, descriptions, and repeat fields; preserves Grafana's four interpolation syntaxes |
| `prometheus_metric_parse`         | `{ text }` or `{ path }`                | Parsed metric definitions (name, type, labels, …) as JSON text. Pass inline `text` or a file `path` (prefer `path` for large scrapes — keeps the bulk out of LLM context). No URL fetch — the server stays offline |
| `grafana_promql_validate`         | `{ expr }`                              | `{ valid, errors[] }` — PromQL syntax check using the same Lezer grammar Grafana's PromQL editor uses; pre-substitutes Grafana templating variables (`$__rate_interval`, `${env}`) so stored dashboard expressions validate clean |
| `grafana_timeseries_panel_build`  | `{ title, targets[], unit?, datasource?, … }` | A Grafana timeseries panel as JSON text; supports multi-expression. STRONGLY recommend setting `datasource` |
| `grafana_row_panel_build`         | `{ title, collapsed? }`                 | A Grafana row panel (`"type": "row"`) — collapsible section header for grouping panels into named segments |
| `grafana_stat_panel_build`        | `{ title, targets[], unit?, graphMode?, reduceCalc?, datasource?, … }` | A Grafana stat panel (`"type": "stat"`) for single-value KPIs; `graphMode` defaults to `"area"` (matches `panels.stat.requiresComparison`) |
| `grafana_table_panel_build`       | `{ title, targets[], unit?, filterable?, datasource?, … }` | A Grafana table panel (`"type": "table"`) for ranked / enumerated data — top-N endpoints, per-service counts, service inventory |
| `grafana_state_timeline_panel_build` | `{ title, targets[], mergeValues?, rowHeight?, datasource?, … }` | A Grafana state-timeline panel (`"type": "state-timeline"`) for categorical health / status signals — UP/DOWN, OK/WARNING/CRITICAL — across a time window |
| `grafana_heatmap_panel_build`     | `{ title, targets[], unit?, calculate?, datasource?, … }` | A Grafana heatmap panel (`"type": "heatmap"`) for value distributions over time and the "rows = entities, color = value" matrix the style guide prescribes past ~10 repeats; `calculate: true` buckets raw series, omit for pre-bucketed histogram data |
| `grafana_gauge_panel_build`       | `{ title, targets[], unit?, min?, max?, reduceCalc?, datasource?, … }` | A Grafana gauge panel (`"type": "gauge"`) for a single value against a bounded range — utilisation %, SLO budget remaining; set `min`/`max` for the arc scale (matches `panels.gauge.requiresBounds`), prefer `grafana_stat_panel_build` for unbounded values |

`grafana_dashboard_build`'s optional `panels` parameter accepts an array
of panel JSON objects — typically the output of
`grafana_timeseries_panel_build`. The LLM round-trip is: call
`grafana_timeseries_panel_build` once per panel, collect the JSON,
pass the collected array as `panels` to `grafana_dashboard_build`, and
the result passes `grafana_dashboard_validate` without further wiring
(panel ids are auto-assigned; explicit ids preserved). Then post the
dashboard JSON to Grafana.

`grafana_dashboard_inspect` reads an existing dashboard JSON and
returns a structured view at one of three detail levels — `summary`
(default, bounded headline view safe for arbitrarily large dashboards;
includes a `rows` list with each row's title, id, and child-panel
count; treats `description: ""` and absent the same when counting
panels missing a description), `panels` (per-panel rows for audit
workflows: titles, descriptions, units, gridPos, `rowId` so the LLM
knows which row each panel belongs to, **and each panel's `targets`
with `expr` / `legendFormat` / `refId` / `hide`** — eliminating a
follow-up read of the raw JSON; `expr` is capped at 512 chars with a
`truncated: true` flag so models detect truncation without inspecting
the suffix), or `conventions` (panel-size histogram, top units,
variables, row count, **plus `statGraphModes` and `statColorModes`
histograms across stat panels** so a stat-heavy KPI-with-trend
dashboard is not misgraded as flat KPI). Both legacy (Grafana ≤7,
`row.panels[]` nested) and modern (Grafana ≥8, flat panels ordered by
array position) row-membership styles are handled.

`grafana_dashboard_validate` and `grafana_panel_validate` return a
model-friendly `{ valid, errors[] }` rather than throwing. Each error
has a JSONPath-like `path` (e.g., `"panels[2].targets[0].expr"`) and a
short `message`. Validation covers required fields (`title`, per-panel
`id`, well-formed `gridPos`), panel id uniqueness across the full
panel tree (including row-nested), and variable references in panel
queries (`expr` / `query` / `rawQuery`) and `datasource.uid` — Grafana
built-ins like `$__rate_interval` are allowed automatically. The
errors list is capped at 100 with `truncated: true` if exceeded.

`grafana_panel_lint` checks a single panel against a
`GrafanaStyleGuide` (or the `PanelStyleGuide` slice directly — the
tool unwraps either) and returns `{ issues: [{ path, ruleId, severity,
message }], truncated? }`. Severity is `warn` or `info` — never
`error`; that axis belongs to `grafana_panel_validate`. The skill at
`mcp://grafana/skills/grafana-style-guide.md` is the canonical input;
users fork it, edit it, version it. There is no built-in default —
mcp-grafana ships zero opinion in code. Currently fires:
`panels.units.allowList`, `panels.units.deny`,
`panels.descriptions.required` (empty-string descriptions count as
missing, matching `grafana_dashboard_inspect`), and the timeseries
legend trio (`placement` / `displayMode` / `calcs`). Rule ids are
JSONPath-style dotted paths into the umbrella `GrafanaStyleGuide`;
new panel types and rule families grow by addition.

`grafana_dashboard_lint` is the dashboard-level aggregator over
`lintPanel`. It walks every panel (top-level and legacy
`row.panels[]`), runs the panel-slice rules against each, and adds
dashboard-level rules that can't be checked per-panel:
`dashboards.panels.duplicateTitles` (non-row panels sharing a title;
rows are excluded because section markers often share titles
legitimately), `dashboards.panels.maxRepeat` (repeat-by-variable
cardinality cap), `dashboards.panels.datasourceDeclared` (panels
missing a usable datasource ref — the "silent broken dashboard" case),
`dashboards.panels.orphanRow` (a row with no panels under it — a dead
section header), `dashboards.variables.hiddenButReferenced` (a
templating variable with `hide: 2` interpolated in a panel or row
title — the viewer sees the value with no label, the original bug case
from a real dashboard-annotation session), `dashboards.variables.emptyDefault` (a
variable with no `current.value`), `dashboards.variables.unreferenced`
(a templating variable never interpolated anywhere — dead config),
`dashboards.links.preservesVariables`
(a drill-down link that drops every templating variable), and
`dashboards.layout.firstRowCategorical` (an overview dashboard whose
first row is a wall of numbers instead of categorical health — opt-in,
scoped to dashboards tagged `overview` via
`{ "overviewTag": "overview" }`), and `dashboards.layout.panelOverlap`
(two panels whose `gridPos` rectangles intersect, so one hides the
other — mainly a guard for hand-edited / imported dashboards). The aggregator is intentionally thin: taste-laden
heuristics (title-query mismatch, naming inconsistency, unit
suggestions) live in the skill's prose rather than in code, per
`AGENTS.md` §1.8. Issue paths are rebased onto the dashboard's
`panels[N].*` shape so consumers can group by panel. Panel-level
issues come first in the list, then dashboard-level issues.

`grafana_dashboard_panel_insert` adds a panel to an existing dashboard
without forcing the LLM to reconstruct the full JSON. Four position
modes: `{mode:"append"}` (default — bottom of dashboard), `{mode:
"gridPos", x, y, w, h}` (explicit), `{mode:"after", panelId: N}`
(directly below a named panel; works whether the named panel is
top-level or inside a row), and `{mode:"inRow", rowId: N}` (make the
panel a child of a named row — handles both legacy and modern row
formats). Auto-assigns the next free panel id if the incoming panel
has none. Returns `{ dashboard?, errors[] }`: the modified dashboard
on success, error diagnostics on failure (unknown id, non-row in
`inRow` mode, etc.). The input dashboard is never mutated.

`grafana_dashboard_panel_update` applies a JSON Merge Patch
([RFC 7396](https://datatracker.ietf.org/doc/html/rfc7396)) to a single
panel identified by id. Patch fields overwrite the panel's fields;
`null` clears; nested objects deep-merge; arrays replace wholesale.
Use this for the audit workflow's fix step ("add a description here",
"change the unit") without rebuilding the panel from scratch and
losing fields the panel-build tools don't surface (color, thresholds,
overrides). The `panelId` lookup walks row-nested panels too. Returns
`{ dashboard?, errors[] }` with the same shape and immutability
guarantee as `panel_insert`.

`grafana_dashboard_panel_move` relocates a panel (or a row — a row IS a
panel) to a new position using the same four position modes as
`panel_insert` (`append` / `gridPos` / `after` / `inRow`). When the
moved panel is a row in modern format (no nested `row.panels[]`), its
trailing siblings in the top-level array — the panels that implicitly
belong to it by ordering — are carried along. Legacy rows always carry
their nested children. You can't move a row into another row (rows
don't nest); the tool returns an error if `to.mode` is `"inRow"` for a
row.

`grafana_dashboard_panel_find` returns the ids of panels matching a
closed-set filter (`type`, `unit`, `hasUnit`, `hasDescription`, `queryMatches`).
Designed as the find half of the audit workflow — "find every
timeseries panel with unit `short` whose query uses `rate(`" → loop
`grafana_dashboard_panel_update` over the resulting ids → call
`grafana_dashboard_validate` on the final dashboard. The full pattern
is documented in
[`docs/guidance/bulk-panel-updates.md`](./docs/guidance/bulk-panel-updates.md)
(also served as a read-only MCP resource at
`mcp://grafana/docs/guidance/bulk-panel-updates.md`). mcp-grafana
deliberately does not ship a dedicated `panel_update_bulk` tool — see
the guidance doc and `research.md` Entry 015 for the design rationale
(atomicity is wrong for independent panel-level updates; per-call
error attribution is better than batched).
Filter fields AND together; empty filter matches every panel. Row
panels are excluded from `hasDescription` filtering (they're section
markers, not visualizations). The `queryMatches` regex pattern is
capped at 200 characters in length (length only — short pathological
patterns can still backtrack catastrophically); longer patterns and
invalid regex syntax return errors rather than running. Results in
dashboard walk order so consumers can rely on stable ordering. Panels
without an id are skipped — callers can't reference them downstream.

`grafana_dashboard_variable_rename` atomically renames a templating
variable across the whole dashboard — the variable definition itself,
its matching `label`, every reference in other variables'
`query` / `definition` / nested `query.datasource.uid` /
`current.text` / `current.value`, every panel target's `expr` /
`query` / `rawQuery`, datasource refs (string and object forms — both
panel-level and per-target), panel and row titles and descriptions,
and the `repeat` field. Recognizes all four Grafana interpolation
syntaxes (`$name`, `${name}`, `${name:fmt}`, `[[name]]`, `[[name:fmt]]`)
and preserves the form. Word-boundary aware so `$foo` doesn't match
inside `$foobar`. Returns `{ dashboard?, errors[], rewrites,
locations[] }` — the location list is the JSONPath of every change
site in walk order, for audit and verification. Errors when `oldName`
is unknown, `newName` collides with an existing variable, or `newName`
violates Grafana's `[a-zA-Z_][a-zA-Z0-9_]*` rule; same-name renames
are a no-op success with `rewrites=0`. Some less-common reference
sites are deferred (annotations, links, transformations, overrides,
custom-variable options) — run `grafana_dashboard_validate` after the
rename to catch any dangling refs.

`grafana_dashboard_panel_remove` deletes a panel by id. Regular panels
are spliced from their container; legacy rows are removed together
with their nested children; modern rows are removed but their trailing
siblings are **promoted to no-row status** (they keep their `gridPos`
but lose their implicit row affiliation). Matches "delete the section
header but keep the charts under it" intent.

`prometheus_metric_parse` accepts the raw exposition-format text from a
`/metrics` endpoint — inline via `text`, or from a file via `path`
(prefer `path` for large scrapes: a busy service's `/metrics` is
thousands of series, and reading from disk keeps that bulk out of the
LLM context) — and returns structured metric data the LLM can reason
about: types (counter / gauge / histogram / summary), HELP text, and the
distinct label values seen across samples. The server does not fetch
URLs (it stays offline by design); if the metrics live behind an
endpoint, have the host fetch it and pass the body or save it to a file.

**Scaffold a dashboard from `/metrics`.** Those parsed facts are the
starting point for the project's flagship workflow: point at a service's
`/metrics`, and the LLM — guided by the style guide's RED / USE /
golden-signals patterns — scaffolds a committable, lint-clean dashboard
(correct panel types, units, datasources, and a categorical-health fold).
The step-by-step recipe is
[`docs/guidance/scaffold-from-metrics.md`](./docs/guidance/scaffold-from-metrics.md)
(served at `mcp://grafana/docs/guidance/scaffold-from-metrics.md`), with a
runnable end-to-end demonstration at
[`examples/scaffold-from-metrics.ts`](./examples/scaffold-from-metrics.ts).
There is deliberately no `scaffold_dashboard` tool — choosing panels from
metrics is judgement that lives in the guidance the model reads, not in a
hardcoded function (AGENTS.md §1.8). It produces a *correct first draft to
commit and refine*, not a finished signal-first hierarchy.

**Audit an existing dashboard.** The mirror-image workflow: point at a
messy dashboard you already have and get a prioritised, line-referenced
review of what's wrong and how to fix it. The model loads it once
(`grafana_dashboard_load` — the big JSON stays out of context), inspects,
lints it against the style guide, prioritises the findings (silent-failure
`warn`s — broken queries, missing datasources, overlapping panels — before
`info` hygiene), fixes with `grafana_dashboard_panel_update`, and re-lints
to verify. The recipe is
[`docs/guidance/audit-review.md`](./docs/guidance/audit-review.md) (served
at `mcp://grafana/docs/guidance/audit-review.md`), with a runnable
load→lint→prioritise→fix→verify demonstration at
[`examples/audit-review.ts`](./examples/audit-review.ts). Like scaffolding,
there's no `grafana_dashboard_audit` tool — orchestrating and prioritising
findings is judgement the model does from the guidance; it reports a
*prioritised review, not an exhaustive verdict* (the lint catches the
structural subset; the deeper signal-first hierarchy stays prose-guided).

**Review a dashboard change.** The third leg alongside build and audit:
someone changed a dashboard JSON and you need to know what *actually*
changed. `grafana_dashboard_diff` compares two dashboards on the normalized
panel projection and reports the semantic deltas (panels added / removed /
changed, dashboard-level changes) — so array reorders and key-order churn
don't drown out the threshold that flipped or the datasource that got
swapped. The recipe
[`docs/guidance/pr-review.md`](./docs/guidance/pr-review.md) (served at
`mcp://grafana/docs/guidance/pr-review.md`) turns those facts into a
risk-ordered changelist, with a runnable demonstration at
[`examples/pr-review.ts`](./examples/pr-review.ts). The diff is shallow by
design (it doesn't see thresholds, overrides, transformations); it flags
those via `otherChanges` rather than silently reporting "no change," and —
like the others — emits facts only, leaving the risk judgement to the
prose the model reads (AGENTS.md §1.8).

`grafana_timeseries_panel_build` accepts one or more `targets` so the
LLM can plot a counter rate and its 5xx error rate (or any other set
of related queries) on the same chart.

More tools (`grafana_alert_rule_build`, guidance resources, …) are
sequenced in [`research.md`](./research.md) Entries 010 and 011 and
will land in subsequent PRs.

The library is pre-1.0 (`0.2.0`). Alert/contact-point builders and
the guidance-resource layer are tracked in
[`research.md`](./research.md) and will land in subsequent PRs.

## Grafana style skill

`skills/grafana-style-guide/SKILL.md` is a starter style guide for Grafana,
modeled on the
[kubernetes-mixin](https://github.com/kubernetes-monitoring/kubernetes-mixin)
and [monitoring-mixins](https://monitoring.mixins.dev/) corpus. v0.1
covers panels (units, legends, thresholds, titles, descriptions);
dashboards, alert rules, and recording-rule conventions are scoped in
the skill body and follow in subsequent revisions.

Install by copying the file into your tool's skills / rules directory.
Fork freely — the project does not auto-update or otherwise manage the
copy you install.

- **Claude Code** — copy the file into your skills directory:
  ```bash
  cp "$(npm root -g)/@jburgess-js/mcp-grafana/skills/grafana-style-guide/SKILL.md" ~/.claude/skills/
  ```
- **Cursor** — `@`-include the file in chat, or paste the contents into
  `.cursorrules` in your workspace root.
- **Generic MCP client** — fetch the file via the read-only resource at
  `mcp://grafana/skills/grafana-style-guide.md` (discoverable via
  `resources/list`; future `docs/guidance/*.md` files surface the same
  way under `mcp://grafana/docs/guidance/<name>.md` — see
  [`docs/conventions/mcp-resource-uris.md`](./docs/conventions/mcp-resource-uris.md)),
  or grab the file directly from the installed package.
- **Any other LLM tool** — the skill is plain markdown; paste it into a
  system prompt or rules file.

The skill is markdown with frontmatter (Anthropic Agent Skills format)
plus a `GrafanaStyleGuide` JSON block that the `lintPanel` library
function and the `grafana_panel_lint` MCP tool consume. mcp-grafana
ships zero default opinion in code — the skill is the only place
opinion lives, and the lint primitive requires the caller to pass a
`GrafanaStyleGuide` (no `defaultStyleGuide` export, no bare
`StyleGuide` type, both rejected per `research.md` Entry 013). The
MCP server delivers content (read-only resource); it does not write
to your filesystem. There is no `grafana_skill_install` tool — moving
bits is your tool's job.

The decision is ratified in [`research.md`](./research.md) Entry 013,
which records the six-perspective debate, the rejected alternatives,
and the agent-by-agent acceptance.

## Project state

| Decision           | Choice                                                       |
| ------------------ | ------------------------------------------------------------ |
| Substrate          | `@grafana/grafana-foundation-sdk` (Apache-2.0)               |
| Test stack         | Vitest + fast-check (MIT) + `tsc --noEmit`                   |
| MCP framework      | `@modelcontextprotocol/sdk` (MIT + Apache-2.0)               |
| Runtime validator  | Zod v4 (MIT)                                                 |
| License            | MIT                                                          |
| Runtime            | Node 24 LTS for development; `engines: ">=22.0.0"`           |
| Package manager    | pnpm via corepack                                            |
| Grafana target     | 12.x (12.4 specifically)                                     |
| Intelligence layer | Heuristics in core; LLMs on the client side (via MCP) only   |

All decisions are documented in [`research.md`](./research.md) and the
team conventions in [`AGENTS.md`](./AGENTS.md).

## Developing

```bash
# enable corepack (one-time, ships with Node 22+)
corepack enable

# install dependencies
pnpm install

# run the unit test suite (Vitest, no Docker, ~1s)
pnpm test

# watch mode
pnpm test:watch

# run the integration test suite (Docker required — boots
# grafana/grafana:12.4.0 via Testcontainers and round-trips our
# generated dashboards through Grafana's HTTP API). Skips gracefully
# if Docker is not reachable on the host.
pnpm test:integration

# type-check (Vitest does not type-check; tsc does)
pnpm typecheck

# build the library to ./dist
pnpm build
```

### Integration tests and Docker

Most contributors never need Docker — the unit suite (`pnpm test`)
covers all library and MCP-tool behavior offline. The integration
suite (`pnpm test:integration`) round-trips our generated dashboard
JSON through a real Grafana 12.4 container; only contributors adding
Grafana-correctness coverage need Docker locally. CI runs the
integration suite on every PR (Linux only) and **blocks merge** on
failure. See `research.md` Entry 012 for the architecture decision
and the AGPL-licensing review (Grafana OSS is AGPL-3.0; we use it
strictly as dev-only tooling per AGENTS.md §1.7).

## Licensing for adopters

Short version: **installing `@jburgess-js/mcp-grafana` carries no AGPL
exposure.** The longer version below is intended for procurement /
legal review and walks through why.

### What this package actually ships

`package.json`'s `files` field is `["dist", "skills", "docs/guidance",
"README.md", "LICENSE", "CHANGELOG.md"]`. That is:

- `dist/` — our TypeScript compiled to JavaScript. Original work,
  MIT-licensed.
- `skills/` and `docs/guidance/` — the style-guide skill and the
  project-authored guidance recipes, served by the MCP server as
  read-only resources. Original markdown prose, MIT-licensed.
- `README.md` and `CHANGELOG.md` — text.
- `LICENSE` — the MIT license that applies to everything above.

The `test/` directory (which contains, among other things, integration
tests that *use* a Grafana container) is **excluded** from the
published artifact.

### Runtime dependency tree — full audit

Running `pnpm licenses list --prod` on this package yields:

| License | Package count |
|---|---|
| MIT | 81 |
| ISC | 7 |
| BSD-3-Clause | 2 |
| BSD-2-Clause | 1 |
| Apache-2.0 | 1 (`@grafana/grafana-foundation-sdk`) |
| 0BSD | 1 |
| **AGPL / GPL / LGPL / SSPL / BUSL / Commons Clause** | **0** |

The only Grafana-branded thing we import at runtime is
[`@grafana/grafana-foundation-sdk`][foundation-sdk] — **Apache 2.0**,
the typed builders Grafana publishes specifically for ecosystem tools
to generate dashboard JSON without touching the AGPL server. That's
the supported integration path.

### Four ways AGPL contamination could happen — none apply

| Contamination path | Applies here? |
|---|---|
| Bundling AGPL code in our distribution | No. We don't ship any Grafana server code. |
| Linking against an AGPL library at runtime | No. Our only Grafana-branded runtime dep is the Apache-2.0 Foundation SDK. |
| Modifying Grafana and distributing the modified version | No. We don't modify it. We don't ship it. |
| Operating a modified Grafana over a network (AGPL §13) | No. We don't operate Grafana at all — *you* operate your own Grafana. We just send HTTP requests to it. |

### "But our team uses Grafana — does this change our AGPL posture?"

No. You were already an AGPL operator (because you run Grafana).
Adding this MCP server doesn't change that by one byte:

- It doesn't make you distribute Grafana.
- It doesn't make your dashboards into derivative works — JSON files
  using a documented schema aren't derivative works of the software
  that consumes the schema (same reason an HTML file isn't a derivative
  work of Chrome).
- It doesn't trigger AGPL §13 because you're not modifying Grafana.

The MCP server generates JSON files. You import those files into your
own Grafana via the HTTP API or provisioning files, exactly as you'd
import any other dashboard JSON.

### The test infrastructure (separate concern, also clear)

This repo's integration tests pull `grafana/grafana:12.4.0` via
Docker to validate that the JSON we produce actually loads in a real
Grafana. That is:

- **Dev-only.** Never reaches the npm package (`test/` is excluded).
- **Unmodified use** of Grafana under its own license. AGPL only
  triggers on *distribution* of modified versions, not on running the
  unmodified upstream image.
- **Each contributor's own Docker host.** We don't operate or ship the
  container ourselves.

This is the same pattern as using the `node:22` Docker image to test a
JavaScript library — nobody worries about "node license contamination"
because there isn't any.

`research.md` Entry 012 records the full architecture decision and the
formal license review (per AGENTS.md §1.7's dev-only-tooling
exemption).

## License

[MIT](./LICENSE).

[foundation-sdk]: https://github.com/grafana/grafana-foundation-sdk
[drilldown]: https://github.com/grafana/metrics-drilldown
