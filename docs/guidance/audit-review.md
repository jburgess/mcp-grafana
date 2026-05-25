# Auditing an existing dashboard

The recipe for "I have a dashboard already — tell me what's wrong with it
and how to fix it." This document is **operational**: it tells you HOW to
turn a stored dashboard into a prioritised, actionable review using the
existing primitives. The **OPINION** about what counts as good — RED/USE,
unit conventions, the categorical-health fold — lives in
[`skills/grafana-style-guide.md`](../../skills/grafana-style-guide.md)
(installed copy: `mcp://grafana/skills/grafana-style-guide.md`); this
recipe composes the tools that mechanically check the structural subset
of it.

There is deliberately **no `grafana_dashboard_audit` tool**. Chaining the
steps and *prioritising* the findings is judgement, and judgement belongs
to the model reading this recipe, not to a hardcoded function in the
server (AGENTS.md §1.8). The server ships the deterministic primitives —
load, inspect, lint, find, update, validate — and you compose the review.

## Step 0 — load it once, work by reference

Real dashboards are large (a node-exporter board is 15k+ lines / ~50–70k
tokens). Load it into the session registry once and pass the **URI** to
every subsequent step, so the full JSON enters the LLM context at most
once:

```jsonc
{ "tool": "grafana_dashboard_load", "arguments": { "path": "./prod.json" } }
// → { "uri": "mcp://grafana/session/dashboard/1" }
```

(For a dashboard you already hold inline, pass `dashboard` instead of a
URI to the tools below.)

## Step 1 — orient with a summary

```jsonc
{ "tool": "grafana_dashboard_inspect",
  "arguments": { "dashboardUri": "mcp://grafana/session/dashboard/1",
                 "detail": "summary" } }
// → { title, panelCount, panelsMissingDescription, variables, rows, … }
```

This bounds the problem (how many panels, how many rows, how many missing
descriptions) before you pull any detail. Use `detail: "conventions"` to
see the unit / datasource / naming patterns at a glance.

## Step 2 — lint against your style guide

Run `grafana_dashboard_lint` with your `GrafanaStyleGuide` (the JSON block
in the skill). Turn on the structural rules you care about — the audit's
signal comes from here:

```jsonc
{ "tool": "grafana_dashboard_lint",
  "arguments": { "dashboardUri": "mcp://grafana/session/dashboard/1",
                 "styleGuide": { /* see skills/grafana-style-guide.md */ } } }
// → { issues: [{ path, ruleId, severity, message, panelId?, panelTitle? }], truncated? }
```

What this mechanically catches (the structural subset): broken/`no-data`
queries (`panels.targets.promqlValid` / `promqlSemantic`), silent-broken
datasources (`dashboards.panels.datasourceDeclared`), wrong units
(`panels.units.*`), missing descriptions, stat panels with no comparison
(`panels.stat.requiresComparison`) or no null handling
(`stat.handlesUnknown`), gauges with no bounds (`gauge.requiresBounds`),
duplicate titles, repeating-panel blowups (`maxRepeat`), dead rows
(`orphanRow`), overlapping panels (`layout.panelOverlap`), the
"wall-of-numbers" fold on overview dashboards (`layout.firstRowCategorical`),
and variable hygiene (`hiddenButReferenced`, `emptyDefault`,
`unreferenced`).

## Step 3 — prioritise (this is the judgement)

The lint result is a flat list; turn it into a review. The ordering the
skill implies:

1. **`warn` before `info`.** `warn` findings are silent-failure modes —
   the panel looks fine on screen but shows no data (broken query, no
   datasource) or actively hides data (overlapping panels). `info`
   findings are hygiene (dead variables, missing descriptions). Fix
   `warn` first.
2. **Group by panel.** Each issue carries `panelId` / `panelTitle` when
   it scopes to a panel — group so the operator sees "panel 42 has 3
   problems," not 3 disconnected lines.
3. **Lead with the fold and the silent-failures.** A `firstRowCategorical`
   or `datasourceDeclared` finding changes what the operator sees first;
   a missing description is cosmetic. Report in that order.

Report each finding with its `message` (already actionable), its
`panelTitle`, and the concrete fix.

## Step 4 — fix, then verify

Apply fixes one panel at a time with `grafana_dashboard_panel_update`
(JSON Merge Patch), against the same registry URI so the change lands in
place:

```jsonc
// e.g. add the missing datasource a `datasourceDeclared` finding flagged
{ "tool": "grafana_dashboard_panel_update",
  "arguments": { "dashboardUri": "mcp://grafana/session/dashboard/1",
                 "panelId": 42,
                 "patch": { "datasource": { "uid": "$datasource", "type": "prometheus" } } } }
```

Then **re-lint** to confirm the finding cleared, and run
`grafana_dashboard_validate` for schema-level sanity (required fields,
unique ids, resolvable variable refs). When the review is done, hand the
JSON back with `grafana_dashboard_export` (the server never writes your
filesystem; the host persists it). The
[`bulk-panel-updates.md`](./bulk-panel-updates.md) recipe covers the
find → update → re-lint loop when the same fix applies across many panels.

## What to report to the user

Frame the output as a **prioritised review, not an exhaustive verdict**.
Be explicit that the lint catches the *structural* subset of the style
guide; the deeper signal-first judgement (row 2 = RED/USE, pipeline-
ordered rows, multi-timescale strips — see the skill's `## Dashboards`)
is review-checklist material the linter can't enforce, so call those out
qualitatively. Auto-applied fixes are suggestions to review, not
guaranteed-correct edits — surface the patch, don't silently rewrite.

## Why no dedicated tool

A `grafana_dashboard_audit` tool would have to *orchestrate* the chain and
*choose how to prioritise* findings — exactly the judgement AGENTS.md §1.8
keeps out of code and in the markdown the model reads. The same reasoning
cut `units_audit` (`units.md`) and `panel_update_bulk` (research.md Entry
015), and shaped `scaffold-from-metrics.md` (Entry 017). The deterministic
halves (lint, inspect, validate) are tools; the review is this recipe. A
runnable end-to-end demonstration lives at
[`examples/audit-review.ts`](../../examples/audit-review.ts).
