# Session resource registry for dashboards

Keep large dashboard JSON out of the LLM's context. The dashboard-
consuming MCP tools (`inspect`, `validate`, `lint`, `panel_insert`,
`_update`, `_move`, `_remove`, `panel_find`, `variable_rename`,
`panel_validate`) all accept a session-registry URI as an alternative
to inline dashboard JSON. The full JSON enters context exactly once —
during an explicit `grafana_dashboard_export` step at the end of the
workflow, if you need it back at all.

For a 15k-line dashboard (`test/fixtures/node-exporter-full.json` —
roughly 50–70k tokens), inline-passing through every tool call
multiplies that cost across every step. The registry pattern reduces
that to one load + one optional final export.

See issue #65's body for the three-expert design pass that produced
this shape, and AGENTS.md §1.8 for the no-filesystem-write boundary
that rules out the obvious "write modified dashboards back to disk"
alternative.

---

## The pattern

### 1. Load once

`grafana_dashboard_load` reads a JSON file from disk into the
session-scoped registry and returns a URI.

```jsonc
// Tool call:
{
  "tool": "grafana_dashboard_load",
  "arguments": { "path": "./dashboards/node-exporter.json" }
}

// Returns:
// { "uri": "mcp://grafana/session/dashboard/1" }
```

The dashboard JSON does **not** flow into your LLM context — only the
URI does. The registry holds one parsed copy per `McpServer` instance
(which is per session), and the slot lives until you close it or the
session ends.

### 2. Read via URI

Every dashboard-consuming read tool accepts `dashboardUri` as an
alternative to inline `dashboard`:

```jsonc
// Get a bounded summary without pulling the JSON:
{
  "tool": "grafana_dashboard_inspect",
  "arguments": {
    "dashboardUri": "mcp://grafana/session/dashboard/1",
    "detail": "summary"
  }
}
// Returns: { title, panelCount, variables[], rows[], … }
```

Same for `validate`, `lint`, `panel_find`, `panel_validate`. The
response shape is unchanged — same structured view, same lint issues,
same panel ids — only the *input* form differs.

### 3. Write via URI

The five write tools (`panel_insert`, `panel_update`, `panel_move`,
`panel_remove`, `variable_rename`) also accept `dashboardUri`. With
the URI form, the tool **mutates the registry slot in place** on
success and returns `{ uri, summary, errors[], ...rest }` instead of
the usual `{ dashboard, errors[] }`. The full modified dashboard
never enters your context.

```jsonc
{
  "tool": "grafana_dashboard_panel_update",
  "arguments": {
    "dashboardUri": "mcp://grafana/session/dashboard/1",
    "panelId": 42,
    "patch": { "fieldConfig": { "defaults": { "unit": "reqps" } } }
  }
}
// Returns:
// {
//   "uri": "mcp://grafana/session/dashboard/1",
//   "summary": { "title": "Node Exporter", "panelCount": 141, … },
//   "errors": []
// }
```

The `summary` mirrors `grafana_dashboard_inspect detail:"summary"` so
you can verify the change took effect (count, variables, layout
bounds) without pulling the dashboard.

Tool-specific extras flow through too. `variable_rename` returns
`rewrites` (count of textual changes) and `locations[]` (every change
site) on the URI path — they're small and exactly what you want from
that tool.

### 4. Export at the end (if you need the JSON back)

When the workflow is done and you actually need the modified JSON —
to post to Grafana's HTTP API or hand to the host's `Write` tool —
call `grafana_dashboard_export` once:

```jsonc
{
  "tool": "grafana_dashboard_export",
  "arguments": { "uri": "mcp://grafana/session/dashboard/1" }
}
// Returns:
// { "dashboard": { /* full modified JSON */ } }
```

This is the **only** step that puts the full JSON in your context.
Per AGENTS.md §1.8 the server itself never writes to your filesystem;
exporting hands the JSON back so the host can write it via its own
tools (Claude Code's `Write`, Cursor's edit primitives, etc.).

### 5. Close (optional)

`grafana_dashboard_close` frees a registry slot before session end.
Sessions that load a few dashboards and exit don't need to call this
— the registry is collected when the `McpServer` is discarded.

```jsonc
{
  "tool": "grafana_dashboard_close",
  "arguments": { "uri": "mcp://grafana/session/dashboard/1" }
}
// Returns: { "removed": true }
```

Idempotent — closing an unknown URI returns `removed: false`, not an
error.

---

## When to use registry vs inline

Pick **inline `dashboard`** when:

- The dashboard is small (a few panels, just-built via
  `grafana_dashboard_build`).
- You're doing a one-shot read (one `inspect`, one `validate`) and
  don't want the load/close ceremony.
- The dashboard exists in your context already (e.g. you assembled it
  this turn from panel builders).

Pick **`dashboardUri`** when:

- The dashboard is large (≥ several hundred lines / many panels).
- You'll touch it more than once in the workflow (audit → fix → verify
  pattern).
- You want to chain write tools (`insert` → `update` → `move` → `lint`)
  without re-passing the dashboard each call.

Inline and URI calls can mix freely within a session; they're two
shapes of input, not two modes of the server.

---

## Worked example: audit → fix → verify

Find every timeseries panel with unit `short` whose query uses
`rate(`, change the unit to `reqps`, add a description, then validate.
The full dashboard JSON enters your context once at export — not 76
times during the loop.

```jsonc
// 1. Load.
const { uri } = await mcp.call("grafana_dashboard_load", {
  path: "./dashboards/services.json",
});

// 2. Find candidates (no JSON in context).
const { panelIds } = await mcp.call("grafana_dashboard_panel_find", {
  dashboardUri: uri,
  filter: { type: "timeseries", unit: "short", queryMatches: "rate\\(" },
});

// 3. Loop: update each panel via URI (mutates registry in place).
for (const panelId of panelIds) {
  const { errors } = await mcp.call("grafana_dashboard_panel_update", {
    dashboardUri: uri,
    panelId,
    patch: {
      fieldConfig: { defaults: { unit: "reqps" } },
      description: "Request rate (was 'short' before audit)",
    },
  });
  if (errors.length > 0) {
    failures.push({ panelId, errors });
  }
  // On success: { uri, summary: {...}, errors: [] } — no dashboard JSON.
}

// 4. Validate the cumulative result (no JSON in context).
const { valid, errors: validationErrors } = await mcp.call(
  "grafana_dashboard_validate",
  { dashboardUri: uri },
);

// 5. Export the modified JSON ONCE — only if you need to write it back.
const { dashboard } = await mcp.call("grafana_dashboard_export", { uri });
// Now hand `dashboard` to your host's Write tool (Claude Code's Write,
// Cursor's edit primitives, etc.) or POST to Grafana's HTTP API.
```

Without the registry, every `panel_update` call would carry the full
dashboard in and the full modified dashboard back out — 76 inputs +
76 outputs of 50k tokens each, compounded into your context window.
With the registry, the JSON enters your context exactly once, at step
5, and only if you actually need it.

See `docs/guidance/bulk-panel-updates.md` for the standalone audit
pattern; this doc shows the same pattern with the registry overlay.

---

## Worked example: build → verify (no export)

When you're building a dashboard from scratch via `panel_build` tools
and want to verify it without serialising the JSON back through
context:

```jsonc
// Build panels in context (small JSON each).
const panel1 = await mcp.call("grafana_timeseries_panel_build", {...});
const panel2 = await mcp.call("grafana_stat_panel_build", {...});

// Assemble inline — small enough to pass through one call.
const { dashboard } = await mcp.call("grafana_dashboard_build", {
  title: "New Service",
  panels: [panel1, panel2],
});

// At this point you have the dashboard in context. If you want to do
// many more operations on it (lint with multiple rules, add more
// panels, rename variables), register it once and switch to URI form:
//
//   1. Write `dashboard` to a temp file via the host's Write tool.
//   2. grafana_dashboard_load that path.
//   3. Continue in URI form.
//
// For small built dashboards (one or two more ops), staying inline is
// simpler. The registry pays for itself when the dashboard is large
// OR the operation count is high; both, ideally.
```

---

## Lifecycle and isolation

- **Per session.** The registry is one `Map` per `McpServer` instance.
  Each MCP session creates a fresh server, so URIs from one session
  do **not** resolve in another (verified by an end-to-end test).
- **In-memory only.** Nothing is written to disk by the registry —
  per AGENTS.md §1.8 the server never writes to your filesystem.
- **Sequential ids.** URIs are `mcp://grafana/session/dashboard/<n>`
  with `<n>` starting at 1. Same dashboard loaded twice gets two
  distinct slots; this is intentional (you might want both copies for
  a modify-and-diff workflow).
- **Deep-clone discipline.** `load`, `register`, `export`, and
  `replace` all deep-clone on the relevant boundary. Caller mutation
  of an exported dashboard cannot reach back to the registry copy.

---

## When NOT to use the registry

- **Cross-session persistence.** The registry is per-session and goes
  away on session end. If you need a long-lived store, that's outside
  the registry's scope (and outside §1.8 — the project does not write
  to your filesystem).
- **Sharing dashboards between sessions / users.** Use Grafana's own
  HTTP API or a shared filesystem.
- **As a substitute for source control.** The registry is workflow
  scratch space, not history. Commit the dashboard JSON you export.

---

## Future work

- **Register-an-in-context-object shortcut.** Today, if you have a
  dashboard in context (e.g. just built via `grafana_dashboard_build`)
  and want to move it to the registry, the path is "write to a temp
  file via the host's Write tool, then `grafana_dashboard_load` that
  path." A future `grafana_dashboard_register({ dashboard })` would
  skip the temp file. Not built; file an issue with a concrete
  workflow if the dance is friction.
- **HTTP / Grafana-API source siblings.** `grafana_dashboard_fetch`
  (URL) and `grafana_dashboard_pull` (Grafana HTTP API) are natural
  siblings of `grafana_dashboard_load` that would share the registry.
  Listed as out-of-scope in #65's body; trivial to add as new sources
  once a real use case surfaces.

## See also

- `grafana_dashboard_load` / `_export` / `_close` tool descriptions —
  the on-tool docs (visible in your MCP client's tool list).
- `docs/guidance/bulk-panel-updates.md` — the audit-fix pattern this
  doc overlays the registry on.
- Issue #65 — the four-item umbrella that delivered this feature.
- AGENTS.md §1.8 — the no-filesystem-write boundary that motivates
  the design.
