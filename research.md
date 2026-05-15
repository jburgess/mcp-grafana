# Research

A living log of the investigation underpinning this project. Entries are
append-only: when something is superseded, mark it but don't delete it —
future contributors need to see how decisions evolved. Each entry should
record what was checked, when, the source, and the conclusion.

Decisions ratified here graduate into ADRs under `docs/adr/`.

---

## Entry 001 — Strongly-typed Grafana resources and their licenses

**Date:** 2026-05-15
**Researcher:** team (initial pass)
**Question:** What existing libraries provide strongly-typed Grafana resource
definitions (dashboards, panels, alerts, contact points, datasources, etc.)
that we could either build on, depend on, or learn from? Are they permissively
licensed (Section 1.7 of `AGENTS.md`)?

### Why this matters

Grafana's dashboard JSON is large, version-drifting, and weakly documented in
prose. Hand-rolling TypeScript types from the JSON would be a maintenance
treadmill. Before we write the first line of our own builder, we need to know
whether there's an authoritative typed substrate we can stand on, and whether
its license is compatible with us shipping permissive code.

### The licensing landscape, top-level

Grafana Labs **relicensed Grafana core, Loki, and Tempo from Apache-2.0 to
AGPLv3 in April 2021**. Plugins, agents, and certain libraries (notably the
schema packages and SDKs) were explicitly kept under Apache-2.0.

This is the load-bearing distinction for us:

| Artifact                                  | License     | Usable by us?            |
| ----------------------------------------- | ----------- | ------------------------ |
| `grafana/grafana` (core source code)      | AGPLv3      | **No** — do not vendor   |
| `@grafana/schema` (npm)                   | Apache-2.0  | Yes                      |
| `@grafana/grafana-foundation-sdk` (npm)   | Apache-2.0  | Yes                      |
| `grafana/grafonnet` (Jsonnet)             | Apache-2.0  | Yes (reference only)     |
| `weaveworks/grafanalib` (Python)          | Apache-2.0  | Yes (reference only)     |
| `jkcfg/grafana` (TypeScript)              | Apache-2.0  | Yes, but stale           |
| `grafana/grafonnet-lib` (predecessor)     | Apache-2.0  | Superseded               |

We can interact with Grafana core only via its HTTP API and its
Apache-licensed sibling packages — we cannot copy or vendor AGPL code into
this repo.

### Candidate libraries (detailed)

#### A. `@grafana/grafana-foundation-sdk` — **primary candidate**

- **Repo:** github.com/grafana/grafana-foundation-sdk
- **npm package:** `@grafana/grafana-foundation-sdk`
- **License:** Apache-2.0 (verified against the LICENSE file in `main`)
- **Languages:** Go, TypeScript, Python, PHP, Java — generated from a shared
  CUE-based schema source of truth.
- **Grafana versions supported:** ≥ 10.0; "best suited" for ≥ 12.
- **Asset coverage:** dashboards, panels, queries, variables, transformations,
  thresholds, field overrides, **alerts**, and more (the README lists
  "Dashboards, alerts, …" — exact coverage to be enumerated in a follow-up
  entry by the Grafana Expert).
- **API style:** composable builder pattern (`DashboardBuilder`, `RowBuilder`,
  `PanelBuilder`, `DataqueryBuilder`, …) producing the canonical JSON.
- **Maintenance:** active, official, code-generated from Grafana's own CUE
  schemas, so it tracks Grafana releases.

**Why this is the front-runner:** it's the only library that is (a) official,
(b) TypeScript-native, (c) generated from the same schemas Grafana itself
consumes, and (d) Apache-2.0. Building on top of it lets us focus on the
*opinionated* layer — composition patterns, domain-specific helpers,
LLM-friendly surfaces — instead of re-implementing the type substrate.

**Open questions for the next entry:**
- Does it cover everything in our target asset list (alert rules, contact
  points, notification policies, mute timings, library elements, folders,
  datasources)?
- How does it handle Grafana version skew? Per-version packages?
- Does it expose the underlying types separately from the builders?
- Bundle size / tree-shake quality?

#### B. `@grafana/schema` — raw types, no builders

- **Repo:** part of `grafana/grafana` (under `packages/grafana-schema`)
- **License:** Apache-2.0 (confirmed in the package's `package.json` —
  this subpackage is explicitly excluded from Grafana core's AGPL).
- **What it is:** CUE-generated TypeScript type definitions for dashboards
  and panels. No builders, no validation, just types.
- **Use case for us:** could be useful as a *secondary* check — validating
  that what the Foundation SDK produces still type-matches the raw schema
  shape. Possibly redundant if the Foundation SDK already exposes its
  underlying types.

#### C. `grafonnet` (Jsonnet)

- **Repo:** github.com/grafana/grafonnet
- **License:** Apache-2.0
- **Language:** Jsonnet (not TypeScript) — not a runtime option for us.
- **Why it's still relevant:** grafonnet is *generated from the same
  OpenAPI documents as the Foundation SDK*. So patterns, naming, and
  coverage in grafonnet are a useful cross-check on what the Foundation SDK
  should support. If grafonnet covers a resource and the Foundation SDK
  doesn't, that's a smell worth investigating.

#### D. `grafanalib` (Python, Weaveworks)

- **Repo:** github.com/weaveworks/grafanalib
- **License:** Apache-2.0
- **Language:** Python only.
- **Status:** the project itself describes itself as "in very early stages"
  despite years of existence; it is hand-maintained rather than generated,
  which means it lags Grafana's schema.
- **Use case for us:** reference for naming and ergonomics in a builder-style
  API. Not a runtime dependency.

#### E. `jkcfg/grafana` (TypeScript, community)

- **Repo:** github.com/jkcfg/grafana
- **License:** Apache-2.0
- **Language:** TypeScript.
- **Status:** small (6 stars, 31 commits at time of writing), maintenance
  status unclear, predates the Foundation SDK.
- **Use case for us:** historical reference only — superseded in every
  practical dimension by the Foundation SDK.

#### F. `grafonnet-lib` (predecessor)

- **Repo:** github.com/grafana/grafonnet-lib
- **License:** Apache-2.0
- **Status:** explicitly superseded by `grafonnet`. The project's own README
  cites the maintenance burden of hand-writing the library as the reason for
  moving to the generated `grafonnet`.
- **Lesson learned:** *hand-rolled* typed wrappers around Grafana don't
  survive contact with Grafana's release cadence. This is the strongest
  argument against us reinventing the substrate.

#### G. CUE schemas in `grafana/grafana` (kindsys / kinds)

- **Location:** `kinds/` and `apps/*/kinds/` directories of grafana/grafana
- **License:** **AGPLv3** (it's inside the core repo).
- **What it is:** the *canonical* schema source of truth. The Foundation
  SDK, `@grafana/schema`, and grafonnet are all generated from these.
- **Use case for us:** read-only reference for understanding shape and
  semantics. We **cannot copy or vendor** these `.cue` files because of the
  AGPLv3 license on the surrounding repo — but reading them to inform our
  *own* code is fine (facts/specs are not copyrightable, only the expression
  is). If we ever need to consume CUE directly, we should pull from the
  Apache-2.0 generated artifacts instead.

### Initial conclusions (proposed, not yet ratified)

1. **Build on `@grafana/grafana-foundation-sdk` as the typed substrate.**
   It's the only option that is official, TypeScript-native, generated, and
   permissively licensed. Hand-rolling our own types would repeat the
   grafonnet-lib mistake.
2. **Treat `grafonnet` as a coverage oracle.** If grafonnet covers a resource
   the Foundation SDK doesn't, we file an issue upstream rather than working
   around it.
3. **Do not vendor any code from `grafana/grafana`.** Interact with Grafana
   only through the HTTP API and the Apache-2.0 sibling packages. CUE
   schemas in core are AGPL — read them, don't copy them.
4. **Our value-add lives above the Foundation SDK**, not in re-implementing
   it: opinionated composition, LLM-friendly surfaces (MCP tools, richer
   error messages, copy-pasteable examples), domain helpers (SLO panels,
   common alert patterns), and possibly a higher-level "intent → asset"
   layer.

These conclusions are inputs to a forthcoming ADR
(`docs/adr/0001-typed-substrate.md`) — not yet decided.

### Naysayer's open challenges

- **Do we actually need a library on top of Foundation SDK at all?** If the
  SDK is good enough, the right answer might be docs + examples + a small
  MCP server, not a new package. The first failing test will tell us.
- **What's the cost of being one layer behind upstream?** If Foundation SDK
  releases break us, who absorbs that work?
- **Does "LLM-friendly" pay rent yet?** Or is it speculative scope until we
  have a real model trying to use the SDK and failing in specific ways?

### Verified sources

- Grafana Foundation SDK repo & LICENSE
  ([github.com/grafana/grafana-foundation-sdk](https://github.com/grafana/grafana-foundation-sdk),
  Apache-2.0 confirmed from `main/LICENSE`)
- Foundation SDK docs
  ([grafana.com/docs/grafana/latest/observability-as-code/foundation-sdk/](https://grafana.com/docs/grafana/latest/observability-as-code/foundation-sdk/))
- `@grafana/grafana-foundation-sdk` on npm
  ([npmjs.com/package/@grafana/grafana-foundation-sdk](https://www.npmjs.com/package/@grafana/grafana-foundation-sdk))
- `@grafana/schema` package.json (Apache-2.0 confirmed)
  ([github.com/grafana/grafana/blob/main/packages/grafana-schema/package.json](https://github.com/grafana/grafana/blob/main/packages/grafana-schema/package.json))
- `grafana/grafana` LICENSE (AGPLv3 confirmed)
  ([github.com/grafana/grafana/blob/main/LICENSE](https://github.com/grafana/grafana/blob/main/LICENSE))
- Grafana relicensing announcement, April 2021
  ([grafana.com/blog/grafana-loki-tempo-relicensing-to-agplv3/](https://grafana.com/blog/grafana-loki-tempo-relicensing-to-agplv3/))
- `grafana/grafonnet` (Apache-2.0)
  ([github.com/grafana/grafonnet](https://github.com/grafana/grafonnet))
- `weaveworks/grafanalib` LICENSE (Apache-2.0 confirmed)
  ([github.com/weaveworks/grafanalib](https://github.com/weaveworks/grafanalib))
- `jkcfg/grafana` (Apache-2.0)
  ([github.com/jkcfg/grafana](https://github.com/jkcfg/grafana))

### Next research entries (planned)

- **Entry 002 — Foundation SDK coverage matrix.** Exact list of asset types
  the SDK exposes, mapped against what our project needs. Owner: Grafana
  Expert.
- **Entry 003 — Foundation SDK API ergonomics.** Hands-on: build a small
  dashboard, an alert rule, a contact point. Note pain points, naming
  inconsistencies, and what an LLM would stumble on. Owner: LLM Expert +
  TypeScript Expert.
- **Entry 004 — Runtime validation choice.** zod vs valibot vs ajv-against-
  JSON-schema vs custom. Criteria: tree-shaking, error message quality,
  license, install size. Owner: TypeScript Expert.
- **Entry 005 — License of every transitive dependency** we'd inherit from
  pulling in `@grafana/grafana-foundation-sdk`. Owner: Naysayer.
