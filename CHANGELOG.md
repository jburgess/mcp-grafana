# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **`removePanel` no longer false-matches panels without an `id`.** The
  previous implementation used a helper that returned `undefined` on a
  non-match and then compared via `===`; when a dashboard contained any
  panel without an `id` field, looking up a non-existent id would
  produce `undefined === undefined === true` and delete the first id-less
  panel. Surfaced independently by two agent-team reviews (TypeScript
  Expert and Naysayer) and verified by a regression test that 159 prior
  unit tests had missed.
- **MCP server reports the real package version on the initialize
  handshake.** Previously hardcoded to `'0.0.0'` while the package was
  shipping at `0.1.0` and `0.1.x`, so every MCP client saw a wrong
  version. Now read at module load from `package.json` via the
  `dist/mcp/server.js` → `../../package.json` relative path, which
  resolves correctly in both source and installed-package layouts. New
  test asserts equality with `package.json` to prevent drift.

### Changed
- **Helpers (`asDict` / `asArray` / `asString` / `asNumber` / `panelId` /
  `panelGridPos` / `deepClone`) consolidated into `src/assets/_internal.ts`.**
  Previously duplicated verbatim across `inspect.ts`, `validate.ts`,
  `insert.ts`, `update.ts`, `move.ts`, `remove.ts` — six copies of the
  same code, which is how the `remove.ts` bug above slipped in. One
  source of truth across all mutation tools. Net deletion of ~110 lines
  of production code with no behavior change for the public API.

### Added
- **Ninth + tenth MCP tools + library functions:
  `grafana_dashboard_panel_move` / `movePanel` and
  `grafana_dashboard_panel_remove` / `removePanel`.** Close the mutation
  surface for v0.1.1: the LLM can now relocate and delete panels (and
  rows, since a row IS a panel) — not just add and modify them.
  - `panel_move({ dashboard, panelId, to })` re-uses the four
    `InsertPosition` modes from `panel_insert` (`append` / `gridPos` /
    `after` / `inRow`). Single positional API across insert and move.
  - **Modern-format row moves carry trailing siblings.** When the
    moved panel is a top-level row with no nested `row.panels[]`, its
    contiguous run of non-row siblings (the panels that implicitly
    belong to it by ordering) moves with it. Legacy rows always carry
    their nested children. Moving a row INTO another row is rejected
    (rows cannot nest).
  - `panel_remove({ dashboard, panelId })` removes a panel from its
    container. Legacy rows are removed together with their nested
    children. Modern rows are removed but their trailing siblings are
    **promoted to no-row status** — they keep their gridPos but lose
    their implicit row affiliation. Matches "delete the section
    header but keep the charts under it" intent.
  - Same `{ dashboard?, errors[] }` return shape as `insert` / `update`
    / `validate`. Original dashboard never mutated.
- **`insertPanel` polish: row-shaped defaults + recursive child ids.**
  Two small fixes inside the existing insert tool:
  - When `panel.type === 'row'` and no `gridPos.w/h` is provided,
    default to `w=24, h=1` (row-shaped) instead of `w=12, h=8`
    (panel-shaped). Previously the LLM had to remember to set those
    or get a strangely-tall section header.
  - When inserting a row with nested `panels[]`, recursively
    auto-assign ids to children that lack them — preserving any
    explicit ids and never colliding with each other or the
    dashboard's existing ids.
- **Eighth MCP tool + library function: `grafana_dashboard_panel_update`
  / `updatePanel`.** Applies a JSON Merge Patch
  ([RFC 7396](https://datatracker.ietf.org/doc/html/rfc7396)) to a
  single panel in a dashboard, identified by id. Use case: the audit
  workflow's fix step ("add a description here", "change the unit",
  "drop the legend format") without rebuilding the panel from scratch
  and losing fields the panel-build tools don't surface (color,
  thresholds, overrides, custom transforms).
  - Patch fields with values overwrite the panel's fields.
  - `null` in the patch clears the corresponding field.
  - Nested objects deep-merge recursively.
  - Arrays replace wholesale (no element-wise merge) — if the LLM
    wants to add one target to a panel with three existing targets,
    it must include all four in the patch.
  - `panelId` lookup walks row-nested panels too. Updating a row
    panel itself works the same way (a row IS a panel).
  - Returns `{ dashboard?, errors[] }` — same shape as `panel_insert`
    and the validators. Original dashboard and patch are never
    mutated (deep clone). Errors surface for unknown `panelId` or
    non-object patches.
  - Verified end-to-end against the Node Exporter Full fixture:
    deep-merge a unit change on a nested panel, validate the result
    clean, original unchanged.
- **Seventh MCP tool + library function: `grafana_dashboard_panel_insert`
  / `insertPanel`.** Adds a panel to an existing dashboard at a chosen
  position without forcing the LLM to reconstruct the full JSON. Four
  position modes:
  - `{mode:"append"}` (default) — bottom of dashboard, top-level.
    `gridPos.y` auto-computed from the max bottom across the entire
    panel tree (including nested panels).
  - `{mode:"gridPos", x, y, w, h}` — explicit placement, honored
    verbatim.
  - `{mode:"after", panelId: N}` — directly below the named panel in
    its container (top-level or `row.panels[]` if nested).
  - `{mode:"inRow", rowId: N}` — make the panel a child of the named
    row. Handles both legacy (push into `row.panels[]`) and modern
    (insert at top level immediately after the row's last following
    sibling, before the next row) formats.
  Returns `{ dashboard?, errors[] }`: the modified dashboard on
  success, `errors` populated on failure (unknown panelId/rowId,
  non-row in `inRow` mode, etc.). The input dashboard and panel are
  never mutated (deep clone). If the incoming panel has no `id`, the
  next free id (max + 1 across the full tree, starting at 1) is
  assigned. Verified end-to-end against the Node Exporter Full fixture:
  insert into a modern-format row succeeds, validates clean.
- **Fifth + sixth MCP tools + library functions: `grafana_dashboard_validate`
  / `grafana_panel_validate` (`validateDashboard` / `validatePanel`).**
  Returns a model-friendly `{ valid, errors[] }` rather than throwing,
  so a validation failure stays inside the LLM's tool-result stream
  where the errors themselves are the useful output. Each
  `ValidationError` has a JSONPath-like `path` (e.g.
  `panels[2].targets[0].expr`) and a short `message`. v0.1.x scope:
  - Required fields: dashboard `title`; per-panel `id`; well-formed
    `gridPos` (numeric `x`/`y`/`w`/`h`) when present.
  - Panel id uniqueness across the full panel tree, including
    legacy-format row-nested panels.
  - Variable reference integrity: `panel.targets[*].expr` / `.query`
    / `.rawQuery` and `panel.datasource.uid` are scanned for `$var`,
    `${var}`, `${var:format}`, and `[[var]]` syntaxes; refs must
    resolve against `dashboard.templating.list[].name` or a Grafana
    built-in (any `$__*` plus the legacy `$timeFilter`).
  - `validatePanel(panel, dashboard?)` runs schema checks alone
    without context, and adds reference checks when a dashboard is
    provided — designed to be called *before* inserting a freshly
    built panel into an existing dashboard.
  - Errors array is capped at 100 entries with `truncated: true` if
    exceeded; `valid` remains meaningful when truncated.
  - Verified clean against the vendored Node Exporter Full fixture
    (141 panels, 16 rows, mixed legacy + modern row formats).
- **Fourth MCP tool + library function: `grafana_dashboard_inspect` /
  `inspectDashboard`.** Reads an existing dashboard JSON and returns a
  structured view at one of three detail levels:
  - `summary` (default) — bounded headline view safe for arbitrarily
    large dashboards: title, uid, panel count, variable names,
    datasource refs, layout bounds, count of panels missing a
    description, top naming-prefix patterns (e.g., `"HTTP: ..."`),
    **and a `rows` list with each row's title, id, and child-panel
    count** so the LLM can discover sections at a glance.
  - `panels` — per-panel rows (id, title, type, description, unit,
    gridPos, datasource, target count, **and `rowId`** so the LLM
    knows which row each panel belongs to). Designed for the audit
    workflow and as the foundation for "add panel to a specific row"
    (PR 11); surfaces `description` as a first-class field.
  - `conventions` — panel-size histogram, top units, top panel types,
    variables, row count. Designed for the "build a new dashboard
    that matches an existing one" workflow.
  Walks both **legacy** dashboards (Grafana ≤7, panels nested inside
  `row.panels[]`) and **modern** dashboards (Grafana ≥8, all panels
  flat at the top level with row membership implied by array order —
  panels following a row panel belong to it until the next row). Real
  dashboards often mix both formats in one file (Node Exporter Full
  has 2 modern-style rows and 14 legacy-nested rows); both are handled
  in a single pass. The tool description tells the LLM which detail
  level to pick for which workflow. Library function is type-safe via
  a discriminated union return (`InspectResult`).
- **`grafana_dashboard_build` MCP tool now accepts an optional `panels`
  array** of panel JSON objects — typically the output of
  `grafana_timeseries_panel_build`. Closes the LLM round-trip: build
  each panel via the panel-build tool, collect the JSON, pass the array
  back into the dashboard-build tool to assemble the dashboard. Input
  schema validates `panels` as an array of objects; the builder layer
  wraps each panel in a `cog.Builder<Panel>` adapter so the SDK's
  `DashboardBuilder.withPanel()` accepts it. Existing single-arg
  (`{ title }`) callers are unaffected.
- **`buildDashboard` library function accepts pre-built panel JSON.**
  `BuildDashboardInput.panels` widened from `cog.Builder<Panel>[]` to
  `(cog.Builder<Panel> | Panel)[]` (exported as `PanelInput`). Callers
  can now mix SDK panel builders and the JSON output of
  `buildTimeseriesPanel()` in the same `panels` array.

## [0.1.0] - 2026-05-16

First public release as `@jburgess/mcp-grafana` on npm. Pre-1.0 — the
API will change as the surface grows; pinning the exact version (or a
tight `~0.1.x` range) is recommended.

### Added
- Package published to npm as `@jburgess/mcp-grafana` (scoped). The bin
  command remains `mcp-grafana` (unscoped) so `npx -y @jburgess/mcp-grafana`
  resolves to the `mcp-grafana` binary.
- npm publishing setup: `.github/workflows/publish.yml` triggered on
  `v*` tag pushes, using **OIDC trusted publishing** (no `NPM_TOKEN`
  secret needed; provenance attached automatically). `package.json`
  gains `publishConfig: { access: public, provenance: true }` and a
  `prepublishOnly` script that runs `clean → typecheck → test → build`.
- Project scaffolding: TypeScript (strict, ES2023, NodeNext), Vitest,
  pnpm via corepack, MIT LICENSE, `engines: ">=22.0.0"`.
- `AGENTS.md` establishing the six-agent review model
  (Grafana / TypeScript / MCP / LLM / Doc Writer / Naysayer), the TDD
  workflow, the documentation contract, the permissive-licensing
  principle, and the no-runtime-LLM-in-core intelligence-layer principle.
- `research.md` capturing the substrate decisions (Foundation SDK,
  Vitest + fast-check, MCP SDK, Zod v4, MIT license, Node 24 / pnpm,
  Grafana 12.x target, intelligence layer architecture).
- README skeleton describing the project intent and state.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) running
  `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and
  `pnpm build` on Node 22 and Node 24 (matrix, `fail-fast: false`).
  Triggers on pushes to `main` and pull requests targeting `main`.
- `buildDashboard({ title })`: the thinnest possible wrapper over the
  Foundation SDK's `DashboardBuilder`. Produces a JSON-serializable
  Grafana `Dashboard` object whose `.title` matches the input. First
  exercise of the Foundation SDK substrate; proves the
  test/typecheck/build pipeline end-to-end with real code.
- `buildDashboard` now accepts an optional `panels` array of SDK panel
  builders (any `@grafana/grafana-foundation-sdk/<panel-type>` subpath:
  `timeseries`, `table`, `stat`, …). Panels are threaded through
  `DashboardBuilder.withPanel()`. The composition shape matches the SDK:
  callers pass builders (not built panels), and we orchestrate. README
  quickstart updated.
- **First MCP tool: `grafana_dashboard_build`.** `src/mcp/server.ts`
  exports `createMcpServer()` which constructs an `McpServer` and
  registers `grafana_dashboard_build({ title })` — a thin adapter over
  `buildDashboard()`. Input schema is a Zod object with `.describe()`
  on every field so descriptions propagate to the LLM's tool view.
- **`mcp-grafana` bin entry.** `src/mcp/stdio.ts` is a 6-line stdio
  runner; `package.json` `"bin"` exposes it as `mcp-grafana`. Users can
  wire the server into Claude Desktop, Cursor, etc. with
  `{"command":"npx","args":["-y","@jburgess/mcp-grafana"]}`. README updated.
- **`./mcp` subpath export** for programmatic embedding
  (`import { createMcpServer } from '@jburgess/mcp-grafana/mcp'`).
- **Tool design conventions** (`research.md` Entry 010) ratified
  alongside the first tool: `domain_noun_verb`, snake_case; Simple +
  Composable + Predictable; tool descriptions are load-bearing.
- **Intelligence-layer architecture pivoted to Option Z** (`research.md`
  Entry 011) — amends Entry 008. Library = thin deterministic
  primitives (parsers, schema builders). Opinions = markdown in
  `docs/guidance/` served via MCP resources. **No `src/inference/`,
  `src/composition/`, or code-based `src/templates/` modules** —
  encoding rules in TypeScript would duplicate LLM training. The
  parameterized builder tools (`grafana_timeseries_panel_build` etc.)
  ARE the templates: caller (LLM or human) constructs the query and
  attributes, we deliver schema-valid JSON.
- **First primitive under Option Z: Prometheus exposition-format
  parser.** `src/ingest/prometheus.ts` exports `parsePrometheusText` →
  `PrometheusMetric[]` with `name`, `type` (counter / gauge / histogram
  / summary / untyped), `help`, `labels` (label → distinct sorted
  values), and raw `samples`. v0 limitations documented: comma/quote
  inside escaped label values isn't handled; histogram bucket grouping
  not yet collapsed; OpenMetrics extensions (`# UNIT`, exemplars)
  deferred.
- AGENTS.md §1.8 reworded for Option Z; AGENTS.md §5 layout updated to
  drop the planned inference/composition/templates modules and add
  `docs/guidance/`.
- **Second MCP tool: `prometheus_metric_parse`.** Thin adapter over
  `parsePrometheusText`. Input: `{ text }`. Returns the structured
  metric definitions as JSON text content. Sets the
  library-primitive→MCP-tool pattern that future tools follow.
  README's MCP tool table updated.
- `test/mcp/server.test.ts` refactored to share a `connectedClient()`
  setup helper plus a `textContentOf()` helper for parsing tool
  responses, used by both tools' tests.
- **Third MCP tool + library function: `buildTimeseriesPanel` /
  `grafana_timeseries_panel_build`.** `src/assets/panel.ts` wraps the
  Foundation SDK's timeseries `PanelBuilder` and Prometheus
  `DataqueryBuilder`; takes `{ title, description?, unit?, targets:
  [{ expr, legendFormat?, refId? }] }` and returns a Grafana `Panel`
  object. **Multi-target by design** — Grafana panels accept multiple
  PromQL expressions on one chart (rate alongside 5xx error rate, for
  example). The MCP tool is a thin Zod-validated adapter over the
  library function. README quickstart shows the new builder; tool
  table extended to three rows.
- Optional input fields on `BuildTimeseriesPanelInput` and
  `PromqlTarget` use `T | undefined` instead of `T` to accommodate
  Zod's `.optional()` shape under `exactOptionalPropertyTypes` strict
  mode.
- `@grafana/grafana-foundation-sdk` pinned exactly to `0.0.12`
  (Apache-2.0). The SDK consolidated post-Grafana-11.6 into a single
  `0.0.x` line targeting Grafana 12+; pre-1.0 semver means each patch
  can carry breaking changes, so we pin exactly and bump deliberately.
  See `research.md` Entry 009.
