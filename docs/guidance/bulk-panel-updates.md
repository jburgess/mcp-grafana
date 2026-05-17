# Bulk panel updates

Apply the same kind of fix to many panels in one workflow. This is the
audit pattern: find a class of panels (every `timeseries` with unit
`short` whose query uses `rate(`), apply a fix (set `unit: 'reqps'`,
add a description), validate the result.

mcp-grafana **does not ship a dedicated `panel_update_bulk` tool**.
The pattern below — `grafana_dashboard_panel_find` →
`grafana_dashboard_panel_update` per id → `grafana_dashboard_validate`
— composes two existing primitives, gives per-panel error attribution
for free, and matches the audit workflow's natural shape (independent
panel-level updates, retry only the ones that fail).

See the "Why no dedicated bulk tool?" section at the end for the
design rationale and `research.md` Entry 015 for the full debate.

---

## The pattern

### Step 1 — find the panels

`grafana_dashboard_panel_find` returns the ids of panels matching a
closed-set filter (`type`, `unit`, `hasDescription`, `queryMatches`).
AND semantics; empty filter matches every panel.

```jsonc
// Tool call:
{
  "tool": "grafana_dashboard_panel_find",
  "arguments": {
    "dashboard": { /* ... */ },
    "filter": {
      "type": "timeseries",
      "unit": "short",
      "queryMatches": "rate\\("
    }
  }
}

// Returns:
// { "panelIds": [504, 535, 454, 638, ...], "errors": [] }
```

If the filter is wrong (typo in `queryMatches`, unknown filter key),
you get an error here — *before* you start mutating the dashboard.

### Step 2 — update each panel

For each id in `panelIds`, call `grafana_dashboard_panel_update` with
the patch you want to apply. The patch is RFC 7396 JSON Merge Patch —
the same semantics as a single `panel_update` call.

Thread the returned `dashboard` into the next call so each update sees
the previous one's effect:

```jsonc
let current = inputDashboard;
for (const panelId of panelIds) {
  const { dashboard, errors } = await mcp.call("grafana_dashboard_panel_update", {
    dashboard: current,
    panelId,
    patch: {
      fieldConfig: { defaults: { unit: "reqps" } },
      description: "Request rate per second (was 'short'-unit before audit)"
    }
  });
  if (errors.length > 0) {
    // record the failure, skip this panel, keep going
    failures.push({ panelId, errors });
    continue;
  }
  current = dashboard;
}
```

**Each call is independently atomic.** A failure on one panel does
not roll back the others — which is what you want for an audit
workflow where the patches are independent by construction.

### Step 3 — validate the result

After the loop, run `grafana_dashboard_validate` on `current` to catch
anything the per-panel patches introduced — dangling variable refs,
broken gridPos, duplicate ids, etc.

```jsonc
{
  "tool": "grafana_dashboard_validate",
  "arguments": { "dashboard": current }
}

// Returns { valid, errors: [{ path, message }] }
```

If `valid: false`, the patches landed but the result has a problem.
You can apply more patches to fix it, or hand the dashboard back with
the validation report.

---

## What to report to the user

After the loop:

- **N applied** — count of successful updates (`panelIds.length - failures.length`).
- **M failed** — count of `panel_update` failures, with per-panel
  `errors[]`. The model can retry only these ids with a refined patch.
- **Validation: pass / fail** — the post-loop `grafana_dashboard_validate`
  result. Pass means the resulting dashboard is structurally sound.
- **The modified dashboard** — `current` at the end of the loop.

This gives the user the same picture a single `panel_update_bulk` tool
would have given them, with one important advantage: **the failures
are attributed to individual panel ids**, not buried in a transactional
"the whole batch failed" error.

---

## Worked example: fix all 19 panels with unit "short" that use `rate(`

From the original session that motivated issue #31:

```jsonc
// 1. Find them
const find = await mcp.call("grafana_dashboard_panel_find", {
  dashboard,
  filter: { type: "timeseries", unit: "short", queryMatches: "rate\\(" }
});
// find.panelIds → [447, 450, 504, 535, 638, ... (19 ids)]

// 2. Patch each
let current = dashboard;
const failures = [];
for (const panelId of find.panelIds) {
  const r = await mcp.call("grafana_dashboard_panel_update", {
    dashboard: current,
    panelId,
    patch: { fieldConfig: { defaults: { unit: "reqps" } } }
  });
  if (r.errors.length > 0) failures.push({ panelId, errors: r.errors });
  else current = r.dashboard;
}

// 3. Validate
const val = await mcp.call("grafana_dashboard_validate", { dashboard: current });

// 4. Report: "Patched 17 of 19 panels to unit:reqps. Validation passed.
//    2 panels failed: panel 638 (unknown id — possibly removed since the
//    find call), panel 535 (patch.id rejected — patch tried to change panel id)."
```

---

## When you DO want all-or-nothing

If the patches form a logical unit and you need them to all-succeed or
none-apply (e.g. a dashboard migration where partial state would be
worse than no state), the pattern is different:

1. Clone the dashboard (`structuredClone(dashboard)`).
2. Apply patches in the loop against the clone.
3. On any failure, **discard the clone** — the original is untouched.
4. On full success, return the clone.

mcp-grafana also doesn't ship a transactional primitive for this. The
pattern above lives in code that owns the workflow; it's three lines
to write and stays grep-able. If a real workflow surfaces where the
three-line copy is painful, file a follow-up issue with the specific
case — the team will revisit the cut decision with that data.

---

## Why no dedicated bulk tool?

Issue #31 item 3 proposed `grafana_dashboard_panel_update_bulk` as
"one call, one validation" — the original session ran 76 panel
updates via a bash loop and bypassed the MCP-validated path.

A three-perspective design pass (`research.md` Entry 015) decided
**cut**, with this guidance doc as the replacement:

- **Atomicity is wrong for the audit-fix use case.** The motivating
  workflow is independent panel-level updates (add a description here,
  change a unit there). All-or-nothing rollback when 2 of 19 fail
  means the LLM has to re-issue the 17 valid patches anyway, *with
  worse error attribution*. Best-effort per-panel is the right shape —
  and best-effort per-panel is just the loop above.
- **Tool-call count is mostly self-imposed taste.** 76 sequential
  `panel_update` calls cost ~75ms of CPU server-side. Token overhead
  for tool-call envelopes is ~50 × 76 ≈ 4k tokens. Real, but modest.
- **Failure attribution is better per-call.** "Panel 638 not found"
  said once is clearer than "patch[7] failed: panel 638 not found"
  embedded in a 76-element outcomes array.
- **§1.6 small composable builders.** `panel_find` + `panel_update` +
  `validate` already compose into the workflow above. Adding a fourth
  tool for the compose-them-yourself case would dilute the family.

If telemetry from real LLM sessions shows the loop's overhead is
moving the needle on completion rate or user satisfaction, file an
issue with the data and the cut will be revisited. Until then: the
loop above is the answer.