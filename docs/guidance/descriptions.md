# Filling panel descriptions across a dashboard

The audit pattern for "46 of 64 panels have no description." This
document is operational — HOW to find and fill missing descriptions
with the existing primitives. The OPINION about what a description
should say lives in
[`skills/grafana-style-guide.md`](../../skills/grafana-style-guide.md)
§"Titles and descriptions."

Issue #31 originally proposed a dedicated `descriptions_audit` tool
that would synthesize description text. A team review cut it per
AGENTS.md §1.8 — synthesising prose from a panel's query and legend
is squarely an LLM job, not a primitive. Best one-line summary from
the cut: *"the model is better at writing descriptions from queries +
legends than any TS rule will be."* The guidance below is the
replacement: a worked pattern an LLM can follow to do the synthesis
itself.

---

## What a description should say (skill summary)

From the skill body:

- **Description = the metric's HELP text, where useful** (verbatim or
  lightly edited). The HELP text is what the metric author wrote about
  what the metric measures; using it preserves the original author's
  semantics.
- For derived metrics (rate, sum, quantile), construct from the
  underlying metric's HELP plus the operation: "Total HTTP requests
  per second" rather than "Rate of `http_requests_total`."
- Short noun phrase, not a sentence. "Request rate by status", not
  "How many requests per second is the service handling broken down
  by HTTP status."
- Panel description should NOT duplicate the panel title. The title
  names the metric; the description adds context the title doesn't
  carry (units, what changes affect it, when to look at it).

---

## The pattern

### Step 1 — find panels missing a description

`grafana_dashboard_panel_find` with `hasDescription: false`. Row
panels are excluded automatically (they're section markers, not
visualizations; matches the convention in
`grafana_dashboard_inspect`'s `panelsMissingDescription` count).

Empty-string descriptions count as missing — the project treats
`null | undefined | ""` uniformly. PR #32 shipped this rule; if a
panel was touched by Grafana's UI and now has `description: ""`,
it's still discoverable here.

```jsonc
{
  "tool": "grafana_dashboard_panel_find",
  "arguments": {
    "dashboard": current,
    "filter": { "hasDescription": false }
  }
}

// Returns { panelIds: [526, 528, ... (46 ids)], errors: [] }
```

### Step 2 — read each panel's targets to synthesize a description

`grafana_dashboard_inspect` with `detail: 'panels'` gives you each
panel's `title`, `unit`, and `targets[]` (with `expr` / `legendFormat`
truncated at 512 chars per PR #32). Three columns + one short query is
usually enough to write a one-line description:

```
title: "HTTP: requests"
unit: "reqps"
expr: "rate(http_requests_total[$__rate_interval])"
       legendFormat: "{{ method }}"
→ description: "Total HTTP request rate, by request method"
```

For panels with multiple targets, write a description that covers the
COMBINED picture (e.g. "Request rate alongside 5xx error rate" for a
two-target panel showing both). The skill's "Titles and descriptions"
section has more examples.

If a target uses a metric whose HELP text you have (e.g. from
`prometheus_metric_parse` on the `/metrics` endpoint), prefer that
text — it preserves the author's intent.

### Step 3 — apply each fix

```jsonc
{
  "tool": "grafana_dashboard_panel_update",
  "arguments": {
    "dashboard": current,
    "panelId": 526,
    "patch": {
      "description": "Total HTTP request rate, by request method"
    }
  }
}
```

Thread the returned `dashboard` into the next call. The full bulk
workflow is documented at
[`bulk-panel-updates.md`](./bulk-panel-updates.md).

### Step 4 — validate

`grafana_dashboard_validate` on the final dashboard. Description
fixes are local to the `description` field and can't break variable
references, but the validate pass catches anything else.

### Step 5 — re-check the count

`grafana_dashboard_inspect` with `detail: 'summary'` (the default)
returns `panelsMissingDescription` — the count of non-row panels with
absent or empty descriptions. After the audit it should be zero (or
the count of legitimately-undocumented panels, if you have rationale
for any).

---

## Worked example

CCS dashboard from the original #31 session: 46 of 64 panels lacked
descriptions. The author wrote them all in a single audit pass.

```jsonc
// 1. Find them
const find = await mcp.call("grafana_dashboard_panel_find", {
  dashboard,
  filter: { hasDescription: false }
});
// find.panelIds → [526, 528, 530, ... (46 ids)]

// 2. Read each panel's targets to synthesize description text
const panels = await mcp.call("grafana_dashboard_inspect", {
  dashboard,
  detail: "panels"
});
// For each id in find.panelIds: look at the matching row in
// panels.panels — its title, unit, and targets[0].expr / legendFormat.
// Write a one-line description from those three columns.

// 3. Patch each (in this example: per-panel descriptions, not a single
// templated one)
let current = dashboard;
for (const panelId of find.panelIds) {
  const description = /* model synthesises from title + unit + expr */;
  const r = await mcp.call("grafana_dashboard_panel_update", {
    dashboard: current,
    panelId,
    patch: { description }
  });
  if (r.errors.length === 0) current = r.dashboard;
  else /* record failure */;
}

// 4. Validate
await mcp.call("grafana_dashboard_validate", { dashboard: current });

// 5. Re-check the count
const after = await mcp.call("grafana_dashboard_inspect", {
  dashboard: current,
  detail: "summary"
});
// after.panelsMissingDescription === 0
```

---

## Anti-patterns

- **Don't paste the metric name as the description.** `description:
  "http_requests_total"` adds no information the title doesn't carry.
- **Don't paste the query as the description.** Same problem.
- **Don't restate the unit in the description.** Grafana already
  renders the unit on the axis and in the tooltip. A description that
  reads "Request rate in requests per second" duplicates the unit
  axis.
- **Don't write descriptions that depend on Grafana's current state.**
  "Currently above 100 reqps" rots; "Total HTTP request rate" doesn't.
- **Don't dump a paragraph.** The description shows in a small info
  tooltip. One sentence, ideally one noun phrase.

---

## References

- [`skills/grafana-style-guide.md`](../../skills/grafana-style-guide.md)
  §"Titles and descriptions" — the canonical opinion this doc
  operationalises.
- [`docs/guidance/bulk-panel-updates.md`](./bulk-panel-updates.md) —
  the underlying `find → loop update → validate` pattern.
- [`docs/guidance/units.md`](./units.md) — the sibling pattern for
  unit fixes; descriptions and units are often audited together.
- `research.md` Entry 015 — why the dedicated bulk-update tool was
  cut in favor of composition.
- Issue #31 (closed) — original wishlist where this audit was the
  motivating example.
