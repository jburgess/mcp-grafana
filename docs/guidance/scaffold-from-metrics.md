# Scaffolding a dashboard from a `/metrics` endpoint

The recipe for "I have a service exposing Prometheus metrics — give me a
good first dashboard." This document is **operational**: it tells you HOW
to turn a metrics dump into a committable, style-guide-shaped dashboard
using the existing primitives. The **OPINION** about which panel and unit
fit which metric shape lives in
[`skills/grafana-style-guide.md`](../../skills/grafana-style-guide.md)
(installed copy: `mcp://grafana/skills/grafana-style-guide.md`) — read it
first; this recipe assumes its RED / USE / golden-signals patterns.

There is deliberately **no `scaffold_dashboard` tool**. Choosing panels
from metrics is judgement, and judgement belongs to the model reading the
skill, not to a hardcoded function in the server (AGENTS.md §1.8;
research.md Entry 011 / Entry 017). The server ships the deterministic
*fact* primitive — `prometheus_metric_parse` — and you compose the rest.

## Inputs

Run the exposition text through `prometheus_metric_parse`. Give it
**either** `text` (inline — a paste, or a `/metrics` body the host already
fetched) **or** `path` (a filesystem path to a saved scrape). Prefer
`path` for a busy service: a real `/metrics` is thousands of series, and
reading from disk keeps that bulk out of the LLM context — only the
parsed, deduplicated definitions come back. The server does not fetch
URLs; if the metrics live behind an endpoint, have the host fetch it and
pass the body inline or save it to a file first. You get one record per
metric family:

```jsonc
{ "name": "http_requests_total",
  "type": "counter",
  "help": "Total HTTP requests.",
  "labels": { "method": ["GET", "POST"], "status": ["200", "404", "500"] } }
```

Three fields drive every decision below: `type` (counter / gauge /
histogram / summary), the metric **name** (suffix conventions carry the
unit), and the **distinct label values** (`labels`) — which tell you, for
example, that an error dimension exists *without guessing*.

## Step 1 — classify each metric (facts, not taste)

These mappings are mechanical reads of the parse output. They are facts
about the metric; the *panel choice* in Step 2 is the opinion.

| Signal in the parse output | What it is |
| --- | --- |
| `type: counter`, name ends `_total` | a rate source (RED **Rate**) |
| counter with a `status` / `code` / `status_code` / `result` label whose values include errors (`5xx`, `error`, `false`) | an error dimension (RED **Errors**) |
| `type: histogram`, name ends `_bucket` (with sibling `_sum` / `_count`) | a latency/size distribution (RED **Duration**) |
| `type: summary` with a `quantile` label | pre-computed latency quantiles |
| `type: gauge` of a resource (memory, cpu, connections, queue depth, fds) | a USE **Utilisation / Saturation** source |
| `type: gauge` valued `0` / `1` (`up`, `*_healthy`, `*_ready`) | categorical health → the fold |

Unit comes from the Prometheus naming convention (also factual): name
ends `_seconds` → `s`; `_bytes` → `bytes`; a ratio of two rates →
`percentunit`; a bare counter rate → `reqps` / `ops`. The skill's
`## Units` section is the source of truth when the suffix is ambiguous.

## Step 2 — map facts to panels (the skill's opinion)

Apply the skill's panel-type and row-sequence rules. The defaults:

- **RED Rate** → `grafana_timeseries_panel_build`, `unit: reqps`, query
  `sum by (<dim>) (rate(<name>[$__rate_interval]))`.
- **RED Errors** → a ratio: `grafana_stat_panel_build`, `unit:
  percentunit`, `sum(rate(<name>{<errsel>}[5m])) / sum(rate(<name>[5m]))`.
  (Stat builders default `graphMode: "area"` so the comparison-sparkline
  rule `panels.stat.requiresComparison` is satisfied out of the box.)
- **RED Duration** → `grafana_timeseries_panel_build`, `unit: s`,
  one target per quantile: `histogram_quantile(0.99, sum by (le)
  (rate(<name>_bucket[$__rate_interval])))` (p50 / p90 / p99). A
  high-cardinality entity dimension instead wants
  `grafana_heatmap_panel_build` (see the skill's "Repeating panels").
- **USE** → `grafana_timeseries_panel_build` with the resource's natural
  unit (`bytes`, `percent`, `short`).
- **Categorical health** → `grafana_state_timeline_panel_build` on the
  **first row** — this is the "fold" the skill calls the single most
  important dashboard decision.

Set `datasource` on **every** data-bearing panel (a templating ref like
`{ uid: "$datasource", type: "prometheus" }` for multi-environment), and
write a one-line `description` on each — both are lint-enforced.

## Step 3 — compose the dashboard (row sequence)

Order rows per the skill's `## Dashboards` → "Row sequence":

1. **Fold (row 1)** — categorical health (the state-timeline from the
   `up`-style gauge), optionally an alertlist. Tag the dashboard
   `overview` so `dashboards.layout.firstRowCategorical` enforces this.
2. **Row 2** — RED (rate / errors / duration) for request-driven
   services, or USE for resource-driven ones.
3. **Rows 3..N** — per-component decomposition in pipeline order.

Pass the panels (rows + panels, in order) to `grafana_dashboard_build`,
which auto-assigns `id` / `gridPos`.

## Step 4 — self-check and fix

Lint the result with `grafana_dashboard_lint` against your
`GrafanaStyleGuide`. The findings map directly back to fixes:

| Finding | Fix |
| --- | --- |
| `panels.targets.promqlValid` | the model wrote invalid PromQL — correct the expression and rebuild the panel |
| `dashboards.panels.datasourceDeclared` | add `datasource` to the panel |
| `panels.units.allowList` / `deny` | wrong unit — re-derive from the name suffix |
| `panels.descriptions.required` | add a `description` |
| `panels.stat.requiresComparison` | a stat lost its sparkline — set `graphMode: "area"` |
| `dashboards.layout.firstRowCategorical` | the fold is a wall of numbers — move a state-timeline / alertlist to row 1 |

Apply fixes with `grafana_dashboard_panel_update`, then confirm with
`grafana_dashboard_validate`. `grafana_promql_validate` is a cheap
pre-check on each expression before you ever build the panel.

## What to report to the user

State plainly that this is a **correct first draft to commit and refine**,
not a finished dashboard. The recipe gets the panel types, units,
datasources, and fold right — and lints clean — but the deeper
signal-first hierarchy (system-wide RED on row 2, pipeline-ordered
per-component rows 3..N, multi-timescale strips) is taste the linter
can't enforce; the skill flags those as review-checklist items. List
which metrics you mapped, which you skipped (e.g. `_sum`/`_count` siblings
folded into the histogram), and what the user should refine.

## Why no dedicated tool

A `scaffold_dashboard(metrics)` function would have to *choose* panel
types and units — which is exactly the opinion AGENTS.md §1.8 keeps out
of code and in the skill the model reads. The same reasoning cut
`units_audit` (see `units.md`) and `panel_update_bulk` (research.md Entry
015). The deterministic half (`prometheus_metric_parse`) is a tool; the
judgement half is this recipe. A runnable end-to-end demonstration lives
at [`examples/scaffold-from-metrics.ts`](../../examples/scaffold-from-metrics.ts).
