# Reviewing a dashboard change (the PR-review recipe)

The recipe for "someone changed a dashboard JSON — tell me what actually
changed and whether any of it is risky." This is the **review** leg of the
workflow, the pair to building (the panel/dashboard builders) and auditing
([`audit-review.md`](./audit-review.md)). This document is **operational**:
it tells you HOW to turn two dashboard JSONs into a reviewer-ready summary.
The **OPINION** about which changes deserve scrutiny lives here in prose;
the deterministic facts come from `grafana_dashboard_diff`.

There is deliberately **no risk score in the tool**. `grafana_dashboard_diff`
emits facts — panels added/removed, per-panel field changes, dashboard-level
field changes — and nothing else. *Deciding* that a datasource swap is
scarier than a description edit is judgement, and judgement belongs to the
model reading this recipe, not to a hardcoded function in the server
(AGENTS.md §1.8). Same reasoning that kept `grafana_dashboard_audit` out of
the codebase.

## Why a semantic diff and not the textual one

The diff a reviewer sees in a PR is a diff over deeply-nested,
frequently-reordered JSON. It is dominated by noise:

- Moving one panel up the array shifts every following panel's
  `gridPos.y` — dozens of changed lines, zero semantic change.
- Re-exporting from the Grafana UI reorders object keys and rewrites
  `schemaVersion`, `version`, `iteration` — pure churn.
- A formatter or a different serializer reflows the whole file.

…all of which buries the one line that mattered: a threshold flipped, a
datasource swapped, a unit dropped, a query rewritten. `grafana_dashboard_diff`
compares the **normalized projection** (the same per-panel fields
`grafana_dashboard_inspect detail:"panels"` returns) so only the semantic
deltas survive.

## Step 0 — load both sides, work by reference

Dashboards are large. Load each side into the session registry once and
pass the **URIs**, so neither full JSON sits in the LLM context:

```jsonc
{ "tool": "grafana_dashboard_load", "arguments": { "path": "./base.json" } }
// → { "uri": "mcp://grafana/session/dashboard/1" }
{ "tool": "grafana_dashboard_load", "arguments": { "path": "./head.json" } }
// → { "uri": "mcp://grafana/session/dashboard/2" }
```

(For dashboards you already hold inline, pass `base` / `head` instead of
`baseUri` / `headUri`.)

## Step 1 — compute the diff

```jsonc
{ "tool": "grafana_dashboard_diff",
  "arguments": { "baseUri": "mcp://grafana/session/dashboard/1",
                 "headUri": "mcp://grafana/session/dashboard/2" } }
// → { panelsAdded:   PanelRow[],
//     panelsRemoved: PanelRow[],
//     panelsChanged: [{ id?, title?, changes: [{ field, before?, after? }], otherChanges? }],
//     dashboardChanges: [{ field, before?, after? }],
//     truncated? }
```

Panels are matched by `id` (the well-formed case — Grafana always assigns
ids), falling back to `title`. A panel that only moved in the array — same
id, same fields — does **not** appear in `panelsChanged`.

Reading the result:

- In each `FieldChange`, a **missing `before`** means the field was *added*;
  a **missing `after`** means it was *removed*; both present means *changed*.
  (The JSON omits `undefined` values, so an added field arrives as
  `{ field, after }` with no `before` key.)
- A `panelsChanged` entry **without `id`** is an id-less panel matched by
  `title` — use the `title` to identify it.

> **The diff is shallow — do not over-trust an empty result.** The
> per-panel comparison is over the normalized projection only (id, title,
> type, description, unit, datasource, target count, gridPos, rowId,
> targets). It does **not** see `thresholds`, `color`, `fieldConfig`
> overrides, `transformations`, panel `options`, or `links`. When one of
> those changed but the projected fields did not, the entry carries
> **`otherChanges: true`** with an empty or partial `changes` array — that
> flag is your cue to read the raw panel JSON (`grafana_dashboard_export`
> or `inspect`) for that panel. **Never report "no functional change" off
> an empty `changes` without checking `otherChanges`.** Likewise
> `grafana_dashboard_diff` does not expand `repeat` panels or resolve
> library-panel references; treat those panels' bodies as opaque and read
> the raw JSON if the PR touches them.

## Step 2 — triage by risk (this is the judgement)

The diff is a flat set of facts; turn it into a review by ordering it. The
risk ladder, highest first:

1. **Removed panels** (`panelsRemoved`). Deleting a panel deletes a signal
   an operator may rely on during an incident. Always call these out by
   title; ask whether the removal was intentional.
2. **Datasource swaps** (a `datasource` change). Pointing a panel at a
   different source is the classic silent-broken change — the panel still
   renders, just against the wrong (or empty) data. High scrutiny.
3. **Query rewrites** (a `targets` change). The panel's *meaning* changed.
   Eyeball the before/after `expr`: a `5m` → `1h` window or a dropped
   label selector changes what the chart says. Consider pairing with
   `grafana_promql_validate` on the new expression.
4. **Unit changes** (a `unit` change). `percent` ↔ `percentunit` is the
   off-by-100 footgun; `bytes` → `short` drops human-readable scaling.
5. **Type changes** (a `type` change). A `timeseries` → `stat` swap is a
   different visualization decision, not a tweak — flag it.
6. **Out-of-projection changes** (`otherChanges: true`). The projection
   didn't catch it, but *something* changed — most often a threshold,
   color, override, or transformation, all of which are operationally
   meaningful. Read the raw panel and classify it; don't wave it through.
7. **Added panels** (`panelsAdded`). New surface to review on its own
   merits — run the [`audit-review.md`](./audit-review.md) lint pass over
   the new panels (datasource declared? unit sane? query valid?).
8. **Layout-only changes** (`gridPos`, `rowId`). Usually benign
   reorganization. Mention briefly; don't dwell.
9. **Description / title edits.** Cosmetic. Note in passing.

Dashboard-level changes (`dashboardChanges`) deserve their own line:

- A **variable rename or removal** (`variableNames` changed) can strand
  every panel that interpolated the old name — cross-check with
  `grafana_dashboard_validate` on the head dashboard to catch dangling
  refs. (Note: the diff compares variable *names* only. A variable whose
  query, datasource, or current value changed while its name stayed put is
  invisible here — if the PR touches `templating.list`, read it directly.)
- A **uid change** breaks every external link and bookmark to the
  dashboard. High-impact; call it out.
- **tags / timezone / refresh** changes are low-risk metadata.

## Step 3 — go deeper where the diff points

The diff tells you *which* panels changed; for the risky ones, pull the
detail you need:

- New or rewritten queries → `grafana_promql_validate` on the `after`
  `expr`, or `grafana_dashboard_lint` (with `panels.targets.promqlValid` /
  `promqlSemantic`) over the head dashboard.
- Added panels → the full audit pass from
  [`audit-review.md`](./audit-review.md).
- A suspected dangling variable ref after a rename →
  `grafana_dashboard_validate`.

## What to report to the user

Frame it as a **risk-ordered changelist, not a raw dump**. Lead with the
removals and datasource/query changes; summarize the layout churn in one
line; note cosmetic edits last. For each risky change, give the panel
title, the before → after, and the concrete question the reviewer should
answer ("panel *Error ratio* switched datasource prom → mimir — intended?").
Be explicit that the diff reports the *structural* projection: changes to
fields the projection doesn't carry (panel `color`, `thresholds`,
`overrides`, `transformations`) won't show up — if those matter for this
review, say so and fall back to reading the raw panel JSON.

## Why no risk score in the tool

A `grafana_dashboard_diff` that emitted a "risk: high" verdict would have
to *encode the team's taste* about what's risky — exactly the judgement
AGENTS.md §1.8 keeps out of code and in the markdown the model reads. The
deterministic half (what changed) is the tool; the triage (what matters)
is this recipe. A runnable end-to-end demonstration lives at
[`examples/pr-review.ts`](../../examples/pr-review.ts).
