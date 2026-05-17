# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Migration notes (pre-0.2)

Pre-release shape changes accumulated during 0.1.x. The interfaces are
not stable yet; entries below are the cases where a 0.1.0-era caller
needs to know what changed before upgrading.

- **`panel_*_build` tools — `datasource` is now a builder input.**
  Old contract: "datasource is patched via `panel_update` after the
  panel is in a dashboard." New: pass `datasource: { uid, type? }` to
  each data-bearing builder. The old patch path still works; the new
  input is preferred. The companion `dashboards.panels.datasourceDeclared`
  lint rule (severity `warn`) catches omissions.
- **Write tools — response shape changes when called with `dashboardUri`.**
  Inline `dashboard` input returns the unchanged `{ dashboard?, errors[], ...rest }`.
  URI input returns `{ uri, summary, errors[], ...rest }` — the full
  modified dashboard does NOT enter the LLM context. Inline-form
  callers are unaffected.
- **`PanelInput` widened to accept `RowPanel` alongside `Panel`.** Row
  inputs are detected by `type === 'row'` and routed through
  `DashboardBuilder.withRow()` (24×1 layout) instead of `withPanel()`
  (12×8). Pre-0.2 callers passing row JSON were silently mislaid; same
  inputs now lay out correctly.
- **`panels.timeseries.legend.calcs` default is set-equal, not
  order-sensitive.** Bare `string[]` matches as a multiset; opt into
  order-sensitivity via `{ expected: [...], match: 'exact' }`.
- **`grafana_dashboard_build` auto-assigns panel ids.** `id: 0`
  (the Foundation SDK's default-init value) is treated as missing and
  reassigned. Non-numeric ids (e.g. `id: "foo"`) are overwritten with a
  fresh integer (Grafana's schema requires numeric ids).
- **Tool count grew 14 → 21.** New: `grafana_row_panel_build`,
  `grafana_stat_panel_build`, `grafana_table_panel_build`,
  `grafana_state_timeline_panel_build`, `grafana_dashboard_load`,
  `grafana_dashboard_export`, `grafana_dashboard_close`. Existing tool
  schemas may have grown new optional fields (`dashboardUri?` on the
  10 dashboard-consuming tools; `datasource?` on the four data-bearing
  builders); all additions are backwards-compatible (callers who
  ignore the new fields keep working).

### Added

- **Doc tidy pass — CHANGELOG consolidation, glossary additions,
  README quickstart refresh (closes team-retrospective gap #2).**
  Three doc-quality items the retrospective surfaced as the second-
  highest-ranked gap.
  - **`[Unreleased]` section structure fixed.** Each PR through 0.1.x
    appended its own `### Added` / `### Changed` / `### Fixed` block,
    leaving the section with eight subsection headers and three
    Added / two Changed / two Fixed duplicates. Keep-a-Changelog
    parsers and release-note generators would have produced duplicate
    sections. Consolidated to one of each, preserving the original
    bullet order (reverse-chronological — newest first within each
    section). A `### Migration notes (pre-0.2)` block at the top of
    `[Unreleased]` surfaces the six pre-release shape changes
    (`datasource` builder input, write-tool URI-form response shape,
    `PanelInput` widening, `legend.calcs` set-equal default, `id: 0`
    reassignment, tool count 14→21) so a 0.1.0 caller upgrading sees
    them without reading 800 lines of bullets.
  - **Glossary additions for the #65 / #59-#64 / team-retro
    vocabulary.** `dashboard registry`, `session URI`, `registry
    slot`, `summary mode`, `EXACTLY ONE OF contract`, `PanelInput`,
    `StatGraphMode` — every term introduced this cycle that an LLM
    or contributor might look up. The pre-existing entries
    (`GrafanaStyleGuide`, `LintIssue`, `PanelsFindFilter`, etc.) had
    grown stale references to "future fields"; left them alone here
    (they were updated in the corresponding feature PRs).
  - **README Quickstart refresh.** Replaced the single-panel
    timeseries snippet (which predated the row / stat / table / state-
    timeline builders and the datasource gap) with a multi-panel
    example using two row headers, a stat panel, and a timeseries
    panel — all with `datasource` set via a templating variable. The
    snippet demonstrates the project's two "set this explicitly"
    conventions (section structure via rows; datasource on every
    data-bearing panel) in the place a new contributor reads first.
    Added a "Working with large existing dashboards" subsection
    showing the `load → URI → export` registry flow with concrete
    tool-call examples and a link to
    `docs/guidance/session-resource-registry.md`. The
    `examples/build-and-inspect.ts` runnable was updated to match
    the new quickstart; its CI test (`test/examples/build-and-
    inspect.test.ts`) now asserts on 4 panels (2 rows + stat +
    timeseries) and a 2-row layout.

- **Datasource gap closed — `datasource` input on panel builders +
  `dashboards.panels.datasourceDeclared` lint rule (closes
  team-retrospective gap #1).** The four data-bearing panel builders
  (`buildTimeseriesPanel`, `buildStatPanel`, `buildTablePanel`,
  `buildStateTimelinePanel`) now accept an optional `datasource:
  DatasourceRef` input — `{ uid?, type? }` — and propagate it through
  to the built panel. The row builder is excluded (rows don't query).
  New `DatasourceRef` type exported from the public API; the call-site
  helper `toSdkDatasource` strips `undefined`-valued keys before
  handing to the SDK so `{uid: undefined, type: 'prometheus'}` doesn't
  serialise the undefined into the panel JSON.

  Paired lint rule `dashboards.panels.datasourceDeclared` fires
  (severity `warn`) on any non-row panel without a usable datasource
  ref — missing field, or empty `{}` with neither `uid` nor `type`.
  Legacy string form (`datasource: "Prometheus"`) and templating-
  variable refs (`{ uid: "$datasource" }`) both pass. Walks legacy
  `row.panels[]` children. The rule closes the "silent broken
  dashboard" failure mode: without it, the LLM round-trip
  `panel_build → dashboard_build → import` produced visually-fine
  dashboards that queried nothing when the Grafana instance had no
  default datasource set.

  Six-perspective triage from the team retrospective converged on
  shipping both surfaces (input + lint) in one PR — the input gives
  the LLM the right knob to set, the lint rule machine-checks that
  it was set. Previously the panel-build descriptions said
  "datasource is patched via grafana_dashboard_panel_update after the
  panel is in a dashboard" — that contract is now reversed: set it on
  the builder; only patch later for narrow updates.

  Updated: skill prose adds a `datasourceDeclared` paragraph and
  bumps the starter JSON; glossary gains a `DatasourceRef` entry and
  extends the `DashboardStyleGuide` shape; `grafana_dashboard_lint`
  tool description names the new rule; the four panel-builder tool
  descriptions strip the now-stale OMITS-line about datasource and
  add a STRONGLY-recommended paragraph pointing at the lint rule.

- **`panels.stat.handlesUnknown` lint rule (closes #56, reshaped).**
  Fires on stat panels with no explicit signal for what to display
  when the value is null or NaN. Without one, Grafana inherits the
  lowest threshold band's colour for null — silently green (or red,
  on a reverse-coloured panel) rather than the "no data" signal
  operators expect. Passes when the panel carries either a
  `fieldConfig.defaults.mappings[]` entry with `type: "special"` and
  `options.match` in `'null' | 'nan' | 'null+nan' | 'empty'`
  (case-insensitive), OR a non-empty
  `fieldConfig.defaults.noValue` string.

  **Reshape from the original `unknownIsGrey` proposal.** The issue
  originally required a colour-tolerance policy (does `#808080`
  count? `#9E9E9E`?). Fixture evidence
  (`test/fixtures/node-exporter-full.json`) showed every real
  null-mapping JSON sets `result.text: "N/A"` with **no `color` field
  at all** — making a colour-equals-grey check overfit a pattern that
  doesn't exist in the wild. The reshape drops the colour
  requirement entirely: the rule checks *presence* of either escape
  hatch, not the colour the panel paints the null value. If a real
  bug surfaces (operator tripped by an explicitly mis-coloured
  null), a sharpened sub-rule lands then. Six-perspective triage
  (Grafana / TypeScript / MCP / LLM / Senior Doc Writer / Naysayer)
  converged on RESHAPE; Naysayer's standing veto on the original
  shape was sustained by the fixture evidence.

  `StatPanelStyle.handlesUnknown?: boolean` slots in next to
  `requiresComparison` (the slice opened by #53 specifically for this
  kind of additive growth). Skill / glossary / starter JSON / tool
  description all updated. The `## What is *not* machine-checked yet`
  mini-section in the skill drops #56 from the list (only #54
  remains).

- **`docs/guidance/session-resource-registry.md` (closes #65 item 4
  and the umbrella).** Workflow guide for the session-scoped dashboard
  registry: when to use registry vs inline, the load → read/write via
  URI → optional export lifecycle, worked examples for both audit-and-
  fix and build-and-verify flows, lifecycle / isolation guarantees,
  and when NOT to use the registry. Served as a read-only MCP
  resource at `mcp://grafana/docs/guidance/session-resource-registry.md`
  via the existing handler. Skill cross-reference added in
  `skills/grafana-style-guide.md`'s "Operational patterns" section.
  Umbrella #65 closes — all four items (foundation, read tools,
  write tools, docs) shipped.

- **`dashboardUri?` argument on five write tools + registry mutation
  (addresses #65 item 3).** `grafana_dashboard_panel_insert`,
  `grafana_dashboard_panel_update`, `grafana_dashboard_panel_move`,
  `grafana_dashboard_panel_remove`, and
  `grafana_dashboard_variable_rename` each now accept either inline
  `dashboard` JSON (today's shape, unchanged response
  `{ dashboard?, errors[], ...rest }`) or a `dashboardUri`. With
  `dashboardUri`, the tool mutates the registry slot in place on
  success and the response shape is
  `{ uri, summary, errors[], ...rest }` — the full modified dashboard
  does NOT enter the LLM context. `summary` mirrors
  `grafana_dashboard_inspect detail:"summary"` so callers can verify
  the change without pulling the dashboard back.
  Tool-specific extras (`rewrites` and `locations[]` on
  `variable_rename`) are preserved on the URI path — they are small
  and useful. Wiring goes through a new `applyWriteResult` helper in
  `src/mcp/registry.ts` plus a new `DashboardRegistry.replace(uri,
  dashboard)` method; every write tool wires identically (one
  resolver + one envelope helper + the existing library function).
  Closes the umbrella's item 3 (item 4 — docs — is the remaining
  open item).

- **`dashboardUri?` argument on five read tools (addresses #65 item 2).**
  `grafana_dashboard_inspect`, `grafana_dashboard_validate`,
  `grafana_panel_validate`, `grafana_dashboard_lint`, and
  `grafana_dashboard_panel_find` each accept either inline `dashboard`
  JSON or a `dashboardUri` (session-registry URI from
  `grafana_dashboard_load`). Mutually exclusive — passing both errors
  with `both-provided`; passing neither (where the dashboard is
  required) errors with `neither-provided`. `grafana_panel_validate`
  additionally permits "neither" since dashboard context is optional
  there (runs schema-only when omitted). Wiring goes through a new
  `resolveDashboardArg` helper in `src/mcp/registry.ts` so every tool
  shares one mutual-exclusion check and one error catalogue — the
  duplication pattern `_internal.ts`'s docstring warns against. Same
  output shape as the inline-dashboard form. `grafana_panel_lint` is
  listed in the umbrella issue but has no `dashboard` parameter; it
  is intentionally NOT wired here and will be revisited if/when it
  grows dashboard context.

- **Session-scoped dashboard registry + `grafana_dashboard_load` /
  `_export` / `_close` MCP tools (addresses #65 item 1).** Keeps
  large dashboard JSON out of the LLM context: `dashboard_load` reads
  a JSON file from disk into a server-side `DashboardRegistry` and
  returns only a URI (`mcp://grafana/session/dashboard/<n>`).
  `dashboard_export` retrieves the JSON when the caller needs to hand
  it back (e.g. to the host's Write tool — §1.8 still applies; this
  server never writes to disk). `dashboard_close` frees a slot
  before session end (idempotent). The registry is one `Map` per
  `McpServer`, and `createMcpServer()` is called per session, so the
  per-session contract is automatic — no teardown hook needed.
  Sequential URI ids (chosen over content-addressable hashing because
  callers may legitimately want distinct slots for the same
  dashboard). Both `register` and `export` deep-clone; in-place
  mutation arrives in item 3 of the umbrella with the write-tool
  `dashboardUri?` wiring. Tool count: 21 (was 18).

- **`buildStateTimelinePanel` + `grafana_state_timeline_panel_build`
  MCP tool (closes #64).** Builds a Grafana state-timeline panel
  (`"type": "state-timeline"`) — the correct visualisation for
  categorical health / status signals across a time window
  (UP/DOWN/DEGRADED, OK/WARNING/CRITICAL). Pre-PR, agents had to use
  timeseries panels for categorical health signals, applying numerical
  interpolation and continuous axes to data that is inherently
  discrete and non-numerical — a real fidelity loss. Accepts
  `{ title, description?, targets, mergeValues?, rowHeight? }`.
  Status-history panels (discrete-time grid) are a separate
  visualisation and explicitly out of scope (no concrete demand yet).
  Title schema is `z.string().min(1)`. New types exported:
  `BuildStateTimelinePanelInput`. Tool count: 18 (was 17).

- **`buildTablePanel` + `grafana_table_panel_build` MCP tool (closes #63).**
  Builds a Grafana table panel (`"type": "table"`) for ranked or
  enumerated data — top-N endpoints by latency, per-service error
  counts, service inventory. Accepts `{ title, description?, targets,
  unit?, filterable? }`. `filterable: true` enables per-column filter
  UI in the table header. Column-level configuration (sort, footer,
  cell display mode, per-column thresholds) is intentionally out of
  scope — apply via `grafana_dashboard_panel_update` after the panel
  is in a dashboard, or shape the data via Grafana transformations.
  Title schema is `z.string().min(1)`. New types exported:
  `BuildTablePanelInput`. Tool count: 17 (was 16).

- **`buildStatPanel` + `grafana_stat_panel_build` MCP tool (closes #62).**
  Builds a Grafana stat panel (`"type": "stat"`) for single-value KPI
  displays — current error rate, SLO status, active alerts count. The
  gap was doubly sharp: the project already ships
  `panels.stat.requiresComparison` (lint rule that fires on stat panels
  missing `options.graphMode`), but the MCP server had no way to
  produce a stat panel — the linter could critique what we couldn't
  build. Defaults `graphMode` to `'area'` (filled sparkline behind the
  number), keeping every freshly-built stat panel compliant with that
  rule out of the box. Callers who genuinely want a bare KPI opt out
  explicitly via `graphMode: 'none'` (the linter then flags it —
  intended). `reduceCalc` propagates to `options.reduceOptions.calcs`
  when set. Title schema is `z.string().min(1)` to surface empty-title
  at the MCP boundary. New types exported: `BuildStatPanelInput`,
  `StatGraphMode`. Tool count: 16 (was 15).

- **`buildRowPanel` + `grafana_row_panel_build` MCP tool (closes #61).**
  Builds a Grafana row panel (`"type": "row"`) — the collapsible
  section header used to group panels into named segments. Rows are
  structural, not data visualisations; without a dedicated builder an
  agent assembling a dashboard via MCP had no way to produce them and
  was forced to use a timeseries panel as a stand-in, producing wrong
  JSON and defeating Grafana's collapsible-section feature. Accepts
  `{ title, collapsed? }`; the optional `collapsed` propagates to the
  Foundation SDK's `RowBuilder.collapsed()` when set, otherwise stays
  at the SDK default. `BuildRowPanelInput` and `buildRowPanel`
  exported from the public API.

  **`PanelInput` widened to accept `RowPanel` alongside `Panel`.**
  `buildDashboard` now detects row-shaped inputs (`type === 'row'` on
  the panel, or on the SDK builder's `internal` slot) and routes them
  through the SDK's `DashboardBuilder.withRow()` (full-width, one-line
  layout) rather than `withPanel()` (12×8 panel layout), so a row
  passed to the build doesn't end up as an oddly-tall section header.
  Row ids are auto-assigned by `assignMissingIds` the same way regular
  panels are. Tool count: 15 (was 14).

- **`panels.stat.requiresComparison` lint rule + new `PanelStyleGuide.stat`
  slice (closes #53).** Fires on stat panels with
  `options.graphMode === 'none'` (the dashboard author's explicit
  opt-out) or absent `graphMode` (provisioned dashboards routinely
  omit it; the safer default is "require the author to opt in to the
  comparison" rather than silently inheriting whatever Grafana's
  current new-panel default happens to be). The sparkline is the
  deterministic comparison signal that mitigates the "aggregate ≠
  summary" failure mode the skill's `## Dashboards` section calls
  out — without it, a stat panel shows just a number, and a number
  without trend context is dashboard-as-snapshot, not monitoring.
  Opens the `PanelStyleGuide.stat` slice for future per-stat-panel
  rules (e.g. issue #56 `unknownIsGrey` once the colour-tolerance
  policy lands). `resolveSlice` disambiguator extended to recognize
  `stat` as a slice-shaped top-level key. Third (and last) of the
  issue #50 SHIP-NOW triage trio.
- **`dashboards.panels.maxRepeat` lint rule (closes #51).** Fires
  when a `repeat by $variable` panel's variable cardinality exceeds
  the configured threshold — mitigates the Cacti-era per-device-page
  anti-pattern. Accepts `number` or `{ max: number }`. Cardinality
  reads from the variable's `options[]` length (excluding the
  synthetic `$__all` option), falling back to `current.value` array
  length (multi-select), then a `+` / `,` split of `current.text`.
  An undefined-variable reference produces a structural finding
  (`severity: warn`, `path: panels[N].repeat`) rather than silently
  passing. Default threshold is skill-prose-only per AGENTS.md §1.8;
  the starter skill ships `10`. First of the issue #50 SHIP-NOW
  triage trio.
- **`dashboards.links.preservesVariables` lint rule (closes #52).**
  Fires on internal dashboard-to-dashboard links (URL path `/d/` or
  `/dashboard/`) that drop **every** templating variable defined on
  the source dashboard. Partial drops (per-pod → per-cluster drill-
  up) are intentional and not flagged; external URLs are ignored.
  Walks both `panel.links[]` and `fieldConfig.defaults.links[]`,
  accepts both `${var}` and `$var` interpolation syntaxes. Findings
  carry `panelId` / `panelTitle` (per PR #46) so consumers can act
  on them directly. New `links` sub-group on `DashboardStyleGuide`;
  additive only. Second of the issue #50 SHIP-NOW trio. Skill prose,
  glossary entry, and `grafana_dashboard_lint` tool description
  updated; the `## What is *not* machine-checked yet` mini-section
  shrinks by two bullets.
- **`dashboards.panels.duplicateTitles` accepts `{ except: string[] }`
  (closes #44 item 2).** Previously a `boolean`; now `boolean | { except?:
  string[] }`. The `except` form exempts intentional duplicates (e.g.
  a KPI stat panel paired with its timeseries trend that share a title
  by convention) without disabling the rule wholesale. Empty `except`
  is equivalent to `true`. The structural shape was chosen over the
  originally-proposed `sameTypeOnly` heuristic per research.md
  Entry 014's deferred extensions — `sameTypeOnly` would have to
  decide whether `bargauge` matches `stat` matches `gauge` and
  baked taste-laden answers into the rule; `except` defers the
  judgment to the user's skill copy. Skill JSON example, glossary,
  and `grafana_dashboard_lint` tool description updated.
- **`skills/grafana-style-guide.md` expanded from panel-only to
  panel-plus-dashboard (v0.1 → v0.2).** Adds a `## Guiding vision`
  section codifying the *top-down, signal-first* philosophy
  (Shneiderman's "overview first, zoom and filter, details on
  demand"; Stephen Few's *at-a-glance monitoring*) and a `## Dashboards`
  section covering: row sequencing (categorical state-timeline
  fold → system-wide RED/USE → per-component pipeline-order triplets
  → drill-down tables), the "aggregate ≠ summary" rule (Tufte's
  service-engine-soon critique), repeating-panel caps (the Cacti-era
  per-device-page anti-pattern), multi-timescale context (MRTG
  tradition via per-panel `timeFrom` overrides), scroll-vs-click
  drill-down with preserved templating variables (`$cluster` →
  `$namespace` → `$instance`), five-state stat-panel semantics with
  the correct Grafana-12 mechanism for `null → grey` (explicit value
  mapping or `noValue`, not threshold inheritance), variance-in-the-
  panel composition (SmokePing tradition), dashboard-shape-as-code
  via monitoring-mixins, and a named anti-patterns catalog
  (*Data-to-Dashboard*, *Green Dashboard Paradox*, *Wall of
  Dashboards*, *Service-engine-soon dashboard*, *Per-device-page
  reincarnated*). A short `## Operational patterns` mini-section
  cross-links the four `mcp://grafana/docs/guidance/*.md` resources
  (skill = opinion, guidance = workflow). References reorganized
  into four sub-headings (corpus, design philosophy, anti-patterns +
  critique, NMS tradition). Process gate from `research.md` Entry 013
  honored: `## Scope` promotes dashboards from "not yet covered" to
  declared v0.2 sub-scope; frontmatter `description` broadened to
  include "building, generating, or reviewing a Grafana panel or
  dashboard" as the selector trigger. The lint primitive's
  machine-checked rules are unchanged; the prose conventions added
  in this PR are review-checklist items until lint catches up
  (called out in a `## What is *not* machine-checked yet` mini-
  section, with candidate rule IDs tracked in #50). Distilled from
  four parallel web-research passes (Grafana exemplars; NMS
  tradition; modern observability literature; information-
  architecture canon — citations in the References section of the
  skill).
- **`findPanels` gains `hasUnit: boolean` filter (issue #43).** Strict
  parallel to `hasDescription`: `hasUnit: true` matches panels with a
  non-empty `fieldConfig.defaults.unit`; `hasUnit: false` matches
  panels missing one (null / undefined / empty-string all count as
  missing, matching the `nonEmptyString` convention). Row panels
  excluded entirely (rows don't carry units), mirroring how
  `hasDescription` excludes rows. Closes the predicted gap that
  `docs/guidance/units.md` documented (audits of "panels with no unit
  set" previously required dropping out of `panel_find` into
  `inspect detail:'panels'` + client-side filter). The guidance doc's
  gap admission is replaced with a `hasUnit: false` example. The
  speculative `hasField: 'path.to.field'` generic extension from
  the issue body was rejected — it's the predicate DSL the team-review
  reshape rejected. The closed set is a budget, not a freezer (the
  Naysayer hook on `PanelsFindFilter` updated to note `hasUnit`
  cleared the bar as the symmetric twin of an existing primitive).
- **Lint findings carry `panelId` and `panelTitle` on panel-scoped
  issues (issue #44.1).** Saves callers a JSON walk to map a path
  like `panels[0].panels[8]` back to the panel id every downstream
  tool (`panel_update`, `panel_find`, `inspect`) keys by. Populated
  by `lintDashboard`'s aggregator from the panel context it already
  has in hand — both `lintPanel` (standalone) and `lintDashboard`
  use the same `LintIssue` shape, but the standalone caller knows
  which panel they passed so the fields are populated only via the
  dashboard-level walker. Dashboard-scoped findings
  (`dashboards.variables.emptyDefault` etc., which resolve to
  templating variables or aggregate state) omit both fields so a
  consumer can tell panel-scoped from dashboard-scoped at a glance.
  `panelTitle` is omitted when the panel has no title set (empty
  string counts as missing, matching the project's `nonEmptyString`
  convention). Optional fields, additive — no behavior change for
  existing consumers. Doc glossary entry on `LintIssue` updated to
  describe both fields and when they appear; MCP tool descriptions
  for `grafana_panel_lint` and `grafana_dashboard_lint` updated
  correspondingly.
- **`examples/` directory with the first CI-tested example
  (`examples/build-and-inspect.ts`).** Mirrors the README's
  Quickstart as a runnable module — exports a `main()` function
  that builds a panel, builds a dashboard, runs `inspectDashboard`,
  and returns both. Exercised by
  `test/examples/build-and-inspect.test.ts` on every CI run; if the
  README's Quickstart promise drifts from the actual code, the test
  fails. Per AGENTS.md §4 "No stale examples. Examples are compiled
  and run in CI." `vitest.config.ts` updated to include
  `test/examples/**/*.test.ts` so future examples drop in with the
  same pattern. The example uses a relative import
  (`../src/index.js`) because it lives in-repo; a top-of-file
  comment tells users to swap in `@jburgess/mcp-grafana` when
  copying into their own project. First file under `examples/` —
  establishes the path future examples (audit-units workflow,
  full-lint workflow, etc.) will follow.
- **`docs/guidance/units.md`, `docs/guidance/descriptions.md`,
  `docs/guidance/thresholds.md` — operational guidance for the three
  audit patterns whose dedicated tools were cut from issue #31** (#4
  `units_audit`, #5 `descriptions_audit`, #6 `thresholds_suggest`).
  Each doc is workflow-shaped (find → loop update → validate),
  cross-links the `bulk-panel-updates.md` pattern, and defers the
  OPINION ("what unit fits this metric? what counts as a good
  description? when should a threshold be set?") to the skill at
  `skills/grafana-style-guide.md`. The thresholds doc carries the
  team-review framing from the cut explicitly — *"the discipline of
  refusing is the value"* — and lists rates / latencies / generic
  percentages as the cases where no threshold should be suggested
  without SLO context. All three served as read-only MCP resources
  at `mcp://grafana/docs/guidance/<name>.md` by the existing
  handler from PR #35; the resource handler's "walk N files"
  contract gains a regression test that asserts the trio appears
  end-to-end via `resources/list`. These three docs close the
  guidance-replacement loop for the #31 cuts: the Naysayer's
  "revisit if telemetry shows the pattern doesn't work" trigger
  from research.md Entry 015 now has somewhere to point.
- **`docs/guidance/bulk-panel-updates.md` (closes #31 item 3 as cut).**
  New guidance document explaining the `panel_find` → loop
  `panel_update` → `validateDashboard` pattern for bulk audit
  workflows. Served as a read-only MCP resource at
  `mcp://grafana/docs/guidance/bulk-panel-updates.md` via the
  existing markdown-resource handler. This is the project's first
  document under `docs/guidance/` — it validates the resource
  handler's "missing directories tolerated silently, light up
  automatically when a file lands" contract from PR #35. A three-
  perspective design pass (Grafana+MCP, TS+LLM, Doc Writer+Naysayer)
  on the originally-proposed `panel_update_bulk` tool concluded:
  cut the tool, ship the guidance instead. The Naysayer's argument
  carried: atomicity is wrong for independent panel-level updates
  (forces retry of N-1 already-correct patches when 1 fails);
  failure attribution is better per-call than batched; composition
  over a new tool per §1.6. Full rationale, the steelman of the
  cut alternative, and the three reviewers' positions are recorded
  in `research.md` Entry 015. Closes the last actionable item on
  issue #31.

- **`findPanels` + `grafana_dashboard_panel_find` MCP tool (issue
  #31 item 10).** Returns panel ids matching a closed-set filter
  (`type` / `unit` / `hasDescription` / `queryMatches`) for use as
  the find half of the audit workflow — "find every timeseries panel
  with unit `short` whose query uses `rate(`" → list of ids → loop
  `panel_update` then call `validateDashboard`. Full pattern in
  `docs/guidance/bulk-panel-updates.md` (research.md Entry 015 cut
  the originally-planned dedicated `panel_update_bulk` tool;
  composition over a new primitive). AND semantics; empty filter
  matches all.
  `queryMatches` is a JS regex (string), capped at 200 characters
  (length only — NOT regex complexity; short pathological patterns
  like `^(a+)+$` can still catastrophic-backtrack, so callers
  should avoid nested quantifiers and overlapping alternations
  regardless of cap). Longer patterns and invalid regex syntax
  return errors rather than running. The `queryMatches` regex
  walks `target.expr` → `.query` → `.rawQuery` and tolerates
  empty-string fields (treating them as missing, matching the
  shared `nonEmptyString` precedent — see Changed entry below).
  Row panels are excluded entirely from `hasDescription` filtering
  (section markers, not visualizations). Walk order matches
  `inspectDashboard` / `lintDashboard`'s precedent (top-level then
  legacy `row.panels[]`) so consumers can rely on stable ordering.
  Panels without an id are skipped — callers can't reference them
  downstream. **Closed filter DSL is enforced at the MCP boundary**
  via Zod's `.strict()`: unrecognised filter keys
  (e.g. `matches:` typo for `queryMatches:`) reject with a
  validation error rather than silently returning "matches every
  panel." This matches the original team-review rationale for
  choosing a closed DSL — without strict, the closed-DSL claim was
  unenforced. New `PanelsFindFilter` and `PanelsFindResult` types
  exported. Tool count: 14 (was 13).
- **`lintDashboard` library function + `grafana_dashboard_lint` MCP
  tool (issue #31 item 1, reshaped per the team-review consensus).**
  Thin aggregator over `lintPanel` — walks every panel (top-level +
  legacy `row.panels[]`), runs the panel-slice rules against each,
  rebases issue paths onto `panels[N].*` so consumers can group by
  panel. The aggregator is intentionally thin: taste-laden heuristics
  from the original wishlist (`title-query-mismatch`, `unit-mismatch`,
  `naming-inconsistency`, `single-step-threshold`) stay in the
  skill's prose per AGENTS.md §1.8 and the team review's reshape
  direction. Panel-level issues come first in the list, then
  dashboard-level issues. Tool count: 13 (was 12). Closes the
  reshape branch of #31 item 1, originally proposed as
  `grafana_dashboard_lint` with a hardcoded rule catalogue.
- **`DashboardStyleGuide` type + `GrafanaStyleGuide.dashboards`
  umbrella key.** New top-level umbrella section configures the
  dashboard-level rules. Three rules currently surfaced, all
  structural (deterministic, no taste in code):
  - `dashboards.panels.duplicateTitles` — fires for non-row panels
    sharing a title. Excludes rows (section markers often share
    titles legitimately) AND panels with `repeat:` set (Grafana's
    repeat feature creates N runtime copies sharing the source
    panel's title by design — flagging it would false-positive on
    every repeat-using dashboard).
  - `dashboards.variables.hiddenButReferenced` — fires when a
    templating variable with `hide: 2` (both label and value hidden
    in the UI) is interpolated in a panel or row title. The exact
    bug case from the original #31 annotation session. Tolerates
    both numeric `hide: 2` and string `hide: "2"` (some round-trips
    coerce). Path is the indexed form `templating.list[N].hide`,
    consistent with `emptyDefault`'s path style.
  - `dashboards.variables.emptyDefault` — fires when a `query`,
    `datasource`, or `interval` variable has no `current.value`.
    Other types (`custom`, `constant`, `textbox`, `adhoc`) are
    exempt because empty is legitimate for them (textbox blank by
    design; adhoc starts with zero filters; constant/custom may
    expect a user choice). The type filter resolves the round-1
    review's "too aggressive" finding.

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

- **`grafana_timeseries_panel_build` tool description now lists what the
  output omits and where to set each field (closes #60).** Previously
  a caller — human or LLM — reading the tool description alone had no
  signal that the output omits `id`, `gridPos`, `datasource`, legend,
  and tooltip; they had no pointer to `grafana_dashboard_panel_update`
  for the post-build patch nor to the
  `mcp://grafana/skills/grafana-style-guide.md` resource for the legend
  convention. Description now contains an "INCLUDES" list and an
  "OMITS (and where to set each)" list with explicit cross-references
  to the right sibling tool / resource for each omitted field. The
  library function `buildTimeseriesPanel` is unchanged. New contract
  test in `test/assets/panel.test.ts` pins the omitted-fields shape so
  the description can't silently drift if a future SDK bump starts
  emitting one of these fields.

- **`panels.timeseries.legend.calcs` default is now set-equal, not
  order-sensitive (closes #44 item 3).** Shape changed from `string[]`
  (order-sensitive) to `string[] | { expected: string[]; match: 'exact'
  | 'set' }`. A bare array is now treated as a **set** (order-
  insensitive, multiset; duplicates count) — the common case is "every
  legend should carry the same aggregations regardless of which column
  came first." To keep the previous order-sensitive behavior, use the
  explicit form `{ expected: [...], match: 'exact' }`; `match: 'set'`
  matches the bare-array default. Subset / superset modes are
  deliberately not supported — the cross-set "which extras are OK?"
  question is taste-laden and belongs in the skill per AGENTS.md §1.8.
  The error message now points at "fork the skill" so users who hit
  the rule for cross-family reasons don't read it as a bug. Pre-release
  shape change — no back-compat shim. Skill JSON, glossary, and
  `grafana_panel_lint` tool description updated.

- **`nonEmptyString` helper lifted into `src/assets/_internal.ts`.**
  The "empty string is missing" pattern bit three reviews in a row
  during the v0.1.x lint work: PR #32 description undercount, PR
  #32 round-2 legendFormat/refId leak, PR #38 expr-fallback
  short-circuit. Each fix used a local copy of the same helper.
  Lifted into the shared internals module once so future sites use
  the same definition of "empty is missing" and don't re-introduce
  the `??` short-circuit bug. `inspect.ts` and `find.ts` now import
  it from `_internal.js`; the local copies are gone. No behavior
  change at call sites; this is a refactor for safety.
- **`lintPanel` now skips row panels for `panels.descriptions.required`.**
  Rows are section markers, not visualizations — they don't have
  descriptions to document. Matches `inspectDashboard`'s existing
  `panelsMissingDescription` convention (already excludes rows).
  Surfaced when `lintDashboard` walked rows and produced spurious
  description-missing issues on every section header. Behavior
  change for `lintPanel` standalone callers passing row panels;
  pre-release so no back-compat concern.
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

- **Dashboards built by `grafana_dashboard_build` / `buildDashboard` now
  pass `grafana_dashboard_validate` without manual id wiring
  (closes #59).** Panels missing a numeric `id` (or carrying `id: 0`,
  the Foundation SDK's default-init value, which Grafana's UI treats
  as unassigned) are auto-assigned sequential integers starting at
  `max(existing ids) + 1` — same `nextFreePanelId` strategy
  `insertPanel` already uses. Legacy row-nested children
  (`row.panels[]`) are walked too. Explicit ids ≥ 1 are preserved and
  never collide with auto-assigned ones. The intended LLM round-trip
  `panel_build → dashboard_build → dashboard_validate` works in three
  calls with no escape hatch.

  Pre-built panel JSON passed to `buildDashboard` is now **deep-cloned**
  on the way in, matching `insertPanel` / `updatePanel`'s immutability
  discipline — the auto-id pass (and the SDK's `gridPos` writeback) no
  longer reaches back through the shared reference and mutates the
  caller's input panel.

  `flatten` and `nextFreeId` from `insert.ts` (cited as "Mirrors X in
  insert.ts" comments in the first draft) are now a single shared pair
  in `_internal.ts` — `walkPanelsDeep` and `nextFreePanelId` — used by
  both the build path and the insert path. Eliminates the duplication
  `_internal.ts`'s own docstring warns about (the `remove.ts` id-less
  false-match was the original cautionary tale). Tool description for
  `grafana_dashboard_build` updated to call out the auto-id behaviour,
  the row-nested walk, and the deep-clone guarantee.

- **`findPanels` silently accepted unknown filter keys at the library
  entry point (issue #42).** The MCP boundary's `z.object({...}).strict()`
  schema (PR #38) rejected typos like `matches:` (typo of
  `queryMatches:`) at the tool-call boundary, but direct library
  callers — `import { findPanels } from '@jburgess/mcp-grafana'` —
  bypassed that guard entirely. `findPanels({}, { typoKey: 'foo' })`
  returned every panel in the dashboard with no errors, contradicting
  the function's own JSDoc and the closed-DSL design's stated
  rationale (the "Naysayer hook" in `find.ts`). Same failure mode the
  closed-DSL was specifically chosen to prevent. New
  `ALLOWED_FILTER_KEYS` set co-located with the `PanelsFindFilter`
  interface, typed as `keyof PanelsFindFilter` so TS rejects entries
  that aren't real fields. The library function now validates filter
  keys at the entry point, emitting one structured error per unknown
  key with `path: filter.<key>` and the list of allowed keys in the
  message. MCP-boundary `.strict()` kept as defense in depth.

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
