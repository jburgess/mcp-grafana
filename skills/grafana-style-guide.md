---
name: grafana-style-guide
description: Use before building, generating, or reviewing a Grafana panel or dashboard. Starter style guide covering panel-level rules (units, legends, thresholds, titles, descriptions — timeseries-focused) and dashboard-level rules (row sequencing, drill-down chaining, repeating-panel caps, named anti-patterns). Modeled on the kubernetes-mixin / monitoring-mixins corpus, Grafana Labs' Mimir / Loki / Tempo reference dashboards, and the canonical observability dashboard literature (Shneiderman 1996, Stephen Few, the SRE Workbook). Copy into your skills / rules directory and edit for your team; mcp-grafana ships it as a starter, not a managed default.
---

# Grafana style guide

A starter style guide for Grafana, modeled on the kubernetes-mixin /
monitoring-mixins corpus. The prose explains *why* each convention
exists; the JSON block at the end is a `GrafanaStyleGuide` instance
suitable for passing to the `lintPanel` library function or the
`grafana_panel_lint` MCP tool.

This skill is a copyable artifact. Fork it, edit it, version it in your
own dotfiles — mcp-grafana does not auto-update or otherwise manage the
copy you install. If your team disagrees with any rule below, the right
move is to change it in your local copy.

---

## Guiding vision

Design top-down, signal-first. Grafana dashboards follow Ben
Shneiderman's *"overview first, zoom and filter, details on demand"*
([Visual Information-Seeking Mantra, 1996](https://infovis-wiki.net/wiki/Visual_Information-Seeking_Mantra))
— also called the *inverted pyramid* in BI writing, and consistent
with Stephen Few's *at-a-glance monitoring* (upper-left wins, because
location is the dominant emphasis channel).

The **first row is the fold** — it loads first, it is the only thing
some viewers will read, and it must answer *is anything on fire?* in
under a second. Rows below add detail in widening scope; **linked
dashboards** carry context further via preserved templating
variables (`$cluster` → `$namespace` → `$instance`). The reader's
eye learns one row shape and scans down; one click and the next
dashboard arrives pre-filtered.

The pattern has two known failure modes worth designing around:

- **Debugging dashboards** — once the operator is asking *"why is
  checkout slow?"* rather than *"is anything wrong?"*, hierarchy
  hurts (Charity Majors,
  [*Notes on the Perfidy of Dashboards*, 2021](https://charity.wtf/2021/08/09/notes-on-the-perfidy-of-dashboards/)).
  Build separate task-specific dashboards; one dashboard cannot be
  both orientation and debugger.
- **NOC wall displays** — for operators glancing rather than
  scrolling, lateral equal-weight tiles beat vertical scroll. The
  salient signal is *any red square*, not "the top row."

The rules below implement this philosophy. `## Dashboards` carries
the concrete row-by-row prescription; the panel sections carry the
within-panel rules.

## Scope

This v0.2 of the guide covers **Grafana panels** (units, legends,
thresholds, titles, descriptions — timeseries-focused; stat / table /
heatmap follow the same unit and description rules) and **dashboard-
level conventions** (row sequencing, drill-down chaining, repeating-
panel discipline, anti-patterns).

Areas not yet covered, planned for subsequent revisions:

- **Alert rules** — naming patterns, label conventions, annotation
  templates, SLO-budget thresholds vs round-number thresholds.
- **Recording rules** — `level:metric:operations` naming
  (per Prometheus's recommended pattern), scrape-interval alignment.
- **Folder / tag taxonomy** — how to organize collections of
  dashboards.

Forks may add or remove sections freely. The skill is a starter, not a
specification.

---

## Units

Grafana display units control how raw numbers render in tooltips, axes, and
legends. The choice carries a small amount of meaning every viewer absorbs;
inconsistency across panels in one dashboard is a readability tax.

- **Counters → rate before display.** A panel that plots `*_total` directly is
  a panel that goes up forever. Wrap in `rate()` / `irate()` /
  `increase()` before display and pick a per-second unit:
  - HTTP / RPC throughput → `reqps`
  - Generic operations → `ops`
  - Write throughput → `wps`
- **Bytes → `bytes`** (binary IEC) for almost everything; use `decbytes` (SI)
  only when the underlying metric is documented in SI (rare in
  Prometheus exposition; common in cloud-provider APIs).
- **Durations:**
  - Wall-clock latencies → `s` (Grafana auto-scales to ms / µs).
  - Long-running durations (uptimes, ages) → `dtdurations` for the
    "3d 7h" rendering.
- **Ratios in [0, 1]** → `percentunit`. Set `min: 0`, `max: 1` so the y-axis
  doesn't autoscale and visually exaggerate small movements.
- **Percentages in [0, 100]** → `percent`. Same advice on `min`/`max`.
- **Unitless counts** (pod count, replica count, queue depth) → `short`.
- **Avoid `locale`.** It renders with thousands separators that differ
  between viewers' locales — breaks screenshot diffs, breaks copy-paste
  into incident docs.
- **Avoid `none`.** If the metric truly is unitless, say `short`. `none`
  reads as "I forgot."

## Legends

Legend choice should follow the *cardinality of the series the panel
produces*, which is a property of the PromQL, not of the panel type.

- **Bounded cardinality (≤ ~10 series):** legend as **table on the right**
  with `mean`, `lastNotNull`, `max` calcs. Readable at a glance, and the
  three calcs cover "where is it now", "where does it usually sit", and
  "how bad does it get". Examples that qualify as bounded:
  - HTTP status class (`2xx | 3xx | 4xx | 5xx`)
  - `up{job="..."}` for a small fixed set of jobs
  - Latency quantiles (`p50 | p90 | p99`)
- **Unbounded cardinality (per-pod, per-customer, per-request-id):** legend
  **hidden**. Rely on the tooltip for inspection. A 200-row legend below a
  chart is noise, not signal.
- **Bottom list with no calcs** is rare and worth justifying. If you're
  reaching for it, ask whether the panel should be split into two.
- Avoid `legendFormat` strings that include the metric name. The panel title
  already names the metric; the legend should name the *series within it*
  (a label value, not the metric).

## Thresholds

- **Tie thresholds to SLO budget, not to round numbers.** A red line at
  exactly `0.995` because that's the SLO is more useful than a red line at
  `0.99` because it's round.
- **Color order:** green → yellow → red as values grow worse. For
  success-rate metrics, reverse: green at high, red at low.
- **Absolute vs percent:** prefer percent for ratios, absolute for latencies
  and queue depths. A latency threshold in percent is almost always a
  modelling mistake.

## Titles and descriptions

- **Title is a short noun phrase**, not a sentence. "Request rate by
  status", not "How many requests per second is the service handling
  broken down by HTTP status".
- **Description = the metric's HELP text** (verbatim where useful, lightly
  edited where the HELP text is awkward). Description shows up in the
  info tooltip — it's the one place a viewer learns what they're looking
  at without leaving the dashboard. Panels with no description are
  flagged by `grafana_dashboard_inspect`'s summary view; treat that count
  as a quality metric for your dashboard.
- **Panel title should not duplicate the dashboard title.** "HTTP service →
  HTTP request rate" is fine; "HTTP service → HTTP service request rate" is
  redundant.

## Panel types

This guide's prose is deepest on timeseries panels, but builders now
exist for all the common types (timeseries, stat, table, state-timeline,
heatmap, gauge, plus row) and the lint primitive already enforces
stat-specific rules (`stat.requiresComparison`, `stat.handlesUnknown`)
and a layout rule that keys on panel type (`layout.firstRowCategorical`).
Per-type *style* conventions beyond those continue to grow; the unit and
description rules apply uniformly across panel types in the meantime.

- **Timeseries** — the default. Anything that varies over time.
- **Stat** — single current value. Don't use for trends; the sparkline
  inside a stat panel is decorative, not analytical.
- **Table** — multi-column tabular data. Almost always wants a transformation
  pipeline; raw `instant` queries rarely render well as tables.
- **Gauge** — current value with a fixed range. Useful for percent /
  percentunit metrics; useless for unbounded ones. Set `min` and `max`
  (the `panels.gauge.requiresBounds` lint rule enforces this) — without
  them Grafana auto-scales the arc and the needle position is
  meaningless. The kubernetes-mixin / Mimir / Loki / Tempo corpus
  deliberately avoids gauges and uses stats with color thresholds even
  for percent-style metrics; gauges are a community-dashboard idiom
  worth questioning before adopting.

## Dashboards

The single most important dashboard-level decision is *what the
operator sees before they scroll*. Everything else is downstream.

### Row sequence

Top to bottom, every general-purpose service dashboard rhymes:

1. **Row 1 (the "fold")** — categorical health, not numeric. State-
   timeline of SLO state + active incidents + fleet status. The Mimir
   `overview.libsonnet` dashboard puts a 6-unit state-timeline ("are
   writes / reads / rules / alerting / storage passing?") next to a
   3-unit firing-alerts list; numeric tiles are deferred to row 2.
   The instinct to lead with big numbers ("requests/sec: 12,345!") is
   wrong — the operator's first question is *is anything red?*, not
   *what's the value?*.
2. **Row 2** — system-wide RED for request-driven services (Wilkie,
   [*The RED Method*, 2018](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/));
   USE matrix for resource-driven services (Gregg,
   [USE method](https://www.brendangregg.com/usemethod.html)).
   Big tiles, sized for emphasis. Every tile in this row needs a
   comparison signal alongside the number — see "Aggregate is not
   summary" below.
3. **Rows 3..N** — per-component decomposition, in **pipeline order**
   (Gateway → Distributor → Ingester → Storage), each row repeating
   the same triplet — `QPS | Latency (p50/p99) | Per-instance p99` —
   so a reader learns one row shape and scans down. This is the
   literal convention in the Mimir / Loki / Tempo writes and reads
   dashboards; the per-instance third panel is what makes outliers
   visible at incident speed.
4. **Last rows** — drill-down tables. Tables tend to sit immediately
   *below* the timeseries that motivates them (CPU timeseries → CPU
   quota table; memory timeseries → memory quota table) rather than
   in a separate "Tables" section. The pairing is what makes the
   table useful; stranded tables get scrolled past.

Dashboards that are *not* general-purpose (per-node, per-pod,
per-component deep-dives) deliberately skip the fold row and
open with timeseries — the audience knows what they're looking at and
will scroll. Don't blindly apply the row-1 fold convention.

Because that distinction is intent, not structure, the machine-checked
form of this rule (`layout.firstRowCategorical`, below) is opt-in by
**tag**: tag your overview dashboards `overview` and the linter checks
the fold only on those, leaving drill-downs alone. Adopt the tag as a
team convention and the "lead with categorical health" rule enforces
itself on exactly the dashboards it should.

### Aggregate is not summary

A green SLO tile with no comparison context is what Tufte calls a
*"service-engine-soon" light*: it tells the operator nothing about
*why*. Every top-row aggregate must carry a comparison signal — a
trailing sparkline, a previous-period delta (`+12% vs 7d`), or a
small-multiple grid alongside — so *"compared to what?"* is answerable
without leaving the row.

### Repeating panels: when to stop

`repeat by $variable` is the rule of thumb up to ~10 instances
(Grafana imposes no hard cap; ~10 is the operator-attention budget,
not a technical limit). Beyond that, it becomes the
**per-device-page anti-pattern** from the Cacti / Observium era —
pages enumerating every interface, every sensor, every CPU core as
its own panel, scaling by adding pixels rather than ranking. Above
~10, replace with one of:

- a sorted Top-N table (`grafana_table_panel_build`; rank descending,
  cap at 20-50)
- a state-timeline matrix (`grafana_state_timeline_panel_build`; rows =
  entities, columns = time, color = state)
- a heatmap (`grafana_heatmap_panel_build`; rows = entities, color =
  current value)

All three scale to hundreds of entities without exhausting pixels or
operator attention.

### Multi-timescale context

KPIs with daily or weekly cycles deserve a single row showing the
*same* metric at four resolutions side-by-side (1h / 24h / 7d / 30d
via per-panel `timeFrom` overrides). The MRTG tradition (Oetiker,
1995) got this right; modern Grafana dashboards mostly dropped it
because the time picker became dogma and TSDB-backed multi-range
queries were expensive. With recording rules and downsampled tiers
the cost is now negligible. Add when seasonality matters
(diurnal traffic, weekly batch loads, monthly billing cycles).

### Drill-down: scroll vs click

Scroll for *related* detail at the same scope; click for *deeper*
detail at a different scope. The crucial rule: linked dashboards
must preserve template variables. `$cluster` → `$namespace` →
`$instance` → `$pod` should chain so an operator landing on a
per-pod dashboard arrives pre-filtered. If a click forces re-picking
variables, the dashboard set has a hole.

### Stat-panel state semantics

Grafana stats default to two thresholds (green / red). The NMS
tradition encodes more states; the canonical mapping worth adopting:

- `1` → up / green
- `0` → down / red
- `null` / `NaN` → grey (telemetry absent is **not** healthy — a
  missing series must not read as a green tile). Grafana 12's
  default threshold logic colors `null` using the *lowest* threshold
  band, which silently produces green-or-red depending on your
  bottom band. To get grey-for-null reliably, set an explicit value
  mapping (`Null` / `NaN` → grey) on the stat panel or configure
  `noValue` text + a neutral background. Don't rely on threshold
  inheritance.
- explicit warning state → yellow
- acknowledged-but-still-firing → dim or badged, not hidden

The acknowledged dimension is orthogonal to the value: silenced
alerts should still show, with reduced visual weight, so the operator
knows the system is still in the bad state.

### Variance in the panel

Encode variance, central tendency, and reliability in one panel
rather than three. The SmokePing tradition is the canonical
illustration — median RTT as a colored line, distribution as graded
"smoke" behind it, packet loss as a color shift in the line itself.
The Grafana-native equivalents are under-used:

- **fill-between p10 / p90 with line at p50** for latency — one panel
  carries both the central tendency and the spread.
- **heatmap behind a timeseries** for the same idea with the full
  distribution exposed.
- **State Timeline above a Time Series** as two stacked panels with
  a shared time axis (Grafana 12 has no single-panel overlay mode for
  the two) — the lower panel shows the metric, the upper one shows
  its health-state classification across the same window.

Three panels for "latency p50", "latency p99", "error rate" can
often collapse to one panel that says the same thing with less
scanning.

### Dashboard shape as code

Grafana's own data: ~60% of hand-built dashboards go unused
([Grafana 7.4 release post, 2021](https://grafana.com/blog/new-in-grafana-7-4-export-usage-data-to-loki-to-help-manage-dashboard-sprawl-and-troubleshoot-faster/)).
For any dashboard set bigger than ~3 services, generate dashboards
from a single template rather than hand-building each — the
[monitoring-mixins](https://monitoring.mixins.dev/) pattern
(dashboards + alerts + recording rules as a generated bundle).
Every service inherits the same row sequence, the same panel widths,
the same drill-down chain. Hand-tweaking individual dashboards is
what produces sprawl. For Grafana-12-era teams not on jsonnet, this
library's TS builders (`buildTimeseriesPanel`, `buildRowPanel`,
`buildStatPanel`, `buildTablePanel`, `buildStateTimelinePanel`,
`buildHeatmapPanel`, `buildGaugePanel` today) give the same generative
path on a different substrate.

### Anti-patterns

- **"Data-to-Dashboard"** — telemetry is collected, rendered as
  panels, and the operator is expected to synthesize meaning from raw
  plots. Usually they don't, and the dashboard becomes furniture.
  Named by William Louth,
  [*From Data to Dashboard*, OpenSignals, 2024](https://opensignals.io/blog/from-data-to-dashboard-an-observability-anti-pattern).
  The fix is to put *synthesized* signals (SLO state, burn rate, error
  budget remaining) at the top — not just *displayed* signals.
- **"Green Dashboard Paradox"** — every panel green while the system
  is on fire, because the failure mode isn't on the dashboard. The fix
  is signal-first row ordering: SLO state on top, not per-component
  metrics. If your SLO definition doesn't catch the failure, the
  dashboard never will either.
- **"Wall of Dashboards"** — sprawl. The fix is *dashboards as code*
  (above), not discipline.
- **"Per-device page reincarnated"** — `repeat by $host` over a fleet
  of 50+ instances, producing a 200-panel scroll. See "Repeating
  panels" above.
- **"Service-engine-soon dashboard"** (Tufte adapted) — aggregate
  tiles without comparison context. See "Aggregate is not summary".

### Operational patterns

This skill carries the *opinion* — what good looks like. The
project-authored guidance documents carry the *workflow* — how to
apply opinion to an existing dashboard (find → loop update →
validate):

- `mcp://grafana/docs/guidance/units.md` — audit and fix panel units
  across a dashboard.
- `mcp://grafana/docs/guidance/descriptions.md` — audit and fill
  missing descriptions.
- `mcp://grafana/docs/guidance/thresholds.md` — when to set a
  threshold vs refuse.
- `mcp://grafana/docs/guidance/bulk-panel-updates.md` — the
  `panel_find` → loop `panel_update` → `validateDashboard` pattern
  the audit workflows lean on.
- `mcp://grafana/docs/guidance/session-resource-registry.md` — keep
  large dashboard JSON out of LLM context: `dashboard_load` once,
  pass the URI to every read/write tool, `dashboard_export` only when
  you actually need the JSON back. Reach for it on dashboards over a
  few hundred lines, or when chaining multiple write operations.

Each guidance doc defers opinion to this skill; this skill defers
workflow to those docs. Reach for both.

### What is *not* machine-checked yet

The lint primitive (`lintPanel` / `lintDashboard`) currently checks
the structural rules in the JSON block below: dashboard-level
(`duplicateTitles`, `maxRepeat`, `hiddenButReferenced`,
`emptyDefault`, `preservesVariables`, `datasourceDeclared`,
`orphanRow`, `unreferenced`, `layout.firstRowCategorical`,
`layout.panelOverlap`), and
panel-level (`stat.requiresComparison` covers the sparkline-on-
aggregate rule per #53; `stat.handlesUnknown` covers the explicit
null/NaN handling rule per #56; `gauge.requiresBounds` covers the
fixed-range rule per #93; `targets.promqlValid` runs PromQL
syntactic validation against the same Lezer grammar Grafana's PromQL
editor uses, with Grafana templating variables pre-substituted so
`$__rate_interval` etc. don't trigger false positives;
`targets.promqlSemantic` adds the offline AST semantic check per #97 —
v1 catches the range-vector requirement, `rate(foo)` with no `[5m]`).
The
overview-first **fold composition** rule (issue #54) is now
machine-checked via `layout.firstRowCategorical` — but only on
dashboards explicitly tagged as overviews (see that rule below); the
unscoped row-sequence judgement (row 2 = RED/USE, rows 3..N =
pipeline-ordered decomposition) and multi-timescale strips remain
review-checklist items. Treat those as review items until lint
catches up.

---

## `GrafanaStyleGuide` JSON

The block below is the input the `lintPanel` library function /
`grafana_panel_lint` MCP tool consumes. It's a `GrafanaStyleGuide`
umbrella; cross-type rules (`units`, `descriptions`) live nested under
`panels` so the panel slice (`PanelStyleGuide`) is everything needed
to lint one panel.

```json
{
  "panels": {
    "timeseries": {
      "legend": {
        "placement": "right",
        "displayMode": "table",
        "calcs": ["mean", "lastNotNull", "max"]
      }
    },
    "stat": {
      "requiresComparison": true,
      "handlesUnknown": true
    },
    "gauge": {
      "requiresBounds": true
    },
    "targets": {
      "promqlValid": true,
      "promqlSemantic": true
    },
    "units": {
      "allowList": [
        "short", "percent", "percentunit",
        "reqps", "ops", "wps", "rps",
        "bytes", "decbytes",
        "s", "ms", "ns", "dtdurations"
      ],
      "deny": ["locale", "none"]
    },
    "descriptions": {
      "required": true
    }
  },
  "dashboards": {
    "panels": {
      "duplicateTitles": true,
      "maxRepeat": 10,
      "datasourceDeclared": true,
      "orphanRow": true
    },
    "variables": {
      "hiddenButReferenced": true,
      "emptyDefault": true,
      "unreferenced": true
    },
    "links": {
      "preservesVariables": true
    },
    "layout": {
      "firstRowCategorical": { "overviewTag": "overview" },
      "panelOverlap": true
    }
  }
}
```

The `dashboards` block configures rules that span the whole dashboard
(rather than checking one panel). `duplicateTitles` flags non-row
panels that share a title (rows and `repeat`-using panels are
excluded — both legitimately share titles). Accepts `true` / `false`
for the simple case, or `{ "except": ["Title 1", "Title 2"] }` to
exempt intentional duplicates (e.g. a KPI stat panel paired with its
timeseries trend that share a title by convention):

```json
"duplicateTitles": { "except": ["Requests", "Errors"] }
```

`hiddenButReferenced`
flags templating variables with `hide: 2` (both label and value
hidden in the UI) interpolated in a panel or row title — viewer sees
the value without context. `emptyDefault` flags `query` /
`datasource` / `interval` variables with no `current.value`
(`custom`, `constant`, `textbox`, `adhoc` are exempt because empty
is legitimate for those). `unreferenced` flags a templating variable
that is never interpolated anywhere — dead config. Detection searches
the whole dashboard for `$v` / `${v}` / `[[v]]` plus bare-name
`repeat` fields, so a variable used indirectly (in another variable's
query, an annotation, a link, a transformation, or a repeat) is not
flagged; `adhoc` variables are exempt (they apply filters implicitly,
never by name).

`maxRepeat` caps the cardinality of `repeat by $variable` panels.
The default suggested above (`10`) is a rough budget — a row of 10
panels is dense but readable; 50+ is the Cacti-era per-device-page
anti-pattern (a wall of identical charts that nobody reads). Above
the cap, prefer a Top-N table, a state-timeline matrix, or a
heatmap instead. Accepts `number` (shown above) or `{ "max": N }`.

`preservesVariables` flags internal dashboard-to-dashboard links
(URL path `/d/` or `/dashboard/`) that drop every referenced
templating variable. The viewer lands with empty selectors and has
to re-pick everything they already had. Partial drops are
intentional — a per-pod → per-cluster drill-up legitimately drops
`$pod` — and not flagged. External URLs (runbooks, GitHub, etc.)
are always ignored.

`datasourceDeclared` flags any non-row panel without a usable
`datasource` ref — either the field is missing or it's an empty
`{}` (no `uid` and no `type`). Without it Grafana falls back to the
*instance-wide* default datasource; if no default is set the panel
queries nothing and renders blank. That's the "silent broken
dashboard" failure mode: layout, titles, and even thresholds look
fine on screen, but no data flows. Templating-variable refs
(`{ uid: "$datasource", type: "prometheus" }`) pass — they are the
standard multi-environment pattern, resolved at render time. Row
panels are excluded (rows don't query). Severity is `warn` rather
than `error` because the instance default *might* cover the panel —
but relying on it is fragile (different envs, missing default,
dashboard imported to a Grafana where the default datasource is
different). Set explicitly.

`orphanRow` flags a row panel with no panels under it — a dead
section header that renders as a blank band. A row counts as orphan
when its nested `panels[]` is empty *and* it is the last panel or is
immediately followed by another row (so an expanded row whose
children are flat siblings after it, the modern layout, is correctly
not flagged). Remove the row or move panels into it. Severity `info`.

`layout.firstRowCategorical` flags an **overview** dashboard whose
first row (the fold) is a wall of numbers/graphs — `stat`, `gauge`,
`timeseries`, `barchart`, `bargauge` — with no categorical-health
panel (`state-timeline`, `alertlist`) among them. The operator's
first question is *is anything red?*, not *what's the value?* (see
`## Dashboards` → "Row sequence"). Because there is no structural
"this is an overview dashboard" signal in Grafana JSON — and
drill-down / per-service / per-pod dashboards *legitimately* open
with timeseries — **the rule must be scoped explicitly**. The
recommended convention is to **tag overview dashboards `overview`**
and configure `{ "overviewTag": "overview" }`; the rule then fires
only on dashboards carrying that tag. (`true` fires on every
dashboard — use it only for a style-guide copy that governs a folder
of nothing but overview dashboards.) Detection reads the top band of
positioned top-level panels; a fold that already carries a
state-timeline or alertlist passes, and a text-only header fold never
fires. The fix: lead row 1 with a state-timeline
(`grafana_state_timeline_panel_build`) plus an alertlist, and defer
numeric tiles to row 2.

`layout.panelOverlap` flags two top-level panels whose `gridPos`
rectangles intersect — the panels share grid cells and one renders on
top of the other, hiding its data. Pure geometry (no taste): rectangles
overlap when `a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y <
a.y+a.h` (strict, so panels placed edge-to-edge are fine). Rows and
collapsed-row children are excluded. The build path never produces
overlaps; this guards hand-edited and imported dashboards. Severity
`warn` — it actively hides data. Fix: reposition so the rectangles
don't intersect.

`stat.requiresComparison` flags stat panels with
`options.graphMode === "none"` (or absent — provisioned dashboards
routinely omit the field). The sparkline gives the viewer a
comparison signal alongside the current value; without it, a stat
panel shows just a number, and a number without trend context is the
"aggregate ≠ summary" failure mode this skill's `## Dashboards`
section calls out. Set `graphMode: "area"` or `"line"` on every stat
panel to opt in to the comparison.

`stat.handlesUnknown` flags stat panels with no explicit signal for
what to show when the value is null or NaN. Grafana's default
behaviour is to inherit the *lowest threshold band's* colour for
null — silently green (or red, on a reverse-coloured panel) rather
than the "no data" the operator expects. Fix either way:

- **Value mapping** — add a `fieldConfig.defaults.mappings[]` entry
  with `type: "special"` and `options.match: "null"` (or `"nan"` /
  `"null+nan"`). The dominant pattern in the wild (e.g. node-exporter
  dashboards) sets `result.text: "N/A"` and omits the `color` field
  entirely. That's deliberate: text-only mappings communicate "no
  data" without overriding the panel's threshold palette.
- **`noValue`** — set `fieldConfig.defaults.noValue` to a non-empty
  string (e.g. `"N/A"`, `"–"`). Simpler when you don't need per-shape
  distinction between null, NaN, and empty.

The rule checks *presence* of either escape hatch, not the colour of
the mapping result. Earlier triage (#56) considered a stricter
`unknownIsGrey` shape with a colour-tolerance policy; fixture evidence
showed real null-mapping JSON omits colours entirely, so the colour
check would have overfit. If a real bug surfaces (operator tripped by
an explicitly mis-coloured null), a sharpened sub-rule lands then.

`targets.promqlValid` flags any panel target whose `expr` field fails
to parse against the PromQL grammar — same Lezer grammar Grafana's
own PromQL editor, Mimir's editor, and the Prometheus UI all build on
(`@prometheus-io/lezer-promql`). Severity `warn`: the dashboard
imports fine and the rest of the panel renders; the broken target
just produces "no data" at query time. Catches typos like unclosed
brackets (`rate(foo[5m`), malformed durations (`[5xyz]`), missing
operands, broken operator chains. Grafana templating variables
(`$__rate_interval`, `${env}`, `[[env]]`) are pre-substituted with
grammar-safe placeholders before parsing, so a real-world stored
expression like `rate(http_requests_total[$__rate_interval])` doesn't
trigger a false positive. Only `target.expr` is checked; non-
Prometheus target fields (`query` for Loki, `rawQuery` for SQL) have
different syntax and are intentionally skipped. For the standalone
tool form (validate one expression at a time, mid-composition), call
`grafana_promql_validate` instead of running the dashboard-level rule.

`targets.promqlSemantic` is the companion **semantic** check —
expressions that parse cleanly but fail at query time. v1 catches the
**range-vector requirement**: a range-vector function (`rate`, `irate`,
`increase`, `delta`, `deriv`, the `*_over_time` family, …) applied to a
bare instant vector — `rate(http_requests_total)` with no `[5m]`, the
single most common PromQL mistake (Prometheus errors with "expected
range vector, got instant vector"). It analyses the same Lezer AST
offline — no metric metadata, no network. It fires only on the exact
bare-`VectorSelector`-argument shape (near-zero false positives), runs
only on syntactically-valid expressions, and skips arguments carrying a
Grafana variable (whose expansion it can't see). Type-aware checks
(`rate()` on a *gauge*) would need live metric metadata and stay out of
scope. Severity `warn`. Future additive extensions: function arity,
the `quantile_over_time` second-argument form.

`legend.calcs` accepts two shapes. A bare `string[]` (shown above) is
**set-equal** — order of the calcs in the array is ignored; the panel
matches as long as it carries the same multiset. This is the common
case: "every legend should carry the same aggregations regardless of
which column ended up first." To opt into order-sensitivity, use the
explicit form `{ "expected": [...], "match": "exact" }`; the `"set"`
match mode is equivalent to the bare-array default. Subset / superset
modes are deliberately not supported — the cross-set "which extras
are OK?" question is taste-laden and belongs in this skill, not in
code. If different dashboard families need different calc sets, fork
the skill copy and carry both.

Rule identifiers in `lintPanel` / `grafana_panel_lint` use JSONPath-style
dotted paths into this umbrella shape — e.g.
`panels.timeseries.legend.placement` references the `placement` field
nested under `panels.timeseries.legend`, and `panels.units.allowList`
references the cross-type unit allow list nested under `panels.units`.
Not literal keys with dots in them.

The MCP tool accepts either the full umbrella above or the
`PanelStyleGuide` slice (`{ timeseries?, units?, descriptions? }`)
directly; it unwraps the umbrella by extracting `.panels` when that
key is present at the top level.

## References

### Corpus (where the patterns came from)

- [kubernetes-mixin](https://github.com/kubernetes-monitoring/kubernetes-mixin) — Apache-2.0, the de facto Grafana style for production Kubernetes observability. Source of the headlines-stat-row + per-component-rows-with-paired-tables shape.
- [monitoring-mixins](https://monitoring.mixins.dev/) — directory of mixins from many projects; collectively a corpus of established Grafana panel conventions, and the canonical mechanism for "dashboard shape as code".
- Grafana Labs' reference mixins in `grafana/mimir/operations/mimir-mixin`, `grafana/loki/production/loki-mixin`, `grafana/tempo/operations/tempo-mixin` — production patterns from the team that ships Grafana. The Mimir overview dashboard is the strongest single example of the state-timeline + alert-list "fold."
- Grafana display-unit codes — see Grafana's panel-options documentation for the full list of valid `unit` strings.

### Design philosophy

- Ben Shneiderman, *"The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations"* (1996) — original *"overview first, zoom and filter, details on demand"* mantra. ~8,000 citations; the canonical academic reference for the inverted-pyramid pattern.
- Stephen Few, *Information Dashboard Design* (2006 / 2013 2nd ed.) — codifies *at-a-glance monitoring*; the upper-left-wins spatial rule.
- Tom Wilkie, [*The RED Method: How to Instrument Your Services*](https://grafana.com/blog/the-red-method-how-to-instrument-your-services/) — opinionated on the *layout* of a RED dashboard, not just the metrics.
- Brendan Gregg, [*The USE Method*](https://www.brendangregg.com/usemethod.html) and [*Thinking Methodically About Performance*](https://cacm.acm.org/magazines/2013/2/160167-thinking-methodically-about-performance/abstract) (ACM 2013) — error/saturation/utilization as a *matrix*, errors-first ordering.
- Google SRE Workbook, [*Monitoring*](https://sre.google/workbook/monitoring/) — SLO-first dashboard entry point.
- [DataDog effective-dashboards guidelines](https://github.com/DataDog/effective-dashboards/blob/main/guidelines.md) — minimum widget widths, group-everything-even-singletons rules.

### Anti-patterns and critique

- Charity Majors, [*Notes on the Perfidy of Dashboards*](https://charity.wtf/2021/08/09/notes-on-the-perfidy-of-dashboards/) (2021) — the orientation-vs-debugging distinction.
- William Louth, [*From Data to Dashboard*](https://opensignals.io/blog/from-data-to-dashboard-an-observability-anti-pattern) (OpenSignals, 2024) — the *Data-to-Dashboard* anti-pattern.
- Boris Cherkasky, [*Can We Stop With Those Horrible 'System Overview' Dashboards Already?*](https://medium.com/better-programming/can-we-stop-with-those-horrible-system-overview-dashboards-already-5ea10a28fecf) — when aggregate-on-top fails on-call.
- Edward Tufte's critique of dashboards (paraphrased throughout his work) — *"the dashboard is the 'service-engine-soon' light of data visualization"*; the call for high data density and small-multiples over privileged summary tiles.

### NMS / pre-cloud tradition

- Tobi Oetiker, [MRTG](https://oss.oetiker.ch/mrtg/) (1995) — the multi-timescale strip (daily / weekly / monthly / yearly on one page).
- [SmokePing](https://oss.oetiker.ch/smokeping/) — median + variance + loss in a single visualisation.
- [Cacti](https://www.cacti.net/) graph trees — the fleet → device → port navigation hierarchy. Source of both useful patterns (fleet-list before device-detail) and the "per-device page with 200 graphs" anti-pattern to *avoid* with `repeat by $variable`.
- [Nagios](https://support.nagios.com/kb/article/nagios-core-4-tactical-overview-676.html) tactical-overview state semantics — the five-state model (OK / WARNING / CRITICAL / UNKNOWN / PENDING) plus the orthogonal *acknowledged* dimension.
