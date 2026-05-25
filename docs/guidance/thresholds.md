# Setting thresholds across a dashboard

The audit pattern for "I want a red line where the SLO is breached."
This document is operational — HOW to find panels that should carry a
threshold and apply the right shape with the existing primitives.
The OPINION about what shape a threshold should take lives in
[`skills/grafana-style-guide/SKILL.md`](../../skills/grafana-style-guide/SKILL.md)
§Thresholds.

Issue #31 originally proposed a dedicated `thresholds_suggest` tool.
A team review cut it per AGENTS.md §1.8 — threshold shape is taste
that depends on the SLO, the metric type, and the team's alerting
philosophy. The team-review framing from the cut was *"the discipline
of refusing is the value"* — only emit thresholds where the unit
makes them obvious, refuse for rates/latencies without SLO context.
The guidance below codifies that discipline as a pattern, not as a
tool.

---

## When a threshold is safe to suggest

From the skill body — the cases where the unit alone tells you the
threshold:

| Unit / shape | Threshold |
|---|---|
| `bool_yes_no` (0/1 values, single-step metric like `*_enabled`) | `[{red, value: null}, {green, value: 1}]` — red below 1, green at 1 |
| Error-class counters (panel name contains `error` / `failed` / `failure`, value-cardinality 0..N) | `[{green, null}, {yellow, value: 0.0001}, {red, value: 1}]` — any non-zero is yellow, sustained is red. **Adjust to your team's SLO** |
| Cumulative-error-rate panels (rate of error-class counter) | Conservative: yellow at any rate > 0; red at the SLO budget burn |

## When a threshold is NOT safe to suggest

The skill's framing is explicit: *"tie thresholds to SLO budget, not
to round numbers."* A red line at exactly `0.995` because that's the
SLO is more useful than a red line at `0.99` because it's round. The
guidance below honors this:

- **Rates** (`reqps`, `ops`, `wps`) — there's no universal "too high"
  for a rate. The threshold depends on whether you're capacity-
  planning (high rate = scaling event) or SLO-monitoring (rate
  surfaces nothing about user impact). **Skip unless you have an SLO
  in hand.**
- **Latencies** (`s`, `ms`) — same story. A 1s p99 is fine for batch,
  bad for interactive. **Skip without SLO context.**
- **Generic percentages** with no anchored meaning (e.g. CPU
  utilization vs SLI compliance ratio) — the right thresholds depend
  on what the metric measures, not what unit it carries.

When in doubt, **don't set a threshold**. A missing threshold is
honest; a wrong threshold is misleading.

---

## The pattern

### Step 1 — find threshold-eligible panels by unit shape

`grafana_dashboard_panel_find` with `unit` matching the shapes above:

```jsonc
// bool_yes_no enabled-state stats — usually safe to set a red/green threshold
{ "filter": { "unit": "bool_yes_no" } }

// percent panels — may or may not be safe; need to read titles to filter
// further (see Step 2)
{ "filter": { "unit": "percent" } }

// Error-class panels: filter by title token
{ "filter": { "queryMatches": "_errors_total|_failed_total|_failure_total" } }
```

The find tool's filter DSL doesn't support negative matches on title
(today). For "find panels whose title contains 'error'", use
`grafana_dashboard_inspect detail:'panels'` and filter the rows
client-side. Tracked as a possible future filter; see issue tracker
for status.

### Step 2 — confirm each panel deserves a threshold

For each candidate id, read its row from `inspect detail:'panels'` and
ask:

- **Does the unit alone tell me the threshold?** (bool_yes_no, named-
  error counter — yes; rate / latency / generic percent — no.)
- **Do I have an SLO in hand?** (If not, default to the "refuse"
  branch. The skill is opinionated about this: refusal IS the value.)
- **Would a wrong threshold mislead?** (For a `bool_yes_no` enabled
  stat, the threshold is obvious — green at 1, red below. For a
  latency p99, the threshold could be 100ms or 10s and a viewer
  would believe whatever you set. Skip.)

If the answer to any of those is "no" / "no" / "yes," **don't set a
threshold for that panel** in this audit pass. Leave it for whoever
owns the SLO.

### Step 3 — apply each fix

Grafana's threshold shape lives at
`panel.fieldConfig.defaults.thresholds`. The patch:

```jsonc
{
  "tool": "grafana_dashboard_panel_update",
  "arguments": {
    "dashboard": current,
    "panelId": 854,
    "patch": {
      "fieldConfig": {
        "defaults": {
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "red", "value": null },
              { "color": "green", "value": 1 }
            ]
          }
        }
      }
    }
  }
}
```

For `mode: 'percentage'` (thresholds relative to the panel's min/max),
the `steps` `value` field is `0..100`. The `null` first-step value
means `-Infinity` (everything below the next step's value).

### Step 4 — validate

`grafana_dashboard_validate` on the final dashboard. Threshold-shape
errors (missing `mode`, non-numeric `value`) currently won't surface
through the validator's rules (the validator covers `id`, `gridPos`,
variable refs — not threshold-step shape). The fix is the same as for
all panel-config concerns: trust Grafana's own schema validation at
import time. The integration suite (`test/integration/`) confirms
generated thresholds load cleanly in Grafana 12.4.

### Step 5 — sanity-check via the lint primitive

The lint tools don't currently surface a `thresholds-required` rule
(Entry 014 cut the heuristic-rule rule out; the structural-only rule
would have been `single-step-threshold`, also cut as taste). If
present, they'd warn for panels with only one user-defined threshold
step — usually a sign the author meant to set both endpoints. The
manual check: for each panel you patched, confirm
`fieldConfig.defaults.thresholds.steps.length >= 2` (the base step
plus at least one user-defined transition).

---

## Worked example

CCS dashboard from the original #31 session: 4 `Enabled` stat panels
plotting `sum(*_enabled)` (values 0 or 1) had no thresholds.

```jsonc
// 1. Find them — bool_yes_no panels are usually safe
const find = await mcp.call("grafana_dashboard_panel_find", {
  dashboard,
  filter: { unit: "bool_yes_no" }
});
// find.panelIds → [854, 856, 858, 860]

// 2. Confirm via inspect — verify each is plotting a 0/1 metric
const panels = await mcp.call("grafana_dashboard_inspect", {
  dashboard,
  detail: "panels"
});
// All 4 panels plot sum(*_enabled) — values 0 or 1; safe threshold.

// 3. Patch each with [{red, null}, {green, 1}]
let current = dashboard;
const threshold = {
  mode: "absolute",
  steps: [
    { color: "red", value: null },
    { color: "green", value: 1 }
  ]
};
for (const panelId of find.panelIds) {
  const r = await mcp.call("grafana_dashboard_panel_update", {
    dashboard: current,
    panelId,
    patch: { fieldConfig: { defaults: { thresholds: threshold } } }
  });
  if (r.errors.length === 0) current = r.dashboard;
}

// 4. Validate
await mcp.call("grafana_dashboard_validate", { dashboard: current });

// 5. Sanity check: every patched panel now has a 2-step threshold
//    (read inspect detail:'panels' and verify, or load in Grafana).
```

The author's original session set thresholds on exactly these 4 panels
— the ones where the unit shape made the threshold obvious — and
deliberately did NOT touch the latency / rate panels. The pattern
above codifies that discipline.

---

## Anti-patterns

- **Don't set thresholds for rates or latencies without an SLO.** A
  red line at "1000 reqps" or "1s p99" is wrong if your SLO is
  different. Wrong thresholds mislead more than missing ones.
- **Don't use round numbers when the SLO is a non-round number.**
  Red at 0.995 because that's the SLO is more useful than red at
  0.99 because it's round.
- **Don't set a single-step threshold without rationale.** A panel
  with only `{red, null}` (everything is red) or only `{green, 1}`
  (no base case) is usually a mistake. Set two endpoints — a base
  color via the `value: null` step, plus at least one transition.
- **Don't suggest thresholds for ad-hoc / discovery dashboards.**
  Those are for exploration; thresholds imply "this is a known-bad
  region" — a claim discovery doesn't get to make.

---

## References

- [`skills/grafana-style-guide/SKILL.md`](../../skills/grafana-style-guide/SKILL.md)
  §Thresholds — the canonical opinion this doc operationalises.
- [`docs/guidance/bulk-panel-updates.md`](./bulk-panel-updates.md) —
  the underlying `find → loop update → validate` pattern.
- [`docs/guidance/units.md`](./units.md),
  [`docs/guidance/descriptions.md`](./descriptions.md) — sibling
  audit patterns; thresholds often land in the same pass as the
  unit + description audit.
- `research.md` Entry 015 — why the dedicated bulk-update and
  per-rule suggestion tools were cut in favor of composition + skill
  prose.
- Issue #31 (closed) — original wishlist where this audit was the
  motivating example.
- Grafana docs on thresholds (panel options) — for the full set of
  threshold-step fields.
