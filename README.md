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
| `grafana_dashboard_build`         | `{ title }`                             | A Grafana dashboard as JSON text                                   |
| `prometheus_metric_parse`         | `{ text }`                              | Parsed metric definitions (name, type, labels, …) as JSON text     |
| `grafana_timeseries_panel_build`  | `{ title, targets[], unit?, … }`        | A Grafana timeseries panel as JSON text; supports multi-expression |

`prometheus_metric_parse` accepts the raw exposition-format text from a
`/metrics` endpoint and returns structured metric data the LLM can
reason about — types (counter / gauge / histogram / summary), HELP
text, and the distinct label values seen across samples.

`grafana_timeseries_panel_build` accepts one or more `targets` so the
LLM can plot a counter rate and its 5xx error rate (or any other set
of related queries) on the same chart.

More tools (`grafana_timeseries_panel_build`,
`grafana_alert_rule_build`, guidance resources, …) are sequenced in
[`research.md`](./research.md) Entries 010 and 011 and will land in
subsequent PRs.

The library is pre-1.0 (`0.1.0`). Alert/contact-point builders, the
expanded MCP tool surface (including a JSON-panel input on
`grafana_dashboard_build`), and the guidance-resource layer are tracked
in [`research.md`](./research.md) and will land in subsequent PRs.

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

# run the test suite (Vitest)
pnpm test

# watch mode
pnpm test:watch

# type-check (Vitest does not type-check; tsc does)
pnpm typecheck

# build the library to ./dist
pnpm build
```

## License

[MIT](./LICENSE).

[foundation-sdk]: https://github.com/grafana/grafana-foundation-sdk
[drilldown]: https://github.com/grafana/metrics-drilldown
