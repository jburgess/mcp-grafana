# Fixing units across a dashboard

The audit pattern for "every panel uses unit `short` but the query is
a rate / a byte count / a duration." This document is operational —
it tells you HOW to find and fix unit mismatches with the existing
primitives. The OPINION about which Grafana display unit fits which
metric shape lives in
[`skills/grafana-style-guide.md`](../../skills/grafana-style-guide.md)
(installed copy: `mcp://grafana/skills/grafana-style-guide.md`).

Issue #31 originally proposed a dedicated `units_audit` tool that
would suggest units automatically. A team review cut it per
AGENTS.md §1.8 (the unit-mapping rules — `rate(*_total)` → `reqps`,
`*_seconds` quantile → `s`, etc. — are LLM-knowable taste; encoding
them in TypeScript would duplicate training). The guidance below is
the replacement: a worked pattern an LLM can follow to do the audit
itself.

---

## The mapping (skill summary)

Full discussion is in the skill body. For quick lookup:

| Metric shape (PromQL pattern) | Grafana display unit |
|---|---|
| `rate(*_total[…])` / HTTP / RPC | `reqps` |
| `rate(*_total[…])` / generic ops | `ops` |
| `rate(*_total[…])` / writes | `wps` |
| `*_bytes` / `*_size` | `bytes` (binary IEC) |
| `*_bytes` (cloud-API documented SI) | `decbytes` |
| `histogram_quantile(*, *_seconds_bucket)` | `s` (Grafana auto-scales to ms / µs) |
| Long-running durations (uptimes, ages) | `dtdurations` |
| 0..1 ratio (`/_ratio`, fractions of 1) | `percentunit` (set `min: 0, max: 1`) |
| 0..100 percentage | `percent` (set `min: 0, max: 100`) |
| Unitless counts (pod count, queue depth) | `short` |
| **Avoid** `none` (reads as "I forgot") | use `short` if truly unitless |
| **Avoid** `locale` (locale-dependent rendering) | use `short` |

The skill is the source of truth — these are reproductions for ease of
reference. If your team disagrees with a row, fork the skill and edit
your installed copy; the project does not auto-update it.

---

## The pattern

### Step 1 — find panels with suspect units

Use `grafana_dashboard_panel_find` with a `unit` and `queryMatches`
combination. The most common audit cases:

```jsonc
// Find every panel currently unit-tagged "short" whose query uses rate(
// — strong signal it should be reqps / ops / wps.
{ "filter": { "unit": "short", "queryMatches": "rate\\(" } }

// Find every panel currently unit-tagged "short" whose query reads *_bytes
// — strong signal it should be bytes.
{ "filter": { "unit": "short", "queryMatches": "_bytes" } }

// Find every panel with the deny-listed unit "none"
{ "filter": { "unit": "none" } }

// Find every panel with no unit at all, to triage independently
// (requires reading inspect detail:'panels' rather than panel_find,
// because the absence of a unit isn't a filter field — yet).
```

The third case (no-unit panels) is currently a gap in the closed
filter DSL — call `grafana_dashboard_inspect` with `detail: 'panels'`
and filter client-side on `unit === undefined`. If that pattern is
common, file an issue and the closed set may grow a `hasUnit` filter.

### Step 2 — read the targets to confirm the suggestion

`grafana_dashboard_inspect` with `detail: 'panels'` returns each
panel's `targets[]` already (the field shipped in PR #32). For the
found ids, read the panel rows and look at `targets[i].expr` to
decide the right unit. The skill's mapping table above tells you
which.

This step is where the LLM's taste lives: the heuristics "ends in
`_total` and wrapped in `rate(...)` → reqps" are the kind of judgement
that doesn't belong in code (§1.8) but a model with the skill in
context handles cleanly.

### Step 3 — apply each fix

```jsonc
// For each panel id where the suggested unit is, say, "reqps":
{
  "tool": "grafana_dashboard_panel_update",
  "arguments": {
    "dashboard": current,
    "panelId": 447,
    "patch": {
      "fieldConfig": { "defaults": { "unit": "reqps" } }
    }
  }
}
```

Thread the returned `dashboard` into the next call. The full bulk
workflow (find → loop → validate) is documented at
[`bulk-panel-updates.md`](./bulk-panel-updates.md).

### Step 4 — validate

Run `grafana_dashboard_validate` on the final dashboard. Unit fixes
are local to `fieldConfig.defaults.unit` and won't introduce dangling
variable refs, but the validate pass catches anything unrelated you
might have touched.

### Step 5 — re-check via `grafana_dashboard_lint`

If the team installs `skills/grafana-style-guide.md`, the
`panels.units.allowList` / `panels.units.deny` rules in
`grafana_panel_lint` / `grafana_dashboard_lint` will surface any
remaining mismatches. The lint primitive doesn't suggest the right
unit — it enforces the team's allow-list — but it confirms the audit
landed cleanly.

---

## Worked example

CCS dashboard from the original #31 session: 19 timeseries panels
tagged `unit: "short"` whose queries used `rate(*_total[…])`.

```jsonc
// 1. Find them
const find = await mcp.call("grafana_dashboard_panel_find", {
  dashboard,
  filter: { unit: "short", queryMatches: "rate\\(" }
});
// find.panelIds → [447, 450, 504, ... (19 ids)]

// 2. Read targets to confirm each should be reqps (vs ops / wps)
const panels = await mcp.call("grafana_dashboard_inspect", {
  dashboard,
  detail: "panels"
});
// inspect each panel's targets[0].expr; pick the unit from the skill's
// mapping. In this dashboard all 19 are HTTP request rates → reqps.

// 3. Patch each
let current = dashboard;
for (const panelId of find.panelIds) {
  const r = await mcp.call("grafana_dashboard_panel_update", {
    dashboard: current,
    panelId,
    patch: { fieldConfig: { defaults: { unit: "reqps" } } }
  });
  if (r.errors.length === 0) current = r.dashboard;
  else /* record failure */;
}

// 4. Validate
await mcp.call("grafana_dashboard_validate", { dashboard: current });

// 5. (Optional) Lint against the team style guide
await mcp.call("grafana_dashboard_lint", {
  dashboard: current,
  styleGuide: /* parsed JSON block from skills/grafana-style-guide.md */
});
```

The original session did all of this with custom bash scripts. The
above is two MCP-tool calls per panel plus one find + one validate —
no scripts, no shell escaping, no silent partial state. The cost the
Naysayer flagged on the bulk tool (latency + envelope tokens) is real
but the failure-attribution win is bigger.

---

## When you're not sure

- **The query is a sum / count / average** — not a rate. Skip the
  rate→reqps mapping; consider `short` for raw counts,
  `percentunit` / `percent` for derived ratios.
- **The metric name doesn't end in a known suffix** (`_total`,
  `_seconds`, `_bytes`). Read the metric's HELP text via Prometheus
  exposition (use `prometheus_metric_parse` if you have the
  `/metrics` body) — the HELP often names the unit directly.
- **The panel is a `stat` / `gauge`** displaying a single value.
  Same unit rules apply; the skill's "panel types" section notes
  that units / descriptions are uniform across panel types.

---

## References

- [`skills/grafana-style-guide.md`](../../skills/grafana-style-guide.md)
  §Units — the canonical opinion this doc operationalises.
- [`docs/guidance/bulk-panel-updates.md`](./bulk-panel-updates.md) —
  the underlying `find → loop update → validate` pattern.
- `research.md` Entry 015 — why the dedicated `panel_update_bulk` was
  cut in favor of composition.
- Issue #31 (closed) — original wishlist where this audit was the
  motivating example.
