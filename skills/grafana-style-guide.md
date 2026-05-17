---
name: grafana-style-guide
description: Use before building or reviewing a Grafana panel. Starter style guide covering panel units, legends, thresholds, titles, and descriptions (timeseries-focused; stat / table / heatmap share unit and description rules). Dashboards, alert rules, and recording-rule conventions forthcoming. Modeled on the kubernetes-mixin / monitoring-mixins corpus and Grafana Labs' Mimir / Loki / Tempo reference dashboards. Copy into your skills / rules directory and edit for your team; mcp-grafana ships it as a starter, not a managed default.
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

## Scope

This v0.1 of the guide covers **Grafana panels** — units, legends,
thresholds, titles, descriptions — with a focus on timeseries panels
(stat / table / heatmap follow the same unit and description rules;
type-specific guidance is forthcoming).

Areas not yet covered, planned for subsequent revisions:

- **Dashboards** — variable naming (`$datasource`, `$namespace`
  chains), default time-range and refresh, row / section conventions.
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

This v0 of the guide focuses on timeseries panels. Stat / table /
heatmap / gauge conventions will follow in subsequent revisions; until
then, the unit and description rules apply uniformly across panel types.

- **Timeseries** — the default. Anything that varies over time.
- **Stat** — single current value. Don't use for trends; the sparkline
  inside a stat panel is decorative, not analytical.
- **Table** — multi-column tabular data. Almost always wants a transformation
  pipeline; raw `instant` queries rarely render well as tables.
- **Gauge** — current value with a fixed range. Useful for percent /
  percentunit metrics; useless for unbounded ones.

---

## `GrafanaStyleGuide` JSON

The block below is the input the `lintPanel` library function /
`grafana_panel_lint` MCP tool consumes. It's a `GrafanaStyleGuide`
umbrella; cross-type rules (`units`, `descriptions`) live nested under
`panels` so the panel slice (`PanelStyleGuide`) is everything needed
to lint one panel.

```json
{
  "$schema": "https://mcp-grafana.dev/style-guide.v1.json",
  "panels": {
    "timeseries": {
      "legend": {
        "placement": "right",
        "displayMode": "table",
        "calcs": ["mean", "lastNotNull", "max"]
      }
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
  }
}
```

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

- [kubernetes-mixin](https://github.com/kubernetes-monitoring/kubernetes-mixin) — Apache-2.0, the de facto Grafana style for production Kubernetes observability.
- [monitoring-mixins](https://monitoring.mixins.dev/) — directory of mixins from many projects; collectively a corpus of established Grafana panel conventions.
- Grafana Labs' reference dashboards in `grafana/mimir`, `grafana/loki`, `grafana/tempo` — production patterns from the team that ships Grafana.
- Grafana display-unit codes — see Grafana's panel-options documentation for the full list of valid `unit` strings.
