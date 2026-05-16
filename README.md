# mcp-grafana

Strongly-typed Grafana asset builders (dashboards, panels, alerts, contact
points, …) with an MCP surface for LLM clients. Targets **Grafana 12.x**.

> **Status:** pre-1.0 (`0.1.0`). The library is usable for a small but
> growing set of Grafana assets and exposes them through an MCP server.
> The API may change as the surface grows. See `AGENTS.md` and
> `research.md` for the design and the open decisions.

## Install

```bash
# As a library or CLI
pnpm add @jburgess/mcp-grafana
# or: npm i @jburgess/mcp-grafana
# or: yarn add @jburgess/mcp-grafana

# As an MCP server, no install needed — npx fetches on demand
npx -y @jburgess/mcp-grafana
```

## Why this exists

Grafana dashboards-as-code in TypeScript, with three layers:

1. **Typed builders** over the official Apache-2.0
   [`@grafana/grafana-foundation-sdk`][foundation-sdk], with opinionated
   composition helpers above it.
2. **Deterministic heuristics** for turning Prometheus metric definitions
   into sensible panels and dashboards (USE / RED / golden signals
   templates; ingestion of `/metrics` endpoints into starter dashboards).
3. **An MCP server** that exposes the builders and heuristics as tools so
   LLM clients can compose Grafana assets and commit them as code.

Grafana's own [Metrics Drilldown][drilldown] already solves *interactive,
runtime* automatic exploration of metrics. This project is for the
**committable, versioned, asset-as-code** half of the problem.

## Quickstart

```ts
import { buildDashboard, buildTimeseriesPanel } from '@jburgess/mcp-grafana';

const cpu = buildTimeseriesPanel({
  title: 'HTTP requests',
  description: 'The total number of processed HTTP requests.',
  unit: 'reqps',
  targets: [
    { expr: 'sum(rate(http_requests_total[$__rate_interval])) by (status)',
      legendFormat: '{{ status }}' },
  ],
});

const dashboard = buildDashboard({
  title: 'HTTP service',
  panels: [cpu],
});
```

`buildDashboard` and `buildTimeseriesPanel` are thin wrappers over the
Apache-2.0 [`@grafana/grafana-foundation-sdk`][foundation-sdk]. They
produce JSON-serializable Grafana objects you can post to Grafana's HTTP
API, write to a provisioning file, or commit to git.

`buildTimeseriesPanel` accepts multiple `targets` because Grafana
panels can plot more than one PromQL expression on the same chart —
e.g., overall rate and 5xx rate side by side.

For lower-level control you can still pass raw SDK panel builders into
`buildDashboard({ panels: [new PanelBuilder()...] })` directly; our
`buildTimeseriesPanel` returns the same shape they do.

## Using the MCP server

The library ships with an MCP server that exposes builders as tools so
LLM clients (Claude Desktop, Cursor, etc.) can compose Grafana assets.

Wire it into an MCP-aware client by running it over stdio:

```jsonc
// e.g. ~/.config/claude/claude_desktop_config.json
{
  "mcpServers": {
    "grafana": {
      "command": "npx",
      "args": ["-y", "@jburgess/mcp-grafana"]
    }
  }
}
```

The package name is scoped (`@jburgess/mcp-grafana`); the bin it
installs is the unscoped `mcp-grafana` command.

v0 exposes:

| Tool                              | Inputs                                  | Returns                                                            |
| --------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `grafana_dashboard_build`         | `{ title, panels? }`                    | A Grafana dashboard as JSON text                                   |
| `grafana_dashboard_inspect`       | `{ dashboard, detail? }`                | Structured view of an existing dashboard (summary / panels / conventions) |
| `grafana_dashboard_validate`      | `{ dashboard }`                         | `{ valid, errors[] }` — required fields, unique panel ids, resolvable variable refs |
| `grafana_panel_validate`          | `{ panel, dashboard? }`                 | `{ valid, errors[] }` — schema only without context; + variable-ref checks with context |
| `grafana_dashboard_panel_insert`  | `{ dashboard, panel, position? }`       | `{ dashboard?, errors[] }` — insert a panel (append / gridPos / after id / in row) with auto-id assignment |
| `grafana_dashboard_panel_update`  | `{ dashboard, panelId, patch }`         | `{ dashboard?, errors[] }` — apply a JSON Merge Patch (RFC 7396) to a single panel |
| `grafana_dashboard_panel_move`    | `{ dashboard, panelId, to }`            | `{ dashboard?, errors[] }` — relocate a panel/row using the same position modes as insert |
| `grafana_dashboard_panel_remove`  | `{ dashboard, panelId }`                | `{ dashboard?, errors[] }` — remove a panel; modern rows leave trailing siblings in place |
| `prometheus_metric_parse`         | `{ text }`                              | Parsed metric definitions (name, type, labels, …) as JSON text     |
| `grafana_timeseries_panel_build`  | `{ title, targets[], unit?, … }`        | A Grafana timeseries panel as JSON text; supports multi-expression |

`grafana_dashboard_build`'s optional `panels` parameter accepts an array
of panel JSON objects — typically the output of
`grafana_timeseries_panel_build`. The LLM round-trip is: call
`grafana_timeseries_panel_build` once per panel, collect the JSON,
pass the collected array as `panels` to `grafana_dashboard_build`. The
result is the complete dashboard JSON, ready to post to Grafana.

`grafana_dashboard_inspect` reads an existing dashboard JSON and
returns a structured view at one of three detail levels — `summary`
(default, bounded headline view safe for arbitrarily large dashboards;
includes a `rows` list with each row's title, id, and child-panel
count), `panels` (per-panel rows for audit workflows: titles,
descriptions, units, gridPos, **and `rowId` so the LLM knows which
row each panel belongs to**), or `conventions` (panel-size histogram,
top units, variables, row count — useful when building a new
dashboard meant to match an existing one). Both legacy
(Grafana ≤7, `row.panels[]` nested) and modern (Grafana ≥8, flat
panels ordered by array position) row-membership styles are handled.

`grafana_dashboard_validate` and `grafana_panel_validate` return a
model-friendly `{ valid, errors[] }` rather than throwing. Each error
has a JSONPath-like `path` (e.g., `"panels[2].targets[0].expr"`) and a
short `message`. Validation covers required fields (`title`, per-panel
`id`, well-formed `gridPos`), panel id uniqueness across the full
panel tree (including row-nested), and variable references in panel
queries (`expr` / `query` / `rawQuery`) and `datasource.uid` — Grafana
built-ins like `$__rate_interval` are allowed automatically. The
errors list is capped at 100 with `truncated: true` if exceeded.

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

`grafana_dashboard_panel_remove` deletes a panel by id. Regular panels
are spliced from their container; legacy rows are removed together
with their nested children; modern rows are removed but their trailing
siblings are **promoted to no-row status** (they keep their `gridPos`
but lose their implicit row affiliation). Matches "delete the section
header but keep the charts under it" intent.

`prometheus_metric_parse` accepts the raw exposition-format text from a
`/metrics` endpoint and returns structured metric data the LLM can
reason about — types (counter / gauge / histogram / summary), HELP
text, and the distinct label values seen across samples.

`grafana_timeseries_panel_build` accepts one or more `targets` so the
LLM can plot a counter rate and its 5xx error rate (or any other set
of related queries) on the same chart.

More tools (`grafana_alert_rule_build`, guidance resources, …) are
sequenced in [`research.md`](./research.md) Entries 010 and 011 and
will land in subsequent PRs.

The library is pre-1.0 (`0.1.0`). Alert/contact-point builders and
the guidance-resource layer are tracked in
[`research.md`](./research.md) and will land in subsequent PRs.

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

Short version: **installing `@jburgess/mcp-grafana` carries no AGPL
exposure.** The longer version below is intended for procurement /
legal review and walks through why.

### What this package actually ships

`package.json`'s `files` field is `["dist", "README.md", "LICENSE",
"CHANGELOG.md"]`. That is:

- `dist/` — our TypeScript compiled to JavaScript. Original work,
  MIT-licensed.
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
