# Test fixtures

Real-world Grafana asset JSON used by tests and ad-hoc exploration. Each
fixture is vendored as a static snapshot of an upstream file so tests are
deterministic and CI runs offline.

## License compliance

Per `AGENTS.md` §1.7 every vendored artifact must use a permissive license
compatible with the project's MIT. Each fixture below records its source,
upstream license, and the date it was snapshotted.

## Fixtures

### `node-exporter-full.json`

A large, real-world Grafana dashboard — the canonical "complex dashboard"
that almost every Prometheus + Node Exporter user has installed at least
once. Useful for exercising the inspect / validate / mutation tools
against shapes a hand-written test fixture won't naturally produce:

- 31 top-level panels, 16 of which are row panels containing 110+ nested
  panels (141 panels total including nested).
- 4 templating variables (one of which is a datasource picker, with
  Prometheus the canonical target).
- Mixed visualizations: `timeseries`, `stat`, `gauge`, `bargauge`, `row`.
- Variable-driven titles, units across the Grafana unit-code spectrum
  (`percent`, `bytes`, `percentunit`, `bps`, `s`, …).
- Realistic gridPos layout with rows of multiple sizes.

| | |
|---|---|
| Source | <https://github.com/rfmoz/grafana-dashboards/blob/master/prometheus/node-exporter-full.json> |
| Upstream license | Apache 2.0 — see `NODE_EXPORTER_FULL.LICENSE` (verbatim copy of the upstream `LICENSE` file). |
| Snapshot date | 2026-05-16 (fetched from `master`) |
| Upstream maintainer | [@rfmoz](https://github.com/rfmoz) (the dashboard author, also published as Grafana.com dashboard ID 1860). |

**Re-fetching the latest version**

```bash
curl -o test/fixtures/node-exporter-full.json \
  https://raw.githubusercontent.com/rfmoz/grafana-dashboards/master/prometheus/node-exporter-full.json
```

The upstream is actively maintained, so the vendored copy will drift from
`master` over time. Re-fetch (and re-run the affected snapshot tests) on
purpose, not by accident.
