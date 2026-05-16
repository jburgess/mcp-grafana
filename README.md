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
   [`@grafana/grafana-foundation-sdk`][foundation-sdk] — schema-valid
   Grafana JSON, deterministic output, narrow composable functions.
2. **Deterministic primitives** for the things an LLM can't reliably do
   itself: parsing Prometheus exposition format, validating dashboard
   shape, walking and patching existing dashboards. Opinion (RED /
   USE / golden signals patterns, panel style conventions) lives in
   markdown — under `docs/guidance/` for project-authored guidance and
   under `skills/` for user-installable shareable opinions — so the
   model can read and reason about it without us encoding heuristic
   rules in TypeScript that duplicate its training (see
   [`AGENTS.md`](./AGENTS.md) §1.8 and [`research.md`](./research.md)
   Entry 011).
3. **An MCP server** that exposes the builders and primitives as tools,
   and serves the markdown guidance + skills as resources, so LLM
   clients can compose Grafana assets and commit them as code.

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

`prometheus_metric_parse` accepts the raw exposition-format text from a
`/metrics` endpoint and returns structured metric data the LLM can
reason about — types (counter / gauge / histogram / summary), HELP
text, and the distinct label values seen across samples.

`grafana_timeseries_panel_build` accepts one or more `targets` so the
LLM can plot a counter rate and its 5xx error rate (or any other set
of related queries) on the same chart.

More tools (`grafana_dashboard_panel_move`,
`grafana_dashboard_panel_remove`, `grafana_alert_rule_build`, guidance
resources, …) are sequenced in [`research.md`](./research.md) Entries
010 and 011 and will land in subsequent PRs.

The library is pre-1.0 (`0.1.0`). Alert/contact-point builders, the
remaining dashboard mutation tools (panel move / remove), and the
guidance-resource layer are tracked in [`research.md`](./research.md)
and will land in subsequent PRs.

## Panel style skill

`skills/panel-style.md` is a starter style guide for Grafana panels —
units, legends, thresholds, descriptions — modeled on the
[kubernetes-mixin](https://github.com/kubernetes-monitoring/kubernetes-mixin)
and [monitoring-mixins](https://monitoring.mixins.dev/) corpus. The file
is markdown with frontmatter (Anthropic Agent Skills format) plus an
illustrative `StyleGuide` JSON block that the forthcoming
`grafana_panel_lint` tool will consume.

mcp-grafana ships zero default opinion in code. The skill is the only
place an opinion lives; it travels as **content**, copyable into any
LLM tool. You are expected to fork it — the project does not auto-update
or otherwise manage the copy you install. The decision is ratified in
[`research.md`](./research.md) Entry 012, which records the
six-perspective debate, the rejected alternatives (no
`defaultStyleGuide` export, no profile family, no `defineRule` plugin,
no filesystem-write tool) and the agent-by-agent acceptance.

On-ramps per client:

- **Claude Code** — copy the file into your skills directory:
  ```bash
  cp "$(npm root -g)/@jburgess/mcp-grafana/skills/panel-style.md" ~/.claude/skills/
  ```
- **Cursor** — `@`-include the file in chat, or paste the contents into
  `.cursorrules` in your workspace root.
- **Generic MCP client** — fetch the file via the (forthcoming) read-only
  resource at `mcp://grafana/skills/panel-style.md`, or grab the file
  directly from the installed package.
- **Any other LLM tool** — the skill is plain markdown; paste it into a
  system prompt or rules file.

The MCP server delivers content (read-only resource); it does not write
to your filesystem. There is no `grafana_skill_install` tool — moving
bits is your tool's job.

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
