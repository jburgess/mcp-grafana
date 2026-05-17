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
Shape: `{ timeseries?: TimeseriesPanelStyle; units?: UnitStyleGuide;
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

## DashboardStyleGuide (slice type)

The slice `lintDashboard` consumes for the dashboard-level rules that
can't be checked per-panel. Shape: `{ panels?: { duplicateTitles?:
boolean | { except?: string[] } }; variables?: { hiddenButReferenced?:
boolean; emptyDefault?: boolean } }`. Each rule is an opt-in toggle.
`duplicateTitles` accepts `true` / `false` for the simple case, or
`{ except: [titles...] }` to exempt intentional duplicates (e.g. a
KPI stat next to its timeseries trend) — the structural `except` shape
was chosen over a heuristic `sameTypeOnly` knob per research.md
Entry 014's deferred extensions. Surfaces only structural,
deterministic checks (duplicate titles, hidden-but-interpolated
variables, empty load-time defaults); heuristic / taste-laden rules
(title-query mismatch, naming inconsistency, threshold sanity) stay
in the skill's prose per AGENTS.md §1.8.

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
