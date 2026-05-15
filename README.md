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

The library is not yet usable. Once it is, the quickstart will live here.
Until then, see the scaffolding state below.

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
