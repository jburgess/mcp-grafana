# Glossary

Terms used across the mcp-grafana codebase, docs, and PR
descriptions. Where two terms are near-synonyms, this glossary
disambiguates them.

## guidance (project-authored)

A markdown file under `docs/guidance/` served as an MCP resource via
the project's resource handler. Project-authored — the project owns
the prose, and clients read it at runtime without copying anything to
their filesystem. Distinct from **skills** (which are user-installable
copies users own from then on). Examples: RED-method patterns,
USE-method patterns, naming conventions, query patterns. See
`AGENTS.md` §1.8 and the MCP resource-URI convention in
[`docs/conventions/mcp-resource-uris.md`](./conventions/mcp-resource-uris.md).

## skill

A markdown file under `skills/` with YAML frontmatter (`name`,
`description`) conforming to the
[Anthropic Agent Skills format](https://www.anthropic.com/news/agent-skills).
A skill is a user-installable, shareable opinion: users copy the file
into their own LLM tool's skills / rules directory (Claude Code,
Cursor, generic MCP, etc.) and own the copy from then on — the
project does not auto-update installed copies. The file name MUST
equal the frontmatter `name` value; see the MCP resource-URI
convention in
[`docs/conventions/mcp-resource-uris.md`](./conventions/mcp-resource-uris.md)
for the full rule. The reference skill in this project is
`skills/grafana-style-guide.md`.

## style guide

A *content type* — opinion about how an asset should look (units,
legends, thresholds, axis labels, titles, descriptions). Carried by a
skill, but the term "style guide" refers to the *content*, not the
file. The machine-readable form of a style guide is the
`GrafanaStyleGuide` JSON shape (umbrella) and its slices
(`PanelStyleGuide`, etc.). See `research.md` Entry 013 for the
six-perspective debate that produced this shape; see [issue
#25](https://github.com/jburgess/mcp-grafana/issues/25) for the
implementation tracking.

## style skill

**Informal shorthand** for a skill whose content type is a style
guide. `skills/grafana-style-guide.md` is the project's reference
style skill — a skill (the file shape) carrying a style guide (the
content type). The README's "Grafana style skill" section uses this
shorthand. The three terms are not synonyms; they layer:

- **skill** = file shape (markdown + frontmatter under `skills/`).
- **style guide** = content type (opinion about asset appearance).
- **style skill** = the combination — a skill carrying a style guide.

## GrafanaStyleGuide (umbrella type)

The machine-readable form of a **style guide**, consumed by the
`lintPanel` library function and the `grafana_panel_lint` /
`grafana_dashboard_lint` MCP tools. Exported root type is
`GrafanaStyleGuide` (umbrella, namespaced
`{ panels?: PanelStyleGuide; dashboards?: DashboardStyleGuide }`).
Future revisions add sibling keys (`alertRules?`, etc.) — additive
only. The library deliberately does **not** export a bare
`StyleGuide` type — it collides with Storybook / ESLint vocabulary
and erases the Grafana domain at the import site. See `research.md`
Entry 013.

## PanelStyleGuide (slice type)

The slice `lintPanel` consumes — everything needed to lint one panel.
Shape: `{ timeseries?: TimeseriesPanelStyle; stat?: StatPanelStyle; units?: UnitStyleGuide;
descriptions?: DescriptionStyleGuide }`. Cross-type rules (`units`,
`descriptions`) live nested under `panels.*` rather than as siblings
at the umbrella root, so the slice is self-contained. Rule ids are
JSONPath dotted paths into the umbrella — e.g. `panels.units.allowList`,
`panels.timeseries.legend.placement`.

## TimeseriesLegendStyle.calcs (field shape)

Two accepted shapes for the `panels.timeseries.legend.calcs` rule:

- `string[]` — bare array. **Set-equal match** (order-insensitive,
  multiset; duplicates count). New default per issue #44.3 — the
  common case is "every legend should carry the same aggregations
  regardless of column order."
- `{ expected: string[]; match: 'exact' | 'set' }` — explicit form.
  `match: 'exact'` opts into order-sensitivity (Grafana renders
  reducers in array order, so order can matter when the team cares);
  `match: 'set'` matches the bare-array default.

Subset / superset match modes are deliberately not supported — the
cross-set "which extras are OK?" question is taste-laden and belongs
in the skill prose per AGENTS.md §1.8. The error message for a
mismatch points at "fork the skill copy and carry both" so users who
hit the rule for cross-family reasons don't read it as a bug. See
research.md Entry 014's deferred extensions for the team review.

## StatPanelStyle (slice type)

The per-type slice consumed by `lintPanel` when `panel.type === 'stat'`.
Issue #53 opened the slice with `requiresComparison?: boolean` —
fires `panels.stat.requiresComparison` when a stat panel's
`options.graphMode` is `'none'` or absent. The sparkline is the
deterministic "comparison signal" the issue #50 team-review triage
settled on as the kernel of the aggregate-needs-comparison rule;
previous-period delta and small-multiple variants don't have a
single JSON path and stay in the skill prose. Absent `graphMode`
fires too — provisioned dashboards routinely omit the field, and
the safer default is "require the author to opt in" rather than
silently inheriting whatever Grafana's current new-panel default
happens to be.

Issue #56 added `handlesUnknown?: boolean` — fires
`panels.stat.handlesUnknown` when a stat panel has no
`mappings[]` special-null entry AND no `noValue` string. Reshaped
during triage from the original `unknownIsGrey` proposal: fixture
evidence (`test/fixtures/node-exporter-full.json`) showed real
null-mapping JSON sets `result.text` and omits the `color` field
entirely, so the colour-tolerance policy the original shape required
would have overfit. The rule checks *presence* of either escape
hatch — not the colour. If a real bug surfaces (operator tripped by
an explicitly mis-coloured null), a sharpened sub-rule lands then.

## DashboardStyleGuide (slice type)

The slice `lintDashboard` consumes for the dashboard-level rules that
can't be checked per-panel. Shape: `{ panels?: { duplicateTitles?:
boolean | { except?: string[] }; maxRepeat?: number | { max: number };
datasourceDeclared?: boolean }; variables?: { hiddenButReferenced?:
boolean; emptyDefault?: boolean }; links?: { preservesVariables?:
boolean } }`. Each rule is an opt-in toggle. `duplicateTitles`
accepts `true` / `false` for the simple case, or `{ except: [titles...] }`
to exempt intentional duplicates (e.g. a KPI stat next to its
timeseries trend) — the structural `except` shape was chosen over a
heuristic `sameTypeOnly` knob per research.md Entry 014's deferred
extensions. `maxRepeat` (issue #51) caps `repeat by $variable`
cardinality at N; cardinality reads from the variable's `options[]`,
then falls back to `current.value` array length, then a `+`/`,`-split
of `current.text`. The synthetic `$__all` option is excluded from the
count. `preservesVariables` (issue #52) flags internal dashboard-to-
dashboard links (`/d/`, `/dashboard/` paths) that drop **every**
referenced templating variable — partial drops (per-pod → per-cluster
drill-up) are intentional and not flagged. `datasourceDeclared`
(team-retrospective gap) flags non-row panels with no usable
`datasource` ref — missing field or empty `{}`. Templating-variable
refs (`{ uid: '$datasource' }`) pass; row panels excluded. Catches
the "silent broken dashboard" case where Grafana falls back to the
instance default and finds none. Surfaces only structural,
deterministic checks; heuristic / taste-laden rules (title-query
mismatch, naming inconsistency, threshold sanity) stay in the skill's
prose per AGENTS.md §1.8.

## LintIssue / LintResult

Return shape of `lintPanel` / `grafana_panel_lint` (single panel) and
`lintDashboard` / `grafana_dashboard_lint` (whole dashboard). A
`LintIssue` carries `{ path, ruleId, severity: 'warn' | 'info', message,
panelId?, panelTitle? }`:

- `path` — JSONPath into the panel (e.g. `$.fieldConfig.defaults.unit`,
  `$` for the panel itself, `$styleGuide.*` for issues about the
  guide itself); the dashboard-level aggregator rebases this onto
  `panels[N].*` so consumers can group by panel.
- `ruleId` — dotted path into the umbrella StyleGuide (e.g.
  `panels.units.allowList`, `dashboards.panels.duplicateTitles`).
- `severity` — always `warn` or `info`. **Never `error`** — the error
  axis belongs to `validateDashboard` / `validatePanel`. See
  **ValidationError / ValidationResult** below.
- `panelId` / `panelTitle` (issue #44.1) — present on panel-scoped
  findings, absent on dashboard-scoped ones (`dashboards.*` rules
  that resolve to templating variables or aggregate panel state).
  Lets callers act on the result directly via `panel_update` /
  `panel_find` / `inspect` — all of which key by id, not by JSON
  path. `panelTitle` is absent when the panel has no title set.

The result is `{ issues: LintIssue[]; truncated?: true }`; `truncated`
is set when the issues list was capped at 100.

## ValidationError / ValidationResult

Return shape of `validateDashboard` / `validatePanel`. Distinct from
`LintIssue` / `LintResult` — validation is the schema axis ("would
Grafana accept this dashboard?"); linting is the style axis ("does
this match the team's conventions?"). Conflating them would lose
the severity distinction the two axes carry.

Current checks (`validateDashboard`): required fields
(`dashboard.title`; per-panel `id`); gridPos well-formedness; panel
id uniqueness across all panels (including row-nested); target refId
uniqueness within each panel (Grafana refuses to import duplicate
refIds on the same panel); variable reference integrity (panel
queries and datasource refs resolve against
`dashboard.templating.list`, plus Grafana built-ins like
`$__rate_interval`). `validatePanel(panel, dashboard?)` runs schema +
refId checks alone without context; adds variable-ref checks when a
dashboard is provided.

## DatasourceRef (panel-builder input type)

Optional datasource reference accepted by `buildTimeseriesPanel`,
`buildStatPanel`, `buildTablePanel`, and `buildStateTimelinePanel`
(row builder excluded — rows don't query). Shape:
`{ uid?: string; type?: string }`. The `uid` is a Grafana datasource
UID (`'prometheus-prod'`), a built-in alias (`'-- Mixed --'`), or a
templating-variable reference (`'$datasource'`) for multi-environment
dashboards where the source resolves at render time. The `type`
(`'prometheus'`, `'loki'`, `'tempo'`, …) is informational; Grafana
resolves by `uid` and uses `type` for query-editor selection.

Omitting `datasource` on a data-bearing panel triggers Grafana's
instance-default fallback at render time. If no instance default is
set, the panel queries nothing and renders blank — the "silent broken
dashboard" failure mode the `dashboards.panels.datasourceDeclared`
lint rule catches. Always set explicitly (literal UID or templating
variable); never rely on the instance default.

## PanelsFindFilter / PanelsFindResult

Input and return shapes of `findPanels` / `grafana_dashboard_panel_find`.
`PanelsFindFilter` is a **closed-set** filter:
`{ type?, unit?, hasDescription?, queryMatches? }`. Fields AND
together; empty filter matches every panel. Unrecognised keys
reject at the MCP boundary (Zod `.strict()`) rather than silently
returning "matches every panel" — closed DSL was chosen specifically
to surface typos like `matches:` instead of `queryMatches:`. The
`queryMatches` regex pattern is capped at 200 characters in length
(not complexity — short pathological patterns can still
backtrack). Result is `{ panelIds: (number | string)[]; errors:
ValidationError[] }`; ids in dashboard walk order, panels without an
id are skipped, row panels are excluded entirely from
`hasDescription` filtering. Additions to the filter set are a
public-API commitment — the closed set is a budget, not a freezer.

## nonEmptyString (internal helper)

Shared `_internal.ts` helper that returns `undefined` when the input
is not a string OR is the empty string. Use this when the project
convention is "absent and empty are semantically the same" —
Grafana's UI renders `description: ""` and a missing description
identically, so rules like "description is required" and "fall back
to next field if expr is empty" both consume this helper. Lifted
into `_internal.ts` after the same `??` short-circuit bug recurred
across three reviews (PR #32 description, PR #32 round-2
legendFormat, PR #38 expr fallback) — the shared definition
prevents a fourth instance.

## dashboard registry (`DashboardRegistry`)

Per-session, in-memory store for parsed dashboard JSON. One `Map`
instance per `McpServer` — and the MCP host creates one server per
session, so the per-session contract is automatic (no teardown hook).
Built to keep large dashboards (`test/fixtures/node-exporter-full.json`
is 15k lines, ~50–70k tokens) out of the LLM context: callers
`grafana_dashboard_load` the file once, receive a **session URI**,
and pass that URI to every dashboard-consuming read / write tool
instead of inlining the JSON on each call. The full JSON enters
context only via an explicit `grafana_dashboard_export` step at the
end, if at all. See `docs/guidance/session-resource-registry.md` for
the workflow guide and umbrella issue #65 for the design.

## session URI

A registry slot identifier of the form `mcp://grafana/session/dashboard/<n>`,
returned by `grafana_dashboard_load` (and any future sibling source
like `grafana_dashboard_fetch`). `<n>` is a sequential per-registry
counter starting at 1 — sequential rather than content-addressable
so distinct loads of the same dashboard get distinct slots (legitimate
use case: modify-and-diff workflows). URIs are tool-result strings, NOT
registered with the MCP SDK's `resources/list` mechanism — registering
50k-token dashboards as listable resources would defeat the entire
purpose. URIs from one session do **not** resolve in another (enforced
by the per-server `DashboardRegistry` instance).

## registry slot

A single dashboard's storage in the `DashboardRegistry`, keyed by its
session URI. Holds the parsed JSON. Mutated in place by the five write
tools (`panel_insert`, `_update`, `_move`, `_remove`, `variable_rename`)
when called with `dashboardUri`. Freed by `grafana_dashboard_close`
(explicit) or by session end (automatic, via `McpServer` discard).
`DashboardRegistry.register` and `.export` deep-clone on the relevant
boundary so caller mutation of an exported dashboard cannot reach back
to the slot's authoritative copy. `.replace` (used by `applyWriteResult`)
also clones — same discipline.

## summary mode (write-tool URI-path response)

The bounded response shape returned by the five write tools when
called with `dashboardUri`: `{ uri, summary, errors[], ...rest }`.
`summary` mirrors `grafana_dashboard_inspect detail:"summary"` — the
bounded headline view (title, panel count, variable names, layout
bounds, etc.). Lets the caller verify a write succeeded without
pulling the full modified dashboard back into context. Tool-specific
extras (`rewrites`, `locations[]` on `variable_rename`) flow through
in `...rest` because they're small and useful. Inline `dashboard`
callers continue to receive today's `{ dashboard?, errors[], ...rest }`
shape unchanged.

## EXACTLY ONE OF contract (`resolveDashboardArg`)

Every dashboard-consuming tool that accepts both `dashboard` (inline
JSON) and `dashboardUri` (session URI) enforces that **exactly one**
is provided. The shared `resolveDashboardArg` helper in
`src/mcp/registry.ts` produces one of three structured errors:

- `both-provided` — passing both is ambiguous; tools refuse rather
  than silently picking one.
- `neither-provided` — required where the tool needs dashboard
  context (all but `grafana_panel_validate`, where dashboard context
  is optional and "neither" runs schema-only validation).
- `unknown-uri` — the URI doesn't resolve in the current session's
  registry.

The contract is enforced at the resolver level, not the Zod schema —
preserving the structured `{ errors: [{ code, message }] }` envelope
across the MCP boundary instead of Zod's stringly-typed `ZodError`.

## PanelInput (dashboard-builder input type)

Type accepted by `buildDashboard`'s `panels` array, widened from
`cog.Builder<Panel> | Panel` (v0.1) to
`cog.Builder<Panel> | cog.Builder<RowPanel> | Panel | RowPanel`.
Row-shaped inputs (detected by `type === 'row'` on the panel or
`internal.type === 'row'` on the SDK builder) route through the SDK's
`DashboardBuilder.withRow()` (full-width 24×1 layout) rather than
`withPanel()` (12×8 grid layout) — without the dispatch a row JSON
ends up as an oddly-tall section header. The dispatch also defaults a
missing `row.panels: []` so the SDK's unguarded `forEach` doesn't
crash on bare-row inputs (regression test in `dashboard.test.ts`).

## StatGraphMode

Local literal type `'area' | 'line' | 'none'`, structurally
exhaustive against the SDK's `common.BigValueGraphMode` enum.
Exposed on `BuildStatPanelInput.graphMode` so callers can type-check
against the project's vocabulary without importing the SDK enum.
Defaults to `'area'` when omitted, satisfying the
`panels.stat.requiresComparison` lint rule out of the box. Callers
who genuinely want a bare KPI opt out with `'none'`; the linter then
flags it (intended).
