# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
