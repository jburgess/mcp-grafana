# mcp-grafana

Strongly-typed Grafana asset builders (dashboards, panels, alerts, contact
points, …) with an MCP surface for LLM clients. Targets **Grafana 12.x**.

> **Status:** pre-alpha (`0.0.0`). The project is in the scaffolding stage;
> no builders are usable yet. See `AGENTS.md` and `research.md` for the
> design and the open decisions.

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
import { buildDashboard } from 'mcp-grafana';
import { PanelBuilder } from '@grafana/grafana-foundation-sdk/timeseries';

const dashboard = buildDashboard({
  title: 'My Dashboard',
  panels: [
    new PanelBuilder().title('CPU usage'),
  ],
});

console.log(dashboard.title);           // "My Dashboard"
console.log(dashboard.panels?.length);  // 1
```

`buildDashboard` is the thinnest possible wrapper over the Apache-2.0
[`@grafana/grafana-foundation-sdk`][foundation-sdk]. It produces a
JSON-serializable Grafana dashboard object you can post to Grafana's HTTP
API, write to a provisioning file, or commit to git.

Panel composition uses the SDK's builders directly (any
`@grafana/grafana-foundation-sdk/<panel-type>` subpath: `timeseries`,
`table`, `stat`, etc.). For v0 the SDK import is explicit; convenience
re-exports and `panel({ type, … })` helpers will land in a later release.

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
      "args": ["-y", "mcp-grafana"]
    }
  }
}
```

v0 exposes:

| Tool                        | Inputs           | Returns                                              |
| --------------------------- | ---------------- | ---------------------------------------------------- |
| `grafana_dashboard_build`   | `{ title }`      | A Grafana dashboard as JSON text                     |
| `prometheus_metric_parse`   | `{ text }`       | Parsed metric definitions (name, type, labels, …) as JSON text |

`prometheus_metric_parse` accepts the raw exposition-format text from a
`/metrics` endpoint and returns structured metric data the LLM can
reason about — types (counter / gauge / histogram / summary), HELP
text, and the distinct label values seen across samples.

More tools (`grafana_timeseries_panel_build`,
`grafana_alert_rule_build`, guidance resources, …) are sequenced in
[`research.md`](./research.md) Entries 010 and 011 and will land in
subsequent PRs.

The library is in pre-alpha (`0.0.0`). Alert/contact-point builders, the
expanded MCP tool surface, and the heuristic intelligence layer are
tracked in [`research.md`](./research.md) and will land in subsequent
PRs.

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
