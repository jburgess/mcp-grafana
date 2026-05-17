# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **AGENTS.md §6.1: umbrella-issue pattern explicitly recognised.**
  Reshaped the closing-keyword discipline section after a three-agent
  team review (LLM Expert + Doc Writer + Naysayer, all converging) of
  a proposal to require strict `Closes #N` on every PR. The team
  rejected the strict rule on three grounds: (1) it would have forced
  #31 (a 14-item friction report) to be filed as 14 separate issues
  *before* the team-review consensus existed to decompose it; (2) it
  would have fragmented the §1.8 / Entry 011 citations justifying
  the cut items across five disconnected `wontfix` issues, destroying
  the comparative reasoning; (3) it added a per-wishlist tax (~10
  issues filed per session) without solving a named failure mode in
  the current `Addresses #N` pattern. The reshape preserves the
  umbrella shape as legitimate, adds structural discipline (named
  items in PR descriptions, a single pinned status comment on the
  parent, final summary close per the #9 precedent), and explicitly
  bumps the trade-off note (umbrella issues are less legible to
  automated GitHub tooling — release-note generators, "Closed by"
  cross-references — than strict 1:1; the `umbrella` label + pinned
  status comment cap that cost).

### Added
- **`lintPanel` library function + `GrafanaStyleGuide` /
  `PanelStyleGuide` type system (issue #25 §1–§2).** New primitive
  `lintPanel(panel, guide): LintResult` reports style-axis issues at
  `warn` / `info` severity (never `error` — that axis belongs to
  `validateDashboard`). Initial rules: `panels.units.allowList`,
  `panels.units.deny`, `panels.descriptions.required` (empty-string
  description counts as missing, matching `inspectDashboard`'s rule),
  and `panels.timeseries.legend.placement` / `displayMode` / `calcs`
  (calcs is order-sensitive — Grafana renders reducers in array order).
  Rule ids are JSONPath dotted paths into the umbrella; namespace is
  additive — future panel types (stat, table, gauge, heatmap) and
  cross-type rule families grow by addition. Exported types per
  `research.md` Entry 013: `GrafanaStyleGuide` umbrella,
  `PanelStyleGuide` slice (`{ timeseries?, units?, descriptions? }`),
  `TimeseriesPanelStyle`, `TimeseriesLegendStyle`, `UnitStyleGuide`,
  `DescriptionStyleGuide`, `LintIssue`, `LintResult`. **No** bare
  `StyleGuide` export (vetoed by the TypeScript Expert: collides with
  Storybook / ESLint vocabulary and erases the Grafana domain at the
  import site). **No** `defaultStyleGuide` constant — opinion lives
  in the skill, not in code.
- **`grafana_panel_lint` MCP tool (issue #25 §3).** Single tool with
  two required inputs: `{ panel, styleGuide }`. Accepts either a full
  `GrafanaStyleGuide` umbrella (`{ panels: { ... } }`) or the
  `PanelStyleGuide` slice directly; the resolver unwraps `.panels`
  when present and refuses ambiguous shapes (both umbrella + slice
  keys at the top level) rather than silently dropping one. Malformed
  guides (`{ panels: 5 }`, `{ panels: null }`) surface a single
  `panels.shape` issue rather than silently returning
  `{ issues: [] }` — the worst-possible failure mode for a lint tool
  is to report "no issues" on a broken guide. Tool does NOT
  auto-apply to `grafana_timeseries_panel_build` output and does NOT
  reject panels that violate the guide (AGENTS.md §1.6 + LLM Expert).
  Tool count: 12 (was 11).
- **MCP resource handler for skill + guidance markdown (issue #25 §4).**
  New module `src/mcp/resources.ts` exports
  `registerMarkdownResources(server)` which discovers every
  `skills/*.md` and `docs/guidance/*.md` file in the installed package
  and registers each as a read-only resource at the URI shape from
  `docs/conventions/mcp-resource-uris.md`
  (`mcp://grafana/skills/<name>.md`,
  `mcp://grafana/docs/guidance/<name>.md`). Discoverable via
  `resources/list`. Content loaded fresh per request so a skill edit
  reflects without a server restart. Missing directories tolerated
  silently — `docs/guidance/` doesn't exist yet but will light up
  automatically when the first guidance file lands. Per AGENTS.md §1.8
  there is **no** companion write tool.
- **Skill JSON restructured to match the slice shape.** The
  illustrative JSON in `skills/grafana-style-guide.md` had `units` and
  `descriptions` as siblings of `panels` at the umbrella root; they
  now nest under `panels.*` so the `PanelStyleGuide` slice that
  `lintPanel` consumes is self-contained. The placeholder
  `"$schema": "https://mcp-grafana.dev/style-guide.v1.json"` was
  removed (the domain does not resolve and the hosting decision is
  deferred per `research.md` Entry 013 open-questions resolution).
  Pre-release; no back-compat shim — v0 JSON was flagged as
  illustrative in the skill body. README "Grafana style skill"
  section updated to reflect that the lint primitive and the resource
  are now live rather than forthcoming. **Closes #25.**
- **MCP resource-URI naming convention doc (closes #29).** New file
  [`docs/conventions/mcp-resource-uris.md`](./docs/conventions/mcp-resource-uris.md)
  codifies the file-and-frontmatter parity rule for `skills/*.md`
  (file name MUST equal frontmatter `name`; MCP URI is
  `mcp://grafana/skills/<name>.md`; "stutter" with the `grafana/`
  authority is accepted as the cost of parity) and the simpler rule
  for `docs/guidance/*.md` (file name is source of truth; no
  frontmatter; URI is `mcp://grafana/docs/guidance/<name>.md`; no
  `grafana-` prefix). Cross-cutting: all skill / guidance files are
  read-only via the resource handler; no write tool, no installer
  that targets a specific filesystem path. Linked from `AGENTS.md`
  §1.8 and from `research.md` Entry 013's "Naming and scope:
  resolution" subsection (which #29 referenced as Entry 012 — that
  reference was stale from before the renumber that ratified Entry
  013 as the panel-style entry).
- **Glossary (closes #30).** New file
  [`docs/glossary.md`](./docs/glossary.md) defines **skill** (file
  shape: markdown + frontmatter under `skills/`, Anthropic Agent
  Skills format), **style guide** (content type: opinion about how
  an asset should look; machine-readable form is `GrafanaStyleGuide`
  JSON), **style skill** (informal shorthand for a skill carrying a
  style guide), **guidance** (project-authored markdown under
  `docs/guidance/` served as MCP resources, distinct from
  user-installable skills), and **StyleGuide (JSON shape)** (the
  machine-readable form consumed by `lintPanel`). The three near-
  synonyms (skill / style guide / style skill) now layer cleanly so
  a new contributor doesn't trip over them. Per AGENTS.md §4's
  "what must exist" list.
- **AGENTS.md §6.1: closing-keyword discipline for issue auto-close.**
  Adds explicit guidance that PRs resolving an issue should use a
  GitHub closing keyword (`Closes #N` / `Fixes #N` / `Resolves #N`),
  but PRs addressing only a subset of a multi-item issue must NOT —
  the pattern in that case is a status comment on the parent issue
  with the parent staying open. Surfaced after a session where the
  initial PRs for issue #31 omitted closing keywords (because they
  addressed a subset), creating ambiguity about whether the parent
  should close. Documented in the Definition-of-Done checklist so
  future agent sessions see it.
- **`inspectDashboard` `detail: 'panels'` now surfaces panel query
  targets (issue #31 item 7).** Each panel row carries a
  `PanelTarget[]` with `expr` / `legendFormat` / `refId` / `hide` /
  `truncated`, so audit workflows no longer need a follow-up read of
  the raw dashboard JSON to see what a panel queries. The `expr` field
  falls back across the common datasource query field names (`expr` →
  `query` → `rawQuery`, matching the precedent in `validate.ts`) so
  non-Prometheus targets surface too. Empty strings are treated as
  missing on each fallback step — the bug from the description fix
  doesn't recur on the target side. Each `expr` is capped at 512 JS
  string-length units with a trailing `…` marker; the cap is
  surrogate-pair-safe (no split UTF-16 pair → no invalid JSON on
  emoji or CJK extension at the boundary). When truncated,
  `truncated: true` is set on the target so consumers detect the cut
  without inspecting the suffix — mirrors `ValidationResult.truncated`.
  `hide: true` marks temporarily-disabled targets so audit consumers
  don't conflate them with active queries. Targets with no extractable
  signal (no expr / legendFormat / refId / hide) are skipped to keep
  the output noise-free; the parent row's `targetCount` still reports
  the raw array length. New `PanelTarget` type exported from the
  public API.
- **`inspectDashboard` `detail: 'conventions'` gains `statGraphModes`
  and `statColorModes` histograms (issue #31 item 12).** Tallies
  `options.graphMode` and `options.colorMode` across stat panels — so
  a reviewer doesn't grade a stat-heavy dashboard as flat KPI when
  it's actually KPI-with-trend (the original case from #31 that
  initially produced a B− on a dashboard whose stat panels all had
  sparkline graphMode). Stat-only because the modes are stat-panel
  options; other panel types have mode-ish fields too but stat is the
  type whose mode swings the panel's visual identity hardest. Both
  histograms are always present (empty `{}` when nothing applies) so
  consumer code can index without guarding.
- **`renameVariable` and `grafana_dashboard_variable_rename` MCP tool —
  atomic, escape-safe rename of a templating variable across a dashboard
  (issue #31 item 2).** Sidesteps the entire class of
  shell-out-and-sed bugs where `\$` gets mangled and silently breaks
  dozens of expressions while the templating list says "done."
  Recognizes all four Grafana interpolation syntaxes and preserves the
  form (`$name → $new`, `${name} → ${new}`, `${name:csv} → ${new:csv}`,
  `[[name]] → [[new]]`, `[[name:csv]] → [[new:csv]]`); word-boundary
  aware (`$foo` doesn't match inside `$foobar`). Rewrites:
  `templating.list[i].name` (and the matching `label`), other
  variables' `query` / `definition` / nested `query.query` /
  `query.datasource.uid` / `current.text` / `current.value`, every
  panel target's `expr` / `query` / `rawQuery`, datasource refs (string
  and object.uid forms — panel-level and per-target), panel and row
  titles and descriptions, and the `repeat` field (exact-match, since
  it names a variable rather than interpolating it). Walks legacy
  `row.panels[]` recursively. Returns
  `{ dashboard?, errors[], rewrites, locations[] }` — same
  `{dashboard?, errors[]}` shape as `insertPanel`/`updatePanel`, plus
  the rewrite count and JSONPath location list (walk order) for audit
  and verification. Errors on unknown `oldName`, collision with an
  existing variable, or `newName` that violates Grafana's
  `[a-zA-Z_][a-zA-Z0-9_]*` rule. Renaming to the same name is a
  no-op success with `rewrites=0`. Less-common reference sites are
  deferred (annotations, links, transformations, overrides,
  custom-variable options) — listed in the MCP tool description so
  consumers see the boundary at call time; the validate-after-rename
  invariant test exercises the walker against the real Node Exporter
  Full fixture (141 panels, mixed legacy/modern format). Function
  named `renameVariable` to match the `verb + DirectObject` convention
  used by `insertPanel` / `updatePanel` / `movePanel` / `removePanel`.
  New `RenameVariableResult` type exported.
- **Grafana style skill (reference, not default).**
  `skills/grafana-style-guide.md` ships as a copyable starter style
  guide for Grafana, modeled on the kubernetes-mixin and
  monitoring-mixins corpus. Anthropic Agent Skills format
  (frontmatter + prose) with an explicit `## Scope` section
  declaring v0.1 = panels (units, legends, thresholds, titles,
  descriptions) and listing what is not yet covered (dashboards,
  alert rules, recording rules, folder taxonomy). The body includes
  an illustrative `StyleGuide` JSON block intended for the
  forthcoming `lintPanel` / `grafana_panel_lint` primitive, with the
  type system planned to grow `GrafanaStyleGuide` (umbrella) and
  `PanelStyleGuide` (slice) so the lint primitive takes the narrow
  slice as the rules broaden (tracked in #25). The skill is the
  *only* place opinion lives; mcp-grafana exports no
  `defaultStyleGuide` constant and does not bundle a default profile
  in code. Users copy the file into their own LLM tool's skills /
  rules directory and own the copy from then on — the project does
  not auto-update installed copies. README adds per-client on-ramps
  (Claude Code, Cursor, generic MCP, paste-into-prompt). Ratified in
  [`research.md`](./research.md) Entry 013 — see that entry for the
  six-perspective debate, the rejected alternatives (no
  `defaultStyleGuide`, no named methodology profiles, no
  `defineRule` plugin, no filesystem-write tool), the rename
  rationale (skill filename matches frontmatter `name`), and the
  agent-by-agent acceptance.
- **Integration test suite against real Grafana 12.4.** Boots
  `grafana/grafana:12.4.0` via [Testcontainers](https://testcontainers.com/),
  POSTs our generated dashboard JSON to `/api/dashboards/db`, and
  asserts the response. Covers: `buildDashboard` from scratch, empty
  dashboards, the real Node Exporter Full fixture (141 panels, 16
  rows, mixed format) as-is and after each of `insertPanel` /
  `updatePanel` / `movePanel` / `removePanel`, plus a negative case
  (no title) that verifies the suite has teeth. Lives at
  `test/integration/` and runs via `pnpm test:integration` — separate
  from `pnpm test` so the unit suite stays Docker-free and ~1s.
  Skips with a clear console message if Docker isn't reachable on the
  host. CI job (Linux only) makes this required on every PR.
  Research entry 012 documents the architecture decision and the
  AGPL-licensing review (per AGENTS.md §1.7 dev-only-tooling exemption).
- **Empirical finding from the integration suite:** Grafana 12.4
  accepts the Foundation SDK's `schemaVersion: 42` output (Grafana 13's
  number). The previously-feared schemaVersion drift is real but
  forward-compatible on Grafana 12.4 — not a correctness blocker.
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

### Changed
- **Helpers (`asDict` / `asArray` / `asString` / `asNumber` / `panelId` /
  `panelGridPos` / `deepClone`) consolidated into `src/assets/_internal.ts`.**
  Previously duplicated verbatim across `inspect.ts`, `validate.ts`,
  `insert.ts`, `update.ts`, `move.ts`, `remove.ts` — six copies of the
  same code, which is how the `remove.ts` bug above slipped in. One
  source of truth across all mutation tools. Net deletion of ~110 lines
  of production code with no behavior change for the public API.
- `AGENTS.md` §1.8 names both delivery modes for markdown guidance:
  `docs/guidance/*.md` for project-authored guidance and `skills/*.md`
  for user-installable shareable opinions (Anthropic Agent Skills
  format). §5 repository layout lists the `skills/` directory at the
  top level alongside `examples/`.
- README's "Why this exists" matches
  [`research.md`](./research.md) Entry 011's primitives-plus-guidance
  framing (parsing, validating, walking are primitives; RED / USE /
  panel-style opinions are markdown the model reads), in place of the
  older "deterministic heuristics" wording that predated Entry 011.

### Fixed
- **`inspectDashboard` no longer undercounts panels with empty-string
  descriptions (issue #31 item 11).** `panelsMissingDescription` in the
  `summary` view and the `description` field in the `panels` view now
  treat `null | undefined | ""` uniformly as "missing", matching how
  Grafana's UI renders both states. Previously, panels that had been
  touched by the UI sometimes carried `description: ""` and were
  silently counted as having a description, undercounting the real gap
  on real dashboards. Behavior-change note for consumers: the count
  may rise on unchanged dashboards that contain empty-string-described
  panels — the underlying gap is unchanged; only the count is honest now.
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
  version. Read at module load from `package.json` via the
  `dist/mcp/server.js` → `../../package.json` relative path, which
  resolves correctly in both source and installed-package layouts. A
  test asserts equality with `package.json` to prevent drift.

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
