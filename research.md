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

---

## Entry 002 — Modern TypeScript testing framework for TDD

**Date:** 2026-05-15
**Researcher:** team (initial pass)
**Question:** What is the best test runner for a TDD-first TypeScript library
in 2026? "Best" here is weighted heavily toward **inner-loop speed**
(red-green-refactor cycle), **TypeScript ergonomics**, and **permissive
licensing** (AGENTS.md §1.7).

### Why this matters

In TDD, the test runner is the inner loop. Cold-start time, watch-mode
re-run time, and ergonomics of "write a failing test, see it fail" *are*
the developer experience. A slow runner doesn't just waste seconds — it
breaks the rhythm that makes TDD work.

### Evaluation criteria

1. **Watch-mode latency** — sub-second re-runs on a small change.
2. **Cold-start time** — running a single test should not take 5+ seconds.
3. **TypeScript support** — zero-config preferred; no separate transpile
   step that drifts from `tsc`.
4. **ESM-native** — Grafana Foundation SDK ships ESM; we will too.
5. **Snapshot testing** — needed for stable JSON output assertions.
6. **Mocking** — needed for HTTP interactions with Grafana.
7. **License** — must be permissive (MIT / Apache-2.0 / BSD).
8. **Maintenance and trajectory** — actively developed, not in stewardship
   mode.
9. **Property-based testing compatibility** — asset builders are excellent
   candidates for property tests (any valid input ⇒ valid output).

### Candidates

| Runner       | License | TS support               | ESM       | Watch latency           | Notes                                                          |
| ------------ | ------- | ------------------------ | --------- | ----------------------- | -------------------------------------------------------------- |
| **Vitest**   | MIT     | Zero-config (esbuild)    | Native    | ~0.3s (Vite HMR graph)  | Front-runner.                                                  |
| Jest         | MIT     | Needs `ts-jest` or babel | Still experimental in v30 | ~8s typical | Mature ecosystem; slow; ESM still rough.                       |
| `node:test`  | (Node)  | Needs `tsx`/borp wrapper | Native    | n/a (no smart watch)    | Stable since Node 22 LTS. Zero deps. Less ergonomic.           |
| Bun test     | MIT     | Native                   | Native    | Very fast               | Requires the Bun runtime — adds a non-trivial dep.             |
| Mocha + tsx  | MIT     | Via loader               | OK        | Manual                  | Venerable but DIY; no integrated mocking or snapshots.         |
| AVA          | MIT     | Via babel/tsx            | OK        | Decent                  | Niche; minimalist; small community vs the leaders.             |

License verification:
- **Vitest** — MIT, copyright VoidZero Inc. + Vitest contributors (verified
  against `LICENSE` on `main`).
- **Jest** — MIT (verified).
- **node:test** — ships with Node.js, no extra license to worry about.
- **fast-check** (property-based testing) — MIT (permissive, listed by
  Snyk/repo as a short-permissive license).

All viable options are MIT, so licensing does not distinguish them — every
candidate clears the AGENTS.md §1.7 bar. The decision is on technical merits.

### Detailed look at the top three

#### Vitest — **front-runner**

- **License:** MIT.
- **TypeScript:** zero-config; esbuild strips types at module-load time.
  Type-checking is *not* performed during tests (use `tsc --noEmit` in CI
  separately, or `--typecheck` mode for inline type assertions).
- **Watch mode:** uses Vite's module graph to determine which tests are
  affected by a file change; sub-second re-runs are routine.
- **Cold start:** reportedly ~5–6× faster than Jest on the same suite.
- **Snapshot testing:** built-in, Jest-compatible API.
- **Mocking:** built-in `vi.mock` / `vi.fn`, Jest-compatible.
- **Coverage:** v8 native, plus `@vitest/coverage-istanbul`.
- **Browser mode:** stable in v4 (irrelevant for us — we're producing JSON,
  not rendering — but useful future option).
- **API compatibility:** intentionally close to Jest's, so docs and AI
  assistants that know Jest can drive it.
- **Risk:** ties us to Vite as a transitive dep. Not heavy and tree-shakes
  away from runtime; only a build/dev-time concern. The Naysayer notes
  this is the largest dependency we'd pull in for tests.

#### Jest — incumbent, not our pick

- **License:** MIT.
- **Strengths:** enormous ecosystem, well-known matchers, every AI assistant
  has seen 100k Jest tests.
- **Weaknesses for us:**
  - Needs `ts-jest` (slow because it actually type-checks per test) or
    `@swc/jest` (fast but bypasses tsc, drifts from real type errors).
  - ESM support has been "experimental" for years and remains so in v30.
  - Watch-mode and cold-start times are an order of magnitude slower than
    Vitest in published benchmarks.
- **When we'd reconsider:** if we ended up needing a specific Jest-only
  plugin (none on the horizon).

#### `node:test` — viable, but not yet our pick

- **License:** ships with Node.js (no separate license to worry about).
- **Status:** stable since Node 22 LTS (graduated from experimental in
  2024). Suitable for production.
- **Strengths:** zero dependencies, fast startup, built-in coverage. Aligns
  with the "small surface area" philosophy of this project.
- **Weaknesses for us today:**
  - TypeScript requires a wrapper (`tsx`, `borp`, or Node's
    `--experimental-strip-types`). Each adds a friction point.
  - No smart watch mode equivalent to Vitest's module-graph re-runs.
  - Snapshot testing and mocking are usable but less ergonomic than
    Vitest's.
  - Smaller surface for AI assistants to draw on.
- **When we'd reconsider:** if Vitest's transitive dep footprint ever
  becomes a maintenance pain, or once `--experimental-strip-types` is
  unflagged and node:test ships better watch ergonomics. Worth re-evaluating
  yearly.

### Property-based testing — `fast-check`

- **License:** MIT (permissive).
- **What it is:** a QuickCheck-style property-based testing library that
  plugs into any of the runners above (Vitest, Jest, Mocha, node:test).
- **Why it matters for this project:** asset builders are full of
  invariants that are tedious to enumerate as example tests but trivial to
  state as properties — e.g., *"for any valid panel input, the rendered
  JSON validates against the panel schema"*, or *"reordering rows preserves
  the set of panel IDs."* `fast-check` will find edge cases we'd never
  write by hand.
- **Recommendation:** adopt alongside Vitest from day one for builder/
  validator code. Not every test needs to be property-based, but the option
  needs to be there before the first builder ships.

### Initial conclusions (proposed, not yet ratified)

1. **Vitest is our test runner.** Fast watch loop, zero-config TS, ESM-
   native, MIT-licensed, and broadly known by both humans and AI
   assistants. It is the strongest match for a TDD-first project in 2026.
2. **Pair Vitest with `fast-check` for property-based tests** of pure
   builder and validator code.
3. **Type-checking is separate.** Vitest does not type-check during test
   runs by default. We run `tsc --noEmit` as its own step in CI and in the
   pre-commit / pre-push hook. (`vitest --typecheck` is available for
   inline type-level assertions if we want them.)
4. **Keep an eye on `node:test`.** Annual re-evaluation. If Vitest's
   dependency footprint becomes a liability, or if `node:test` ships a
   real smart-watch mode, the calculus changes.

These conclusions are inputs to a forthcoming ADR
(`docs/adr/0002-test-runner.md`) — not yet decided.

### Naysayer's open challenges

- **Vitest pulls in Vite as a transitive dep.** Is that overhead justified
  for a *library* project (no bundler, no dev server)? Counter-argument:
  it's dev-only, tree-shakes away, and the speed-up is the whole point.
- **Do we need property-based testing on day one, or is that scope creep?**
  Defer adoption until we have a builder where it'd actually catch a class
  of bug we couldn't have written by hand. Keep the recommendation, don't
  install the dep until the first failing property test exists.
- **Have we underweighted `node:test`?** It's the lowest-dependency option.
  If the cost is one extra friction point at setup (`tsx`), the
  zero-runtime-overhead win might be worth it. Concrete test: time
  red-green-refactor on a 50-test suite with each runner before locking in.

### Verified sources

- Vitest LICENSE (MIT confirmed)
  ([github.com/vitest-dev/vitest/blob/main/LICENSE](https://github.com/vitest-dev/vitest/blob/main/LICENSE))
- Jest LICENSE (MIT confirmed)
  ([github.com/jestjs/jest/blob/main/LICENSE](https://github.com/jestjs/jest/blob/main/LICENSE))
- Node.js test runner docs (stable in v22 LTS)
  ([nodejs.org/api/test.html](https://nodejs.org/api/test.html))
- Benchmark coverage (Vitest 5–28× faster than Jest across cold-start and
  watch on representative suites; see e.g.
  [pkgpulse.com/blog/vitest-3-vs-jest-30-2026](https://www.pkgpulse.com/blog/vitest-3-vs-jest-30-2026)
  and
  [sitepoint.com/vitest-vs-jest-2026-migration-benchmark](https://www.sitepoint.com/vitest-vs-jest-2026-migration-benchmark/) —
  treat third-party benchmarks as directional, not authoritative)
- `node:test` + TypeScript tooling (borp)
  ([github.com/mcollina/borp](https://github.com/mcollina/borp))
- `fast-check`
  ([github.com/dubzzz/fast-check](https://github.com/dubzzz/fast-check),
  [fast-check.dev](https://fast-check.dev/))

### Next research entries (planned)

- **Entry 003 — MCP framework selection.** Done below.
- **Entry 004 — Foundation SDK coverage matrix.** Owner: Grafana Expert.
- **Entry 005 — Foundation SDK API ergonomics.** Owner: LLM Expert +
  TypeScript Expert.
- **Entry 006 — Runtime validation choice.** Owner: TypeScript Expert.
- **Entry 007 — Transitive dependency license audit** for Vitest +
  `@grafana/grafana-foundation-sdk` + MCP SDK together. Owner: Naysayer.

---

## Entry 003 — MCP framework for the TypeScript surface

**Date:** 2026-05-15
**Researcher:** team (initial pass)
**Question:** What is the right MCP framework / SDK for exposing our
Grafana asset builders to LLM clients? "Right" weighs (a) **fit with the
library-first architecture** — MCP is one façade among several (CLI,
programmatic use, possibly REST) — (b) **permissive licensing** (§1.7),
(c) **transport coverage** (stdio is mandatory; streamable HTTP is
desirable), and (d) **how little it forces us to bend the project
structure around it**.

### Why this matters now

The MCP Expert role exists precisely because *how* the library is exposed
to a model shapes the library's public API. If we pick a framework that
wants tools to live in `/tools/*.ts` files with a particular class shape,
that pressure leaks back into how the rest of the library is structured.
We want MCP to be a *thin adapter* over the library, not the architectural
center.

### Architectural premise (load-bearing)

> The library is the source of truth. The MCP server is one consumer of
> the library, alongside the CLI and direct programmatic use. Every MCP
> tool should be a 5-line wrapper that:
> 1. Validates input with the same schema the library would use anyway.
> 2. Calls a pure library function.
> 3. Returns the result (or a structured error) in MCP shape.

This premise immediately downgrades frameworks that want to *own* the
project structure (file-system routing, decorator-driven discovery, bundler
integration). It promotes the lowest-overhead option that exposes the
protocol cleanly.

### Evaluation criteria

1. **License** — permissive (MIT / Apache-2.0 / BSD), per §1.7.
2. **Minimum opinions on project layout** — no required directory
   conventions, no required build step, no required runtime beyond Node.
3. **Transport coverage** — stdio (essential), Streamable HTTP (desired),
   SSE compat (nice-to-have for legacy clients).
4. **Schema integration** — Standard Schema compatible (so we share schemas
   between library validation and MCP tool inputs once Entry 006 lands).
5. **Protocol freshness** — tracks spec changes promptly.
6. **Maintenance and community** — actively developed; not a hobby project
   that will stall.
7. **Discoverability for AI assistants** — when an LLM writes code against
   this framework, will the examples it has seen still work next year?

### Candidates

| Framework                       | License            | Style                              | Owns layout? | Build step | License OK? |
| ------------------------------- | ------------------ | ---------------------------------- | ------------ | ---------- | ----------- |
| **`@modelcontextprotocol/sdk`** | MIT + Apache-2.0   | Imperative `McpServer.tool(...)`   | **No**       | **No**     | Yes         |
| FastMCP (`punkpeye/fastmcp`)    | MIT                | Thin wrapper over SDK, FastAPI-ish | Light        | No         | Yes         |
| mcp-framework (`QuantGeekDev`)  | MIT                | Class-per-tool + dir discovery     | **Yes**      | **Yes**    | Yes         |
| xmcp (`basementstudio/xmcp`)    | MIT                | Next-style file-system routing, HMR| **Yes**      | **Yes** (bundler) | Yes  |

License verification:
- **`@modelcontextprotocol/sdk`** — dual MIT (legacy contributions) and
  Apache-2.0 (new contributions), held by "Model Context Protocol a Series
  of LF Projects, LLC." Documentation under CC-BY-4.0.
- **FastMCP** — MIT, copyright punkpeye.
- **mcp-framework** — MIT.
- **xmcp** — MIT (monorepo `package.json` declares it; no top-level
  `LICENSE` file was reachable but npm metadata confirms).

All candidates clear §1.7. Decision is again on technical fit.

### Popularity and maintenance (snapshot 2026-05-15)

Ranked by stars; maintenance signals captured the same day.

| Rank | Framework                       | Stars  | Releases | Latest release      | Maintenance signal                                    |
| ---- | ------------------------------- | ------ | -------- | ------------------- | ------------------------------------------------------ |
| 1    | **`@modelcontextprotocol/sdk`** | 12.4k  | 94       | v1.29.0 — Mar 2026  | Spec reference; v2 in pre-alpha, stable v2 expected Q1 2026; v1.x guaranteed 6+ months of fixes after v2 ships |
| 2    | FastMCP (`punkpeye/fastmcp`)    | 3.1k   | (n/a)    | (active)            | 288 commits, 38 open issues, 8 open PRs — actively developed, single-maintainer |
| 3    | xmcp (`basementstudio/xmcp`)    | 1.3k   | 47       | v0.6.10 — May 2026  | Released a version *today*; 1,883 commits; pre-1.0 (0.6.x), API churn likely |
| 4    | mcp-framework (`QuantGeekDev`)  | 916    | 15       | v0.2.22 — Apr 2026  | Slower cadence; pre-1.0 (0.2.x); 12 open issues, 2 open PRs |

**Reading the ranking:**

- **Stars alone favor the official SDK by ~4×.** That's the right answer
  for the wrong reason: stars correlate with discoverability and AI-
  assistant familiarity, both of which matter, but they don't measure fit.
- **All four are actively maintained.** None are abandoned; none are in
  stewardship mode. Maintenance is not a tie-breaker here.
- **Three of the four are pre-1.0** (FastMCP, xmcp, mcp-framework). The
  official SDK is v1.29 and explicitly commits to v1.x bug fixes for 6+
  months after v2 ships. For a library project that wants stable
  dependencies, that promise is meaningful.
- **xmcp's release-today cadence cuts both ways.** Healthy attention, but
  also signals an API not yet settled — exactly what we don't want
  underneath a published library.
- **FastMCP's bus factor is the standout risk.** Single-maintainer projects
  with 38 open issues are usually fine right up until they aren't. The
  *contained migration cost* between FastMCP and the official SDK is what
  makes this risk acceptable if we ever adopt FastMCP — but it's another
  reason not to lead with FastMCP today.

The ranking reinforces, rather than changes, the technical-fit conclusion:
the official SDK wins on stars, wins on protocol freshness, wins on stability
commitments, and ties (or wins) on activity. The community frameworks are
healthy projects, but on every axis we care about, the SDK is at least as
good and usually better.

### Detailed look

#### `@modelcontextprotocol/sdk` — **recommended**

- **What it is:** the official, reference implementation of the protocol in
  TypeScript. Runs on Node, Bun, Deno.
- **API style:** create an `McpServer`, register tools imperatively with
  `server.tool(name, schema, handler)`. No directory conventions, no
  bundler integration, no decorators, no runtime magic.
- **Transports:** stdio, Streamable HTTP (and SSE legacy mode), plus
  middleware helpers for Express / Hono / Node's `http`.
- **Schema:** Standard Schema-compatible — we can bring Zod v4, Valibot, or
  ArkType (decision deferred to Entry 006). The validator we pick for the
  library can be reused verbatim for MCP tool input schemas.
- **Protocol freshness:** the SDK is the spec's reference; it leads, it
  doesn't follow.
- **Why this fits our architecture:** zero pressure on project layout. The
  MCP server can live in a single `src/mcp/server.ts` that imports pure
  library functions and registers them. If MCP disappears tomorrow, the
  library loses a façade, not a foundation.
- **Risk:** the most boilerplate per tool. That's by design — every tool
  is explicit. For us, with maybe a dozen tools, that's an acceptable
  trade for owning our own shape.

#### FastMCP (`punkpeye/fastmcp`) — **viable fallback**

- **What it is:** a thin DX-focused wrapper over the official SDK. Adds
  session helpers, OAuth proxy, embedded-resource convenience, audio/image
  helpers, edge-runtime support (Cloudflare Workers, Deno Deploy).
- **Why it's viable:** it doesn't impose a directory structure; tools are
  still defined imperatively. Migrating from the official SDK to FastMCP
  (or back) is contained.
- **Why not yet:** every feature FastMCP adds (sessions, OAuth, embedded
  resources, edge runtime) is a feature we don't need on day one. The
  Naysayer would correctly ask "what's the failing test that requires
  this?" — and the answer is "nothing." We can adopt FastMCP later if the
  SDK boilerplate becomes painful, and the migration is contained.

#### mcp-framework (`QuantGeekDev/mcp-framework`)

- **What it is:** class-per-tool with auto-discovery from `tools/`,
  `resources/`, `prompts/` directories. Peer-depends on the official SDK.
- **Why not:** the directory convention is the *opposite* of what we want.
  It pulls the MCP surface to the center of the project, forcing each
  builder to either live in `tools/` or have a parallel class in `tools/`.
  Both options drag the architecture toward MCP being primary.
- **When we'd reconsider:** never, for this project. Possibly fine for an
  MCP-server-as-product project; we are a library that happens to also
  serve MCP.

#### xmcp (`basementstudio/xmcp`)

- **What it is:** the "Next.js for MCP" — file-system routing, HMR,
  bundler (turbo / esbuild), zero-config Vercel deploy.
- **Why not:** every one of those features is a feature for an *MCP-server-
  shaped product*, not a library. We don't want HMR for tool definitions;
  we want the same tool definitions our unit tests exercise. We don't want
  a bundler; we ship plain ESM. We don't deploy to Vercel; we publish to
  npm. xmcp is a great choice for the project it's designed for — that
  isn't this one.
- **When we'd reconsider:** if we ever extract a hosted Grafana-asset-
  builder service as its own product, xmcp would be on the shortlist.

### Initial conclusions (proposed, not yet ratified)

1. **Use `@modelcontextprotocol/sdk` (the official SDK) directly.** Lowest
   architectural lock-in, dual MIT + Apache-2.0 licensing, canonical
   protocol coverage, Standard-Schema input validation.
2. **MCP lives under `src/mcp/`** as a thin adapter that imports pure
   library functions from `src/assets/`, `src/validation/`, etc. No
   business logic in `src/mcp/`; only schema mapping and error
   translation.
3. **Reuse the runtime validator picked in Entry 006** for MCP tool input
   schemas. One schema source per tool, used by library, CLI, and MCP.
4. **Defer FastMCP, mcp-framework, xmcp.** Reconsider FastMCP if and when
   SDK boilerplate becomes a measurable pain point — track this with a
   note in the project's "developer-experience friction" list when it
   exists.

These conclusions are inputs to a forthcoming ADR
(`docs/adr/0003-mcp-framework.md`) — not yet decided.

### LLM Expert's concerns (addressed pre-emptively)

- **Tool descriptions and error messages must be self-contained.** The SDK
  doesn't help us with this; it's discipline. The LLM Expert reviews every
  tool's description against the "could a model use this from this
  description alone?" bar.
- **Tool naming consistency.** Library function names → MCP tool names
  should be a mechanical mapping (`buildDashboard` → `build_dashboard`).
  The MCP Expert owns this convention and documents it in the eventual
  ADR.
- **Errors must be model-legible.** Validation failures return structured
  JSON-Pointer-style paths plus a one-sentence human explanation. The MCP
  Expert and LLM Expert co-own the error-shape contract.

### Naysayer's open challenges

- **Do we need MCP at all on day one?** No. The first failing test is for
  a *library* builder, not an MCP tool. MCP can wait until we have one
  builder worth exposing. This research entry is the foundation for when
  that moment arrives, not a directive to scaffold an MCP server today.
- **Is "no lock-in" worth the boilerplate?** Yes, for a library whose
  primary product is the typed builder, not the MCP surface. The cost is
  ~10 lines per tool; the benefit is that the library remains the source
  of truth and the MCP surface remains optional.
- **What if MCP itself dies?** We lose one façade. The library is
  unaffected. That asymmetry is the point.

### Verified sources

- `@modelcontextprotocol/sdk` LICENSE (dual MIT + Apache-2.0 confirmed)
  ([github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/LICENSE))
- `@modelcontextprotocol/sdk` on npm
  ([npmjs.com/package/@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk))
- FastMCP LICENSE (MIT confirmed)
  ([github.com/punkpeye/fastmcp/blob/main/LICENSE](https://github.com/punkpeye/fastmcp/blob/main/LICENSE))
- mcp-framework
  ([github.com/QuantGeekDev/mcp-framework](https://github.com/QuantGeekDev/mcp-framework))
- xmcp
  ([github.com/basementstudio/xmcp](https://github.com/basementstudio/xmcp),
  [xmcp.dev](https://xmcp.dev/))
- MCP SDKs overview
  ([modelcontextprotocol.io/docs/sdk](https://modelcontextprotocol.io/docs/sdk))

### Next research entries (planned)

- **Entry 004 — Runtime validator choice.** Done below (pulled forward
  from its original Entry 006 slot — it gates both library validation and
  MCP tool input schemas).
- **Entry 005 — Foundation SDK coverage matrix.** Owner: Grafana Expert.
- **Entry 006 — Foundation SDK API ergonomics** (hands-on; what an LLM
  stumbles on). Owner: LLM Expert + TypeScript Expert.
- **Entry 007 — Transitive dependency license audit** for Vitest +
  `@grafana/grafana-foundation-sdk` + `@modelcontextprotocol/sdk` +
  whichever validator we pick. Owner: Naysayer.

### Ratification status

- The official `@modelcontextprotocol/sdk` is **confirmed** as the MCP
  surface (user-ratified 2026-05-15). ADR `docs/adr/0003-mcp-framework.md`
  will record this when the ADR directory is created.
- **Zod v4** is **confirmed** as the runtime validator (user-ratified
  2026-05-15). Future ADR `docs/adr/0004-runtime-validator.md`.
- **MIT** is **confirmed** as the project license (user-ratified
  2026-05-15; see Entry 005). Future ADR `docs/adr/0005-license.md`.
- **Node 24 LTS for development, `engines: ">=22.0.0"`, pnpm via corepack**
  is **confirmed** (user-ratified 2026-05-15; see Entry 006). Future ADR
  `docs/adr/0006-runtime-and-package-manager.md`.
- **Grafana 12.x (12.4 specifically) as the v0 target** is **confirmed**
  (user-ratified 2026-05-15; see Entry 007). 13.x support deferred until
  the 13 line has settled and there's measurable demand. Future ADR
  `docs/adr/0007-grafana-version-target.md`.
- **Vitest as the test runner and fast-check for property-based tests**
  are **confirmed** (user-ratified 2026-05-15; see Entry 002). Type
  checking via `tsc --noEmit` as a separate CI step. Future ADR
  `docs/adr/0002-test-runner.md`.
- **Option C — heuristics in the library, LLM on the client side via
  MCP** — is **confirmed** as the intelligence-layer architecture
  (user-ratified 2026-05-15; see Entry 008). No LangChain, Vercel AI
  SDK, or provider SDKs in v0. v0 scope expands to include
  `src/inference/`, `src/composition/`, `src/ingest/`, and
  `src/templates/`. Future ADR `docs/adr/0008-intelligence-layer.md`.
- **Foundation SDK pinned to exact `0.0.12`** is **confirmed**
  (user-ratified 2026-05-15; see Entry 009). The SDK consolidated its
  versioning post-Grafana-11.6 into a single `0.0.x` line that targets
  Grafana 12+; pre-1.0 semver means each patch can carry breaking
  changes, so we pin exactly and bump deliberately. Future ADR
  `docs/adr/0009-foundation-sdk-pin.md`.
- **First MCP tool = `grafana_dashboard_build` (title only); v0 tool
  roadmap as listed in Entry 010** is **confirmed** (user-ratified
  2026-05-16). Tool naming follows `domain_noun_verb` / snake_case;
  three properties per tool (Simple, Composable, Predictable); tool
  descriptions are load-bearing. Implemented in the same PR that
  ratifies this entry. Future ADR
  `docs/adr/0010-mcp-tool-conventions.md`.
- **Intelligence layer pivoted from Option C (heuristics in code) to
  Option Z (primitives + guidance resources)** — user-ratified
  2026-05-16 (see Entry 011). The library exposes thin deterministic
  primitives (parse, build_panel, build_dashboard); opinions live as
  markdown in `docs/guidance/` and are exposed through MCP resources
  the client LLM can read. The library no longer plans
  `src/inference/`, `src/composition/`, or code-based `src/templates/`;
  AGENTS.md §5 layout updated accordingly. Amends Entry 008's
  conclusion 1 (heuristic engine in code) and §1.8's "encoded as
  deterministic heuristics" framing. Future ADR
  `docs/adr/0011-intelligence-layer-revised.md`.

---

## Entry 004 — Runtime validator (Zod v4 vs Valibot vs ArkType)

**Date:** 2026-05-15
**Researcher:** team (initial pass)
**Question:** Which runtime validation library should the project use for
(a) public library input validation, (b) MCP tool input schemas, and
(c) any cross-cutting validators (e.g. asserting that user-supplied
overrides don't clash with required fields)? "Right" weighs **error-message
quality** (AGENTS.md §1.5 "no silent failures"), **AI-assistant
familiarity** (LLM Expert concern), **Standard Schema compatibility**
(so the choice isn't permanent), and **license**.

### Why this matters

The validator is the boundary between "the world's mess" and "the typed
substrate we build dashboards from." Every public library call passes
through it; every MCP tool input passes through it. Get this wrong and we
either swallow bugs at the boundary (Zod-style schemas that silently coerce)
or we ship cryptic errors that an LLM can't recover from.

### Architectural premise (load-bearing)

> The validator we pick is used for **inputs we receive**, not for the
> outputs of `@grafana/grafana-foundation-sdk` builders. The SDK's
> TypeScript types already give us compile-time confidence in the JSON we
> emit; runtime validation is for the user's side of the boundary.
>
> All schemas we author should be **Standard Schema-compliant**, so any of
> the three candidates remains swappable later via the
> `~standard` property. Lock-in cost is therefore bounded.

### Evaluation criteria

1. **License** — permissive (§1.7).
2. **Error message quality** — structured paths, human-legible, model-
   parseable.
3. **TypeScript inference quality** — schemas should *be* the types, not
   parallel to them.
4. **AI-assistant familiarity** — for a project where AI agents are first-
   class contributors, the validator they're best at using matters.
5. **Standard Schema compliance** — interop + escape hatch.
6. **MCP SDK alignment** — the SDK has Zod as a peer dependency by default
   while remaining Standard-Schema-compatible. Friction matters.
7. **Stability / maturity** — we're picking a foundation; pre-1.0 churn
   would be costly.
8. **Performance** — secondary; we validate at boundaries, not in tight
   loops.
9. **Bundle size** — irrelevant for our use case (Node library + CLI + MCP
   server, never shipped to a browser).

### Candidates

| Library          | License | Stars  | Latest               | API style                                 | Standard Schema |
| ---------------- | ------- | ------ | -------------------- | ----------------------------------------- | --------------- |
| **Zod v4**       | MIT     | 42.7k  | v4.4.3 — May 4, 2026 | Chainable builder (`z.string().min(1)`)   | Yes             |
| Valibot          | MIT     | 8.7k   | v1.4.0 — May 5, 2026 | Functional composition (`v.pipe(...)`)    | Yes             |
| ArkType          | MIT     | 7.8k   | v2.2.0 — Mar 4, 2026 | Parsed string DSL (`type("string > 0")`)  | Yes             |

License verification: all three confirmed MIT from their respective
`LICENSE` files on `main`. All three implement Standard Schema (the spec
was co-designed by the maintainers of all three).

### Popularity and maintenance (snapshot 2026-05-15)

| Rank | Library  | Stars  | Total releases | Latest version       | Maintenance signal                                           |
| ---- | -------- | ------ | -------------- | -------------------- | ------------------------------------------------------------ |
| 1    | **Zod**  | 42.7k  | 205            | v4.4.3 (May 2026)    | 56 open PRs, 69 open issues, weekly cadence; v4 stable       |
| 2    | Valibot  | 8.7k   | 124            | v1.4.0 (May 2026)    | 43 open PRs, 62 open issues; v1.x stable since 2025          |
| 3    | ArkType  | 7.8k   | 836            | v2.2.0 (Mar 2026)    | 836 releases (heavy CI-driven cadence); 237 open issues; v2 stable; maintainer cites "multiple years full-time" |

All three are healthy and actively maintained. None is at risk of
abandonment. Stars favor Zod by ~5×; release cadence is comparable when
ArkType's CI noise is set aside.

### Detailed look

#### Zod v4 — **recommended**

- **Strengths:**
  - Dominant ecosystem: AI assistants have seen orders of magnitude more
    Zod than Valibot or ArkType. For an agent-built project, that
    asymmetry compounds with every PR.
  - The MCP SDK has Zod (specifically `zod/v4`) as a peer dependency; using
    Zod removes one layer of indirection at the MCP boundary.
  - v4 closed Zod's two historical weaknesses: type-instantiation cost
    dropped ~99% (from 25,000 to ~175 instantiations on representative
    schemas), and runtime performance improved ~4× over v3.
  - Codecs (v4) cleanly express the "parse → validate → re-emit" pipelines
    we'll need when accepting partial inputs and producing complete
    Grafana assets.
  - Error format is structured, well-tooled (zod-error, zod-validation-
    error), and familiar to consumers.
- **Weaknesses:**
  - Largest bundle of the three (~14 KB) — irrelevant for us, but worth
    naming.
  - Chainable builder pattern is more verbose than ArkType's string DSL
    when schemas get large.
- **Bundle/perf:** Not the smallest, not the fastest, but well inside the
  envelope for a server-side validator.

#### Valibot — runner-up; reconsider if we ever ship to a browser

- **Strengths:**
  - Smallest bundle by a wide margin (1.4 KB tree-shaken vs Zod's 14 KB)
    and fastest of the three on PkgPulse's 1M-iteration benchmark.
  - Functional composition style with one import per validator —
    aggressive tree-shake friendliness.
  - Stable v1.x line; clean break with the pre-1.0 API.
- **Weaknesses for us:**
  - We don't ship to a browser. The bundle-size advantage doesn't
    translate to value at our boundaries.
  - Less AI-assistant familiarity. PRs from agents will be measurably
    less accurate on Valibot APIs than on Zod.
  - One extra step at the MCP boundary (the SDK works with Standard
    Schema, but its examples and docs are Zod-first).
- **When we'd reconsider:** if we ever package a browser-runnable
  authoring playground or embed the builder in a Grafana plugin shell.

#### ArkType — appealing, but premature for us

- **Strengths:**
  - Most concise schema syntax of the three: `type({ "unit?": "string" })`
    vs Zod's `z.object({ unit: z.string().optional() })`.
  - Strong type-level validation — string DSL is parsed to types at the
    type level, catching errors at compile time.
  - Performance edge over Zod v4 (~1.7× faster in published benchmarks).
- **Weaknesses for us:**
  - Largest bundle (~42 KB) — again, irrelevant for our use case but
    worth noting.
  - String DSL is unusual; AI-assistant hallucination rate on ArkType
    syntax is the highest of the three in our informal experience.
  - 237 open issues and a fast-moving release cadence — the maintainer is
    full-time, which is a plus, but the project's *surface area* is still
    settling in ways Zod's no longer is.
  - The error-tooling ecosystem (better-error formatters, OpenAPI bridges,
    test-utility integrations) is thinner.
- **When we'd reconsider:** if Zod's verbosity becomes a measurable
  productivity drag once we're authoring schemas for every panel type and
  asset shape — but only after we've felt the pain, not as a pre-emptive
  optimization.

### Initial conclusions (proposed, not yet ratified)

1. **Use Zod v4** as the runtime validator. The combination of mature
   error tooling, MCP SDK alignment, and AI-assistant familiarity outweighs
   the bundle-size and conciseness advantages of the alternatives in our
   specific use case.
2. **Author all schemas through Zod's Standard Schema surface** (or wrap
   raw Zod schemas where Standard Schema is consumed). This preserves the
   ability to swap to Valibot or ArkType later without a rewrite of every
   schema's *consumers*.
3. **Centralize validators in `src/validation/`.** No ad-hoc schemas
   scattered through builder files; the validator is a boundary concept,
   not a per-builder utility.
4. **Defer error-formatter selection.** Pick `zod-validation-error` or
   roll our own when we have a real validation failure to format —
   Naysayer would (correctly) veto deciding this in research.

These conclusions are inputs to a forthcoming ADR
(`docs/adr/0004-runtime-validator.md`) — not yet decided.

### LLM Expert's concerns (addressed)

- **Error messages must be self-contained and structured.** Zod's
  `error.issues` array (with `path`, `code`, `message`, and `expected`)
  is the most LLM-friendly out of the box. We'll wrap it in a thin
  formatter that emits a JSON-Pointer path plus a one-sentence
  explanation, used identically by library, CLI, and MCP error paths.
- **Schemas should be discoverable from tool descriptions.** Zod's
  `.describe()` propagates through `zodToJsonSchema` and through the MCP
  SDK's tool registration — the LLM sees the description we wrote, not a
  generated stub.

### Naysayer's open challenges

- **Are we picking Zod because it's *familiar*, not because it's *right*?**
  Familiarity is a real constraint when AI agents are first-class
  contributors. That's a feature, not a bug. The Standard Schema escape
  hatch caps the cost of being wrong.
- **Do we need runtime validation at all on day one?** Only at the
  boundary where untyped input enters the system. For *internal* builder
  composition, TypeScript types are sufficient. The first failing test
  determines where the boundary actually is.
- **Why not ArkType for the conciseness win?** Because the cost of
  AI-agent errors on a less-familiar syntax compounds across hundreds of
  schemas. The Standard Schema escape hatch lets us revisit if Zod's
  verbosity becomes a measurable productivity drag.

### Verified sources

- Zod LICENSE (MIT)
  ([github.com/colinhacks/zod/blob/main/LICENSE](https://github.com/colinhacks/zod/blob/main/LICENSE))
- Valibot LICENSE (MIT)
  ([github.com/fabian-hiller/valibot/blob/main/LICENSE.md](https://github.com/fabian-hiller/valibot/blob/main/LICENSE.md))
- ArkType LICENSE (MIT)
  ([github.com/arktypeio/arktype/blob/main/LICENSE](https://github.com/arktypeio/arktype/blob/main/LICENSE))
- Standard Schema spec
  ([standardschema.dev](https://standardschema.dev/))
- Zod v4 release notes
  ([zod.dev/v4](https://zod.dev/v4))
- Comparative benchmarks (treat as directional)
  ([pkgpulse.com/guides/valibot-vs-zod-v4-typescript-validator-2026](https://www.pkgpulse.com/guides/valibot-vs-zod-v4-typescript-validator-2026),
  [pockit.tools/blog/zod-valibot-arktype-comparison-2026](https://pockit.tools/blog/zod-valibot-arktype-comparison-2026/))

### Next research entries (planned)

- **Entry 005 — Project license** (MIT vs Apache-2.0). Done below.
- **Entry 006 — Node runtime and package manager.** Done below Entry 005.
- **Entry 007 — Foundation SDK coverage matrix.** Owner: Grafana Expert.
- **Entry 008 — Foundation SDK API ergonomics.** Owner: LLM Expert +
  TypeScript Expert.
- **Entry 009 — Transitive dependency license audit** (Vitest, fast-check,
  Foundation SDK, MCP SDK, Zod). Owner: Naysayer.

---

## Entry 005 — Project license: MIT (ratified)

**Date:** 2026-05-15
**Researcher:** team
**Decision:** **MIT License**, user-ratified.
**Question:** AGENTS.md §1.7 mandates a permissive license but left the
choice between Apache-2.0 and MIT open. Pick one so the LICENSE file and
`package.json` can be authored.

### Comparison

| Aspect                  | MIT                                | Apache-2.0                                              |
| ----------------------- | ---------------------------------- | ------------------------------------------------------- |
| Length                  | ~170 words                         | ~10,000 characters                                      |
| Patent grant            | Implicit only                      | Explicit, with termination on patent litigation         |
| NOTICE file             | Not required                       | Required if upstream NOTICE files exist                 |
| Per-file headers        | Not customary                      | Customarily recommended                                 |
| Ecosystem default       | npm / TypeScript libraries         | Linux Foundation projects (Kubernetes, Grafana, MCP)    |
| Compatibility           | Universally consumable             | Universally consumable (with attribution)               |
| GPL-2.0 compatibility   | Yes                                | No (Apache-2.0 ↔ GPL-2.0 are not compatible)            |
| GPL-3.0 compatibility   | Yes                                | Yes                                                     |

### Decision rationale

1. **Naysayer principle.** Pick the smallest answer absent a concrete
   reason for the larger one. We have no patent strategy, no enterprise
   dual-licensing plan, no specific patent-troll concern that Apache-2.0's
   grant would defend against.
2. **Ecosystem fit.** Every direct dev/runtime dep we've selected is MIT
   (Vitest, Zod, fast-check, FastMCP), with the exceptions being the
   Apache-2.0 Foundation SDK and the dual-licensed MCP SDK — both
   consumable from an MIT project without friction.
3. **Lower ceremony.** No NOTICE file to maintain, no recommended per-file
   headers, no extra friction adding contributors.
4. **GPL-2.0 compatibility** is preserved (Apache-2.0 would forfeit it).
   We don't anticipate a GPL-2.0 consumer, but the option is free with
   MIT.

### What this requires

- Add a top-level `LICENSE` file containing the MIT text with copyright
  attribution at the time scaffolding happens (`package.json` creation).
- Set `"license": "MIT"` in `package.json`.
- AGENTS.md §1.7 updated to remove the "Apache-2.0 or MIT" placeholder
  and reference this entry.

### Naysayer's residual concerns

- **Are we sure we don't want the patent grant?** Yes — we're emitting
  JSON for an HTTP API; we are not implementing patentable algorithms.
- **Does picking MIT hurt enterprise adoption?** No — MIT is at least as
  enterprise-friendly as Apache-2.0; the question only matters in
  dual-licensing scenarios we have no plans for.

### Verified sources

- MIT License text
  ([opensource.org/licenses/MIT](https://opensource.org/licenses/MIT))
- Apache-2.0 License text
  ([apache.org/licenses/LICENSE-2.0](https://www.apache.org/licenses/LICENSE-2.0))
- License compatibility matrix
  ([gnu.org/licenses/license-list.html](https://www.gnu.org/licenses/license-list.html))

---

## Entry 006 — Node runtime and package manager (ratified)

**Date:** 2026-05-15
**Researcher:** team
**Decision:** **Node 24 LTS for development; `engines: ">=22.0.0"`; pnpm
via corepack.** User-ratified.

### Node version

| Version       | LTS status                       | End of LTS  | Native TS              |
| ------------- | -------------------------------- | ----------- | ---------------------- |
| Node 22 LTS   | "Active LTS" then "Maintenance"  | Apr 2027    | Experimental, via flag |
| **Node 24 LTS** | **Active LTS** (since Oct 2025) | **Apr 2028** | **Stable, default for `.ts`** |
| Node 26       | Current (non-LTS)                | n/a         | Stable                 |

**Decision:**
- **Develop on Node 24 LTS** — current Active LTS, stable native TypeScript
  for ad-hoc scripts, longest support window.
- **Library engines field: `">=22.0.0"`** — Node 22 LTS is supported by
  the Node project through April 2027 and many consumers will still be on
  it. There is no language or runtime feature we need that excludes Node
  22. Naysayer: gating on Node 24 would cost us users for no benefit.
- **CI matrix: Node 22 and Node 24.** Catches drift early.

### Package manager

| Manager | Install speed vs npm | Disk usage     | Strictness         | Risk for us                              |
| ------- | -------------------- | -------------- | ------------------ | ---------------------------------------- |
| npm     | 1× (baseline)        | baseline       | Tolerates phantoms | None, but tolerates phantom-dep bugs     |
| **pnpm**| **3.4×**             | **−70%**       | **Strict**         | Negligible; corepack handles install     |
| Bun     | 18×                  | best           | OK                 | Adds Bun runtime as dev requirement; Node-API edge cases |
| Yarn    | ~2× (Berry)          | varies         | Configurable       | Declining mindshare; PnP edge cases      |

**Decision: pnpm**, distributed via `corepack` (ships with Node 22+).

- **Why not npm:** strictness matters more than the "ships with Node"
  argument when AI agents are first-class contributors. pnpm's strict
  `node_modules` catches phantom-dep imports — code that works locally
  because some transitive dep happens to be hoisted — that npm silently
  tolerates and that bites in CI or in users' projects.
- **Why not Bun:** speed delta isn't worth the runtime divergence. Bun's
  Node-API compatibility is excellent but not perfect, and edge-case
  failures in a library you're shipping to other people's Node runtimes
  are precisely the failures you can't afford. Already picked Vitest, so
  no `bun test` synergy to capture.
- **Why not Yarn:** PnP adds friction with TypeScript and editor tooling;
  classic Yarn is in maintenance. pnpm is the better choice on every axis.
- **Distribution via corepack:** `"packageManager": "pnpm@<version>"` in
  `package.json` is sufficient — contributors don't install pnpm
  separately; corepack provisions the declared version automatically.

### What this requires (at scaffolding time)

- `package.json` declares `"engines": { "node": ">=22.0.0" }` and
  `"packageManager": "pnpm@<latest-stable>"`.
- `.npmrc` includes `engine-strict=true` so `pnpm install` fails on
  contributors running unsupported Node versions instead of producing a
  broken install.
- CI workflow runs the test suite on **Node 22 LTS** and **Node 24 LTS**
  matrix entries.
- Contributors enable corepack once (`corepack enable`); no other setup
  needed.

### Naysayer's residual concerns

- **"Pure npm would be lower-friction for contributors."** Marginally,
  yes. But: corepack is one command and ships with Node; pnpm's strictness
  pays for itself the first time it catches a phantom dep an agent
  introduced; and the install speed delta tightens the TDD loop.
- **"Why not gate on Node 24?"** No language feature we need is exclusive
  to 24. Excluding Node 22 LTS users until April 2027 costs us reach for
  no benefit.
- **"What about Deno?"** Out of scope; we're shipping an npm package
  consumable from Node. Deno can consume npm packages via `npm:` but
  isn't the primary target.

### Verified sources

- Node.js previous releases / LTS schedule
  ([nodejs.org/en/about/previous-releases](https://nodejs.org/en/about/previous-releases))
- Node 24 LTS announcement and native TS support
  ([blog.logrocket.com/node-js-24-new](https://blog.logrocket.com/node-js-24-new/))
- pnpm vs npm vs Bun benchmarks (treat as directional)
  ([pkgpulse.com/guides/pnpm-vs-bun-vs-npm-2026](https://www.pkgpulse.com/guides/pnpm-vs-bun-vs-npm-2026))
- corepack documentation
  ([nodejs.org/api/corepack.html](https://nodejs.org/api/corepack.html))

### Next research entries (planned)

- **Entry 007 — Grafana version support target.** Done below.
- **Entry 008 — Intelligence layer architecture** (heuristics vs runtime
  LLM vs hybrid). Owner: all six agents.
- **Entry 009 — Foundation SDK version pin** (npm dist-tag scheme;
  triggered by first install surprise). Owner: Grafana Expert + Naysayer.
- **Entry 010 — Foundation SDK coverage matrix** (against Grafana 12.x).
  Owner: Grafana Expert.
- **Entry 011 — Foundation SDK API ergonomics.** Owner: LLM Expert +
  TypeScript Expert.
- **Entry 012 — Transitive dependency license audit.** Owner: Naysayer.

---

## Entry 007 — Grafana version support target (ratified)

**Date:** 2026-05-15
**Researcher:** team
**Decision:** **Target Grafana 12.x for v0, specifically the 12.4 minor.**
13.x support deferred. User-ratified.

### The Grafana version landscape (snapshot 2026-05-15)

| Version | Status                          | Notes                                                  |
| ------- | ------------------------------- | ------------------------------------------------------ |
| 13.0    | Latest stable (released Apr 2026) | New major; minor releases still finding shape          |
| **12.4** | **Last 12.x, extended support** | **De-facto LTS for the 12 line; patches only**        |
| 12.3    | Supported                       |                                                        |
| 12.2    | Supported until **Jun 23, 2026**| Near EOL                                              |
| 11.6    | Last 11.x; EOL **Jun 25, 2026** | Effectively out of scope                              |
| ≤10.x   | EOL                             | Foundation SDK works against it but value is minimal   |

Grafana ships a minor every two months, patches every other month. Each
minor is supported for 9 months; the *last* minor of a major gets extended
support (acts as an LTS).

### Foundation SDK version alignment

The Foundation SDK is generated per Grafana version. Branches and npm
versions are tagged to a specific Grafana version (npm tags like
`10.1.0-cogv0.0.x.<ts>`). Types and builders for one Grafana version are
**not backward-compatible** with another major.

Consequence: choosing a Grafana target *is* choosing an SDK version pin.
Supporting two Grafana versions means either two builds or a CI matrix
exercising the same code against two pinned SDK versions, both of which
have real cost.

### Decision rationale

1. **Foundation SDK explicit guidance** — "best suited for Grafana ≥ 12."
   12 is the floor of "good experience."
2. **12.4 is the last 12.x minor and gets extended support** — it won't
   accumulate new minor changes, only patches. That is exactly the
   *stationary target* a library wants under it.
3. **13.x just released (April 2026)** — too early to chase. The library
   would be testing against a still-shaping API while 13.x minors find
   their final shape.
4. **Single-target keeps CI and code simple.** Naysayer wins: add 13.x
   support when a concrete consumer asks for it and 13.x has 2–3 minors
   under its belt (~Q4 2026).
5. **Production reality** — most self-managed Grafana installations will
   stay on 12.x through 2026. We meet our likely users where they are.

### What this implies concretely (at scaffolding time)

- `package.json` pins `@grafana/grafana-foundation-sdk` to the version
  aligned with **Grafana 12.4** (the most recent 12.x-targeted SDK
  release at install time). The exact version is settled when the package
  is added.
- Integration tests run against a containerized `grafana/grafana:12.4.x`.
- README states: *"Supports Grafana 12.x. 13.x support is tracked in
  [issue], to be added after 13.x has stabilized."*
- A periodic check (Naysayer-owned, perhaps every 3 months) confirms
  whether 13.x has matured enough to add.

### Naysayer's residual concerns

- **"Targeting one version is brittle when Grafana ships monthly."**
  True — but extended-support minors don't accumulate breaking changes,
  only patches. Brittleness is bounded.
- **"What about consumers on 13.x today?"** They can use the library; it
  emits Grafana 12-shape JSON that 13 should accept for most asset types
  (Grafana takes pains with backward compat for dashboard JSON). When
  this stops being true for a specific asset, we revisit.
- **"What about consumers on 11.6 in the next 6 weeks before EOL?"** Not
  worth supporting; they're already on an upgrade path.

### What this does NOT decide

- Whether the library *also* needs to *read/parse* older Grafana JSON
  (e.g., to upgrade legacy dashboards). That's a future feature, not part
  of v0.
- Whether MCP tools should expose the target Grafana version as an input
  parameter. Deferred — answer when the first MCP tool ships.
- The exact SDK npm version to pin. That gets settled when the dep is
  first added; record it in `package.json` and reference here.

### Verified sources

- Grafana release life cycle / EOL policy
  ([grafana.com/docs/release-life-cycle](https://grafana.com/docs/release-life-cycle/))
- Grafana version EOL dates
  ([endoflife.date/grafana](https://endoflife.date/grafana))
- Foundation SDK README — "best suited for Grafana ≥ 12"
  ([github.com/grafana/grafana-foundation-sdk](https://github.com/grafana/grafana-foundation-sdk))
- Foundation SDK npm releases
  ([npmjs.com/package/@grafana/grafana-foundation-sdk](https://www.npmjs.com/package/@grafana/grafana-foundation-sdk))
- What's new in Grafana 13.0
  ([grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0](https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/))

---

## Entry 008 — Intelligence layer architecture

**Date:** 2026-05-15
**Researcher:** all six agents
**Question:** Beyond exposing the Foundation SDK as builders, should the
library include "intelligence" — given a metric (name, type, description,
or a Prometheus endpoint + prefix), generate appropriate panels and
dashboards automatically? If so, where does that intelligence live, and
do we use LangChain / Vercel AI SDK / direct LLM calls / pure heuristics?

This is the first entry whose decision changes the *shape* of the project,
not just a dependency. It deserves explicit input from every agent.

### What already exists (load-bearing context)

**Grafana Metrics Drilldown is preinstalled in Grafana 12+.** It provides
queryless, interactive exploration of Prometheus metrics with automatic
visualization selection (gauge vs counter), smart segmentation by label,
related-metric discovery, and an `autoQuery` component that picks
appropriate PromQL per metric type. *Runtime, in-UI, transient exploration
is already solved by Grafana itself.*

That bounds our value proposition. The library cannot justify itself as
"automatic panel from a metric" — Grafana already does that, better, in
the browser. Our value-add has to be something Drilldown isn't:

1. **Asset-as-code** — persistent dashboards committed to git, reviewed,
   versioned, deployed via CI.
2. **Composition with structure** — a *coherent* dashboard with rows,
   sections, organizational conventions (USE / RED / golden signals),
   not one panel at a time.
3. **Encoded domain patterns** — kube-state-metrics dashboards,
   node_exporter dashboards, app-specific dashboards: known shapes for
   known integrations.
4. **Endpoint-to-starter-dashboard** — point at a `/metrics` URL, get a
   first-draft committable dashboard.
5. **LLM-driven composition via MCP** — agents can call our heuristics as
   tools and compose them into a dashboard the user would actually keep.

### Three architectural options

**Option A — Pure heuristics, no LLM in the library.**
Deterministic rules: counter → `rate(metric[$__rate_interval])` panel,
histogram → heatmap + p50/p95/p99 lines, gauge → instant + line. Unit
detection from name suffix (`_bytes`, `_seconds`, `_total`). Grouping by
prefix. Pre-built templates for USE / RED / golden signals. Endpoint
ingestion via exposition-format parsing. All pure functions; testable;
deterministic; free; offline.

**Option B — LLM integration in the library at runtime.**
LangChain.js or Vercel AI SDK or a direct provider SDK. The library calls
an LLM to make composition decisions, name panels, write descriptions.
Requires API key, costs money per call, non-deterministic, large dep tree.

**Option C — Heuristics in the library, LLM in the *client* (via MCP).**
The library is pure-deterministic heuristics. MCP exposes those heuristics
as composable tools. The LLM that's already on the other end of the MCP
connection does narrative, naming, composition. We never call an LLM
ourselves.

### The agents' positions

#### Grafana Expert
> "Heuristics are sufficient for mechanical translation. The
> counter→rate, histogram→heatmap, gauge→instant mappings are
> well-established practice — they're what every hand-written dashboard
> does, what Grafana Drilldown's `autoQuery` does, what every Prometheus
> tutorial teaches. The *intelligence* worth encoding is the patterns:
> USE method (utilization/saturation/errors), RED (rate/errors/duration),
> the golden signals. Bundle those as templates. Domain integrations
> (kube-state-metrics, node_exporter) have well-known dashboard shapes —
> bundle those too. None of this needs an LLM."

#### LLM Expert
> "LLMs are good at narrative, naming, and ambiguity. They are *not* good
> at mechanical translation that has a right answer. 'Counter metric →
> rate panel' has a right answer. 'What's a good dashboard title?' does
> not. 'These five metrics describe a Kafka consumer; what story should
> the dashboard tell?' — that's the LLM's job. The right place for that
> intelligence is on the client side of the MCP boundary, not inside our
> library. Our library should expose composable primitives whose names,
> descriptions, and shapes make it easy for an LLM to compose them
> well."

#### MCP Expert
> "If we put LLM calls inside MCP tools, the MCP server itself becomes
> non-deterministic and starts depending on the user's API key. That's a
> different kind of MCP server — a *meta-agent* — and it's not what we
> should be building. Our MCP tools should be small, deterministic, and
> composable: `analyze_metric`, `suggest_panels_for_metric`,
> `compose_dashboard_from_panels`, `ingest_prometheus_endpoint`. The
> client LLM calls these and weaves the results."

#### TypeScript Expert
> "LangChain.js pulls in a substantial dependency tree — wrong fit for a
> focused library. Vercel AI SDK is lighter but still adds a transport
> abstraction we don't need. Direct provider SDKs are the simplest if we
> ever do need LLM calls, but Naysayer's right that we shouldn't add any
> of these without a concrete failing test that requires them. Heuristics
> are pure TypeScript, perfectly testable, and produce code an LLM client
> can introspect."

#### Senior Doc Writer
> "If we add intelligence, the docs need to explain *why* a given metric
> became a given panel. 'Your `http_requests_total` is a counter, so we
> applied `rate(... [$__rate_interval])` and grouped by status code'
> — that explanation is teaching the user PromQL, which is half the
> battle. Heuristic decisions are documentable; LLM decisions are
> not (they're per-call). Heuristics win on docs alone."

#### Naysayer
> "What's the failing test that requires an LLM at runtime? None.
> Heuristics first. The library can do everything described above
> without an LLM: parse exposition format, infer types, apply mappings,
> compose templates, emit JSON. Adding LLMs in v0 introduces:
> non-determinism (breaks AGENTS.md §1.4), runtime cost (user pays),
> latency, dependency on third-party API contracts, license surface
> (LangChain has many sub-packages with varying licenses), and a
> maintenance burden for behavior we don't yet know we need.
> Pick the smallest answer."

### Synthesis (proposed)

The agents are not in disagreement. They converge on **Option C** with a
specific shape:

1. **Library v0 = deterministic heuristics, no LLM.**
   - `parse(expositionText) → MetricDefinition[]`
   - `inferType(metric) → 'counter' | 'gauge' | 'histogram' | 'summary'`
   - `suggestPanels(metric) → PanelBuilder[]` (heuristic-driven)
   - `groupByPrefix(metrics) → Group[]`
   - `composeDashboard(groups, template) → DashboardBuilder`
   - Bundled templates: USE, RED, four golden signals.
   - Bundled integrations *later*, on demand: kube-state-metrics,
     node_exporter, etc.
2. **MCP tools = thin adapters over the heuristics.** Tools are small,
   composable, deterministic. The LLM client orchestrates them.
3. **No LangChain, no Vercel AI SDK, no provider SDKs in v0.** Add one
   only if and when there's a specific failure heuristics can't address.
4. **Future optional `@<scope>/intelligence` package** (well after v0):
   if real demand surfaces for LLM-powered narrative/composition, build
   it as a *separate* package that depends on the core. Users opt in by
   installing it and providing an API key. The core library stays pure.
5. **Use LLMs in *our* development, not at *users'* runtime.** Claude /
   ChatGPT help us design the heuristics offline (e.g., "what's the
   conventional dashboard shape for a Kafka consumer?"); we encode the
   answer as deterministic rules. The intelligence is *in* the rules,
   not in a runtime call.

### Why Option C beats Option B for this project specifically

- **AGENTS.md §1.4 (deterministic output).** Same input must produce
  byte-identical JSON. An LLM at runtime breaks this on principle.
- **AGENTS.md §1.6 (small, composable builders).** Heuristic functions
  *are* small composable builders. An LLM call is a god-feature.
- **AGENTS.md §1.7 (permissive licensing).** Heuristics have zero new
  license surface. LangChain has many sub-packages whose licenses we'd
  have to audit; provider SDKs vary.
- **The MCP architecture is precisely so the LLM lives in the client.**
  We're already exposing our surface via MCP for LLM consumption. Pulling
  an LLM *into* the server would double-count.
- **Cost and latency live with the user.** If they want LLM-powered
  composition, they're already paying for an LLM client. Our heuristics
  return in microseconds and cost nothing.

### What this implies for v0 scope

- **Two new modules** beyond raw builders: `src/inference/` (type
  detection, unit detection, naming conventions) and `src/composition/`
  (groupings, templates, dashboard assembly).
- **One new tool category** in MCP: tools that take metric inputs and
  return panel/dashboard suggestions. Each is a thin wrapper over the
  pure heuristic.
- **An ingestion path**: `src/ingest/prometheus.ts` — parse the
  exposition format, hand off to inference + composition.
- **Bundled templates** in `src/templates/`: USE, RED, golden signals.

### Comparison of LLM-orchestration libraries (kept on file for if/when)

| Library            | License    | Style                     | Bundle    | Fit for us       |
| ------------------ | ---------- | ------------------------- | --------- | ---------------- |
| LangChain.js       | MIT (core; some integrations vary) | Kitchen-sink orchestration | Heavy     | Wrong fit        |
| Vercel AI SDK      | Apache-2.0 | Minimal streaming + tools | Lightweight | If we ever need it, this  |
| Anthropic SDK      | MIT        | Direct API                | Tiny      | Simplest, if we need direct calls |
| OpenAI SDK         | Apache-2.0 | Direct API                | Tiny      | Same             |

Recorded for completeness. **None to be added in v0.**

### Naysayer's residual concerns

- **"Are templates and heuristics enough of a differentiator vs Grafana
  Drilldown?"** Asset-as-code is the differentiator. Drilldown is an
  exploration tool; we produce committable, versioned dashboards. The
  heuristics overlap with Drilldown's `autoQuery` is fine — both can be
  right.
- **"Could we be missing a class of user who really does want
  LLM-composed dashboards from the library?"** Yes, possibly. They can
  build it on top of our MCP surface from the client side, or wait for
  the optional `@<scope>/intelligence` package. Their need doesn't
  justify breaking AGENTS.md §1.4 for everyone.
- **"What about `prom-client`-style ecosystem deps for exposition-format
  parsing?"** Audit at the time we add it. There are MIT-licensed
  parsers available; the Naysayer signs off on the specific one when it's
  proposed.

### Decision sought

This is a strategic decision the user should ratify before scaffolding
proceeds, because it shapes the directory layout and the v0 scope.

### Verified sources

- Grafana Metrics Drilldown (preinstalled in Grafana 12+)
  ([github.com/grafana/metrics-drilldown](https://github.com/grafana/metrics-drilldown),
  [grafana.com/docs/grafana/latest/explore/simplified-exploration/metrics](https://grafana.com/docs/grafana/latest/explore/simplified-exploration/metrics/))
- Prometheus metric types and PromQL best practices
  ([prometheus.io/docs/concepts/metric_types](https://prometheus.io/docs/concepts/metric_types/),
  [prometheus.io/docs/practices/histograms](https://prometheus.io/docs/practices/histograms/))
- LangChain.js vs Vercel AI SDK comparisons (treat as directional)
  ([speakeasy.com/blog/ai-agent-framework-comparison](https://www.speakeasy.com/blog/ai-agent-framework-comparison),
  [strapi.io/blog/langchain-vs-vercel-ai-sdk-vs-openai-sdk-comparison-guide](https://strapi.io/blog/langchain-vs-vercel-ai-sdk-vs-openai-sdk-comparison-guide))

### Next research entries (planned)

- **Entry 009 — Foundation SDK version pin.** Done below.
- **Entry 010 — Foundation SDK coverage matrix.** Owner: Grafana Expert.
- **Entry 011 — Foundation SDK API ergonomics.** Owner: LLM Expert +
  TypeScript Expert.
- **Entry 012 — Transitive dependency license audit.** Owner: Naysayer.

---

## Entry 009 — Foundation SDK version pin

**Date:** 2026-05-15
**Researcher:** team
**Triggered by:** the first install (`pnpm add @grafana/grafana-foundation-sdk`
on the `claude/dashboard-builder` branch) resolved to `^0.0.12`, not the
Grafana-version-aligned pin Entry 007 implied.
**Question:** What's the right npm pin for the Foundation SDK against
our Grafana 12.x target?

### What the npm registry actually publishes

Inspecting `@grafana/grafana-foundation-sdk` on npm reveals two
coexisting publishing schemes:

**Per-Grafana-version dist-tags** (for Grafana 10.x and 11.x):

| dist-tag         | resolves to                             | Grafana target |
| ---------------- | --------------------------------------- | -------------- |
| `10-1-latest`    | `10.1.0-cogv0.0.x.<ts>`                 | Grafana 10.1   |
| `10-2-latest`    | `10.2.0-cogv0.0.x.<ts>`                 | Grafana 10.2   |
| `10-3-latest`    | `10.3.0-cogv0.0.x.<ts>`                 | Grafana 10.3   |
| `10-4-latest`    | `10.4.0-cogv0.0.x.<ts>`                 | Grafana 10.4   |
| `11-0-latest`    | `11.0.0-cogv0.0.x.<ts>`                 | Grafana 11.0   |
| `11-1-latest` … `11-6-latest` | `11.X.0-cogv0.0.x.<ts>`     | Grafana 11.1–11.6 |
| `latest`         | **`0.0.12`** (published 2026-03-04)     | **Grafana 12+** |

**There is no `12-x-latest` or `13-x-latest` dist-tag.** Around
February 2026 the SDK consolidated from per-Grafana-version publishing
into a single `0.0.x` line published from `main`, which tracks current
Grafana (12+).

The README in the installed `0.0.12` package confirms this with its
official install command:

```shell
yarn add '@grafana/grafana-foundation-sdk@~v0.0.12'
```

So `~0.0.12` (or equivalent) IS the recommended pin for Grafana 12+
today.

### Implications

1. **The SDK pin we want for Grafana 12.x is `0.0.12`** (or whichever
   `0.0.x` is current at the time of install). This *is* the
   Entry 007-ratified "pin to a Grafana 12.x SDK version" — the SDK
   maintainers chose `0.0.x` as the name for that line.
2. **Pre-1.0 semver convention** means each `0.0.x` patch can include
   breaking changes. npm's `^0.0.12` is effectively an exact pin (caret
   on `0.0.x` collapses to exact match by spec); `~0.0.12` would allow
   patch updates `>=0.0.12 <0.1.0`.
3. **No multi-target ambiguity yet.** Since the SDK consolidated the
   12+ line into `0.0.x`, there's no choice to make about Grafana 12 vs
   13 — both ride the same `latest` tag for now. When the SDK
   inevitably splits this (probably when 13 introduces incompatibly
   different schemas), we'll need to revisit.
4. **Stability signal.** `0.0.12` was published 2026-03-04 and is still
   the latest 2.5 months later. Either stable or paused; either way,
   safe to depend on at the current minute.

### Decision

**Pin exactly: `"@grafana/grafana-foundation-sdk": "0.0.12"`** (no
caret, no tilde).

Reasoning:
- **Naysayer principle.** Smallest, most conservative answer. Pre-1.0
  semver gives no guarantees against breaking changes on patch bumps,
  so an exact pin is the only honest choice.
- **Deliberate bumps.** Every SDK upgrade becomes a conscious PR with a
  test run; we never silently absorb a new version on `pnpm install`.
- **Lockfile redundancy.** `pnpm-lock.yaml` already pins exactly for
  reproducibility; the manifest pin makes the intent explicit at the
  manifest layer too, which is what humans (and reviewers, and
  LLM-driven contributors) see first.

When we want to upgrade:
1. `pnpm add @grafana/grafana-foundation-sdk@<new-version>`
2. Run `pnpm test && pnpm typecheck && pnpm build`
3. PR with a CHANGELOG entry citing the SDK CHANGELOG diff
4. The Grafana Expert reviews the SDK changelog for breaking changes

### Naysayer's residual concerns

- **"We'll miss bug fixes if we pin exactly."** Yes, deliberately —
  there's no `dependabot.yml` for this repo yet, but when we add one, we
  let bot-PRs catch us up after they pass CI. Until then, periodic
  manual review.
- **"What if 12-x-latest gets added later?"** If the SDK reintroduces
  per-version dist-tags for Grafana 12, we re-pin to that and update
  this entry. The decision is reversible; the entry stays as the
  historical record of what we knew at the time.
- **"Why not vendor the schema and bypass the SDK entirely?"** That's
  the grafonnet-lib mistake (Entry 001) — hand-maintained typed wrappers
  over Grafana don't survive the release cadence. We use the official
  generated SDK precisely so we don't have to.

### What this changes in code

- `package.json` dependency line changes from `^0.0.12` to `0.0.12`.
- `pnpm-lock.yaml` is unchanged (it already resolved to `0.0.12`
  exactly).
- All pipelines remain green.

### Verified sources

- npm dist-tags for `@grafana/grafana-foundation-sdk`
  (via `npm view @grafana/grafana-foundation-sdk dist-tags`)
- npm publish timeline showing the Jan→Feb 2026 versioning shift
- Foundation SDK README install command
  ([github.com/grafana/grafana-foundation-sdk/blob/main/README.md](https://github.com/grafana/grafana-foundation-sdk/blob/main/README.md))
- npm semver rules for `^` on `0.0.x`
  ([docs.npmjs.com/cli/v10/configuring-npm/package-json#dependencies](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#dependencies))

### Next research entries (planned)

- **Entry 010 — First MCP tool + recommended tool roadmap.** Done below.
- **Entry 011 — Foundation SDK coverage matrix.** Owner: Grafana Expert.
- **Entry 012 — Foundation SDK API ergonomics.** Owner: LLM Expert +
  TypeScript Expert.
- **Entry 013 — Transitive dependency license audit.** Owner: Naysayer.

---

## Entry 010 — First MCP tool + recommended tool roadmap

**Date:** 2026-05-16
**Researcher:** all six agents
**Question:** What is the first MCP tool we should ship, and what is the
v0 tool roadmap behind it? Two layers: the immediate "what's next" and
the sequenced list each expert would build toward.

### Why this matters

The MCP server is the LLM-facing surface. The first tool sets the
design pattern — naming, input shape, error shape, response shape —
for every subsequent tool. It also surfaces the **MCP-boundary design
question** the library has been able to defer: tools can't accept
TypeScript-level objects (e.g., SDK builders); they must accept JSON
inputs. So the first MCP tool that touches panels (or anything composed)
forces us to define a JSON input shape.

### MCP design principles (from current best practice)

Synthesized from the AWS prescriptive guidance, the official MCP docs,
and the SDK tool-registration examples:

1. **Naming: `domain_noun_verb`, snake_case.** Predictable patterns
   matter more than terse names. `grafana_dashboard_build` over
   `make_dash`. Snake_case tokenizes well for current LLMs.
2. **Three properties per tool: Simple, Composable, Predictable.** Each
   tool does one thing; tools are Lego pieces; behavior and errors are
   consistent.
3. **Keep the tool count lean.** Tool hallucination starts to bite past
   30–40 tools per server. We will not approach this for v0; design for
   it long-term.
4. **Descriptions are load-bearing.** "Optimizing tool descriptions and
   names can have a bigger impact on quality than the underlying LLM."
   Every tool ships with a Zod `.describe()` on every field plus a
   tool-level description that explains *when* the LLM should call it.
5. **Errors are model-legible.** Validation failures return structured
   JSON-Pointer-style paths + a one-sentence human explanation. (See
   AGENTS.md §1.5, "no silent failures.")

### Each agent's recommendation

#### Grafana Expert
> "Start with what the library can already do — `grafana_dashboard_build`
> mirroring the current `buildDashboard({ title })`. Then add the most
> common panel type (`grafana_timeseries_panel_build`), then alert rules
> and contact points because those are where production Grafana
> setups bleed time."
>
> **First tool:** `grafana_dashboard_build`
> **v0 list (in order):**
> 1. `grafana_dashboard_build`
> 2. `grafana_timeseries_panel_build`
> 3. `grafana_alert_rule_build`
> 4. `grafana_contact_point_build`

#### MCP Expert
> "Start with the simplest tool that proves the entire stack: stdio
> transport, tool registration, Zod schema validation, JSON response,
> error path. That's `grafana_dashboard_build` with only `{ title }` as
> input. Once the pipe is hot, every subsequent tool is incremental.
> Resist the urge to ship two tools in the first PR — one tool, the
> full transport + registration + Zod + handler + error story, is the
> right slice."
>
> **First tool:** `grafana_dashboard_build` (title-only)
> **v0 list (in order):**
> 1. `grafana_dashboard_build` (title-only, stdio transport)
> 2. *Same tool* extended to accept panels (forces the JSON input-shape
>    decision)
> 3. `grafana_timeseries_panel_build` (so the LLM can produce panels to
>    feed into #2)
> 4. Streamable HTTP transport, with the same tools

#### LLM Expert
> "The LLM needs to know *what panel types exist* before it can ask for
> one. Ship an MCP **resource** alongside the first tool —
> `grafana://panel-types` — that returns a JSON-schema-ish description
> of every panel type and its required/optional fields. Otherwise the
> LLM hallucinates a 'cpu' panel type and we have to error-message it
> back to reality. Also: tool descriptions must be model-self-contained.
> A model should be able to use `grafana_dashboard_build` from its
> Zod-derived JSON schema alone, no external docs."
>
> **First tool:** `grafana_dashboard_build` + **first resource:**
> `grafana://panel-types`
> **v0 list:** as MCP Expert, plus a resource per discoverable category
> (panel types, alert types, datasource types).

#### TypeScript Expert
> "Direct 1-to-1 mapping from library function to MCP tool. The Zod
> schema for the tool input *is* the runtime check for
> `BuildDashboardInput`. Single source of truth. No duplication, no
> drift. Generic helper `defineTool<Input>(name, schema, fn)` is
> tempting but premature — write three tools the explicit way first,
> extract the pattern from real examples on the fourth."
>
> **First tool:** `grafana_dashboard_build`
> **v0 list:** as MCP Expert; refactor to a `defineTool` helper after
> the 3rd or 4th tool exists.

#### Senior Doc Writer
> "Whatever the first tool is, the README must show a complete
> end-to-end example: install the MCP server, configure a client
> (Claude Desktop, Cursor, etc.), call the tool, see the dashboard.
> Don't make the reader piece together five docs to figure out the
> setup. The tool *itself* matters less than the on-ramp around it."
>
> **First tool:** doesn't strongly care — picks `grafana_dashboard_build`
> for simplicity of the on-ramp.
> **v0 list:** add a "build your first dashboard via MCP" guide in
> `docs/guides/` alongside the first tool.

#### Naysayer
> "What is the *failing test* that requires an MCP server? None yet.
> The library works without it. Building the MCP wrapper now is fine
> only if we can do it as a TDD slice in one PR. The first tool is
> `grafana_dashboard_build({ title })`. No panels, no resources, no
> intelligence, no streamable HTTP — just stdio transport, one tool,
> Zod schema, handler that calls `buildDashboard()`, JSON back. One
> failing test: 'when I call the tool with `{ title: "X" }`, I get
> back a dashboard whose `.title` is "X".'"
>
> **First tool:** `grafana_dashboard_build({ title })` — title only.
> Everything else deferred.

### Synthesis (proposed)

The agents converge on **`grafana_dashboard_build`** as the first tool.
The differences are about *scope of the first PR*:

- **Naysayer**: title only, nothing else.
- **MCP Expert / TypeScript Expert**: agrees with Naysayer for PR 1;
  panels in PR 2; second tool in PR 3.
- **LLM Expert**: add a `grafana://panel-types` resource alongside.
- **Grafana / Doc Writer**: don't strongly object to "title-only first."

**Recommended slice for PR #3 (first MCP tool):**

```ts
// src/mcp/server.ts
const server = new McpServer({ name: 'mcp-grafana', version: '0.0.0' });

server.registerTool(
  'grafana_dashboard_build',
  {
    description:
      'Build a Grafana dashboard from minimal inputs. Returns ' +
      'the dashboard as JSON suitable for posting to Grafana\'s ' +
      'HTTP API or writing to a provisioning file.',
    inputSchema: z.object({
      title: z.string().describe('The dashboard title shown in Grafana.'),
    }),
  },
  async ({ title }) => {
    const dashboard = buildDashboard({ title });
    return { content: [{ type: 'text', text: JSON.stringify(dashboard) }] };
  },
);
```

Plus:
- stdio transport (`StdioServerTransport`)
- A bin entry in `package.json` so the server runs via
  `npx mcp-grafana` or similar
- An integration-shaped test using the SDK's in-memory client to call
  the tool and assert the response

**v0 tool roadmap (sequenced):**

| # | Tool                                | What it does                                          |
| - | ----------------------------------- | ----------------------------------------------------- |
| 1 | `grafana_dashboard_build`           | Build a dashboard from `{ title }`                    |
| 2 | `grafana_dashboard_build` (extended)| Accepts a `panels` array of panel-JSON inputs         |
| 3 | `grafana_timeseries_panel_build`    | Build a timeseries panel from `{ title, query? }`     |
| 4 | `grafana_alert_rule_build`          | Build an alert rule from `{ name, query, threshold }` |
| 5 | `grafana_contact_point_build`       | Build a contact point from `{ name, type, settings }` |

Each row is its own PR, each follows TDD, each forces one design
decision (input shape, error shape, resource listing, etc.).

### Open questions surfaced (to resolve in PR #3 or later)

- **Input shape for panels in tools.** When tool #2 lands, what does
  the JSON `panels[]` look like? Probably `[{ type: 'timeseries', title,
  ... }]` — Shape 3 from PR #2's design discussion, brought back because
  MCP doesn't get the option to pass-through SDK builders.
- **Resources vs tools.** Do we add `grafana://panel-types` in PR #3 or
  defer? The LLM Expert pushes for "now"; the Naysayer pushes for "when
  the second tool lands and discoverability becomes painful."
- **Transport.** stdio for v0. Streamable HTTP after the tool roadmap
  is mostly populated.
- **bin entry / executable.** Add `"bin": { "mcp-grafana": "./dist/mcp/server.js" }`
  in PR #3 so users can `npx mcp-grafana` or wire it into Claude Desktop.

### Verified sources

- AWS Prescriptive Guidance — MCP tool organization
  ([docs.aws.amazon.com/prescriptive-guidance/latest/mcp-strategies/mcp-tool-strategy-organization.html](https://docs.aws.amazon.com/prescriptive-guidance/latest/mcp-strategies/mcp-tool-strategy-organization.html))
- MCP SDK tool registration & Zod input schemas
  ([deepwiki.com/modelcontextprotocol/typescript-sdk/3.2-tool-registration-and-execution](https://deepwiki.com/modelcontextprotocol/typescript-sdk/3.2-tool-registration-and-execution))
- MCP server design best practices (Workato)
  ([docs.workato.com/mcp/mcp-server-design.html](https://docs.workato.com/mcp/mcp-server-design.html))
- 5 best practices for building MCP servers (Snyk)
  ([snyk.io/articles/5-best-practices-for-building-mcp-servers](https://snyk.io/articles/5-best-practices-for-building-mcp-servers/))
- Known issue: Zod 4 `.describe()` not propagating in some MCP SDK
  versions ([github.com/modelcontextprotocol/typescript-sdk/issues/1143](https://github.com/modelcontextprotocol/typescript-sdk/issues/1143))
  — to verify against our pinned SDK version when PR #3 lands.

### Next research entries (planned)

- **Entry 011 — Intelligence layer revisited.** Done below.
- **Entry 012 — Foundation SDK coverage matrix.** Owner: Grafana Expert.
- **Entry 013 — Foundation SDK API ergonomics.** Owner: LLM Expert +
  TypeScript Expert.
- **Entry 014 — Transitive dependency license audit.** Owner: Naysayer.

---

## Entry 011 — Intelligence layer revisited: primitives + guidance resources (amends Entry 008)

**Date:** 2026-05-16
**Researcher:** team
**Triggered by:** the user's pushback while planning the heuristic engine
for Prometheus exposition format — *"how can we infer these things
without writing a ton of rules? can the LLM read all of our metrics and
just use the raw tools?"*
**Question:** does the original Entry 008 division of labor
(heuristics in code; LLM at the client composes) hold up when we look
at what heuristics actually have to encode?

### What Entry 008 ratified, restated

> Option C: deterministic heuristics in the library (`src/inference/`,
> `src/composition/`, `src/templates/`); LLM on the client via MCP.

That framing is still right about **where** the LLM lives (client side,
not in our server). It was **wrong about how much knowledge to encode
in code.**

### What the pushback surfaced

Almost everything a heuristic engine would encode is already known to
any modern LLM (Claude, GPT, etc.):

- Counter → `rate()` with `$__rate_interval`
- `_bytes` suffix → bytes unit; `_seconds` → seconds; `_total` → counter
- Status labels with 4xx/5xx values → split for error visibility
- RED method for request services, USE for resources, golden signals
  generally
- Title from name: drop `_total`, snake → title case
- HELP text → description

Encoding all of this in TypeScript rules **duplicates knowledge that
already lives in the LLM**, with a maintenance treadmill we'd own
forever. Every new metric pattern would require a new rule; edge cases
would multiply; we'd write tests for things the LLM already does
correctly.

### The three options re-examined

| | Option X — heavy heuristics in code (Entry 008's original framing) | Option Y — thin primitives only | Option Z — primitives + opinions as MCP resources |
|---|---|---|---|
| Library does | Parse + infer type/unit/query/groupings + suggest + score + compose templates | Parse + build_panel + build_dashboard | Same as Y, plus a tiny resource handler that serves `docs/guidance/*.md` |
| LLM does | Picks among ranked suggestions | Everything that's not parsing or schema-building | Same as Y, optionally reads our markdown opinions first |
| New code modules | `inference/`, `composition/`, `templates/` | `ingest/` only | `ingest/` + a 10-line resource handler |
| Maintenance | Rule per edge case, forever | None of those rules | Edit markdown when opinions change |
| Determinism | Server-side high | Mixed (parse deterministic; LLM's part not) | Same as Y |
| Quality ceiling | Capped at what we encode | LLM's full reasoning | LLM + our specific opinions |
| Updating the RED template | Code change + tests | Hope the next LLM knows it | Edit a markdown file |

### Where the LLM is bad (so the library MUST handle it)

- **Parsing Prometheus exposition format reliably.** Easy to hallucinate
  fields, miss escaped label values, drop the `# TYPE` line, etc.
- **Producing valid Grafana JSON.** The schema is huge and exact; one
  wrong key and Grafana rejects the dashboard. Our typed builders
  guarantee well-formed output.
- **Validation at the boundary.** Catching required-field gaps before
  posting to Grafana.

### Where the LLM is good (so the library should NOT replicate it)

- Choosing the right query for a typed metric
- Picking units, titles, groupings
- Applying RED/USE/golden-signals patterns
- Naming dashboards and panels
- Composition decisions ("what story should this dashboard tell?")

### Each expert's revised view

- **Grafana Expert:** "Z. The PromQL knowledge is already in any modern
  LLM. What's NOT in the LLM is Grafana Labs' specific opinions —
  those go in markdown resources."
- **LLM Expert:** "I was always Z. The LLM does narrative, naming,
  composition; we expose primitives and our explicit guidance."
- **MCP Expert:** "Z fits the protocol perfectly — resources are
  exactly for this. `grafana://guidance/red-method` reads like a
  prompt fragment the LLM weaves in."
- **TypeScript Expert:** "Z. Less code is less to break."
- **Doc Writer:** "Z elevates docs to first-class runtime artifacts.
  Markdown is the right format and the right home for evolving
  opinions."
- **Naysayer:** "Y is smallest; Z is small. Either is much better than
  X. What's the failing test that requires a rule engine? None."

### The "template" insight (user's framing)

> "They construct the query and specify the attributes, and we deliver
> the JSON panel."

This crystallizes the design: the **parameterized builder tools ARE
the templates**. The LLM brings the content (PromQL, title, unit,
groupings — informed by the guidance markdown); the library tools
bring the form (schema-valid Grafana JSON, sensible defaults,
determinism).

We don't need a separate "templates" abstraction layer. The MCP tools
*are* the templates — they accept attributes, they emit JSON. Anything
opinionated lives in the markdown the LLM reads before calling them.

### Decision

**Option Z is ratified.** Library = thin deterministic primitives that
double as parameterized templates; opinions = markdown in
`docs/guidance/` served via MCP resources.

### What changes from Entry 008

- **§1.8 of AGENTS.md** still holds (no runtime LLM in core), but the
  wording around "encoded as deterministic heuristics" is amended:
  intelligence is encoded as **deterministic primitives + textual
  guidance the runtime LLM reads**, not as rule code.
- **AGENTS.md §5 target repo layout** drops `src/inference/`,
  `src/composition/`, and `src/templates/`. Adds `docs/guidance/` and
  notes that those markdown files are also MCP-resource-served.
- **The v0 module shape** now is: `src/assets/` (builders),
  `src/ingest/` (parsers), `src/mcp/` (tools + resources),
  `src/validation/` (Zod schemas at boundaries) — and that's it.

### Concrete v0 scope under Z

**Code we will write:**
- `src/ingest/prometheus.ts` — exposition format parser. ~150–250 LOC.
- `src/assets/panel.ts` — `buildTimeseriesPanel({...})` and siblings as
  panel types accumulate.
- `src/mcp/resources.ts` — MCP resource handler that reads
  `docs/guidance/*.md` and serves them via `resources/list` and
  `resources/read`.

**Code we will NOT write:**
- ~~`src/inference/type.ts`~~ — LLM does it
- ~~`src/inference/unit.ts`~~ — LLM does it
- ~~`src/inference/query.ts`~~ — LLM does it
- ~~`src/composition/*`~~ — LLM does it
- ~~`src/templates/red.ts`~~, ~~`use.ts`~~, ~~`golden.ts`~~ — markdown instead

**Markdown we will write (incrementally, as demand surfaces):**
- `docs/guidance/counter-metrics.md` — counter conventions for PromQL.
- `docs/guidance/red-method.md` — RED for request services.
- `docs/guidance/use-method.md` — USE for resources.
- `docs/guidance/golden-signals.md` — four golden signals.
- `docs/guidance/naming.md` — title/description conventions.

Each is a short, opinion-bearing prompt-fragment the LLM can absorb.
We update them when our opinions change; no test fixtures to chase, no
rule code to maintain.

### MCP tools that result (sequenced; replaces Entry 010's middle of
the roadmap)

| # | Tool / Resource                    | What it does                                          |
| - | ---------------------------------- | ----------------------------------------------------- |
| 1 | `grafana_dashboard_build`          | Done in PR #3 (title only)                            |
| 2 | `prometheus_metric_parse`          | Parse exposition format → typed metric definitions   |
| 3 | `grafana_timeseries_panel_build`   | Build a timeseries panel from `{ title, expr, … }`    |
| 4 | `grafana_dashboard_build` (panels) | Extend with `panels[]` (Shape-3 JSON input)           |
| 5 | `grafana://guidance/*` resources   | Markdown opinions readable by the LLM                 |
| 6 | `grafana_alert_rule_build`         | Later                                                 |

### Concrete worked example for `http_requests_total`

End-to-end under Z (transcript-shape; see chat log for full version):

```
1. LLM lists + reads grafana://guidance/counter-metrics and red-method
2. LLM calls prometheus_metric_parse(<exposition text>)
   → [{ name: "http_requests_total", type: "counter", help: …, labels: {…} }]
3. LLM reasons: RED applies; Duration absent (no sibling histogram); do Rate + Errors
4. LLM calls grafana_timeseries_panel_build for each panel
5. LLM calls grafana_dashboard_build with the panels
6. LLM returns committable JSON to the user
```

Library does steps 2, 4, 5 (mechanical). LLM does steps 1, 3 (judgment).

### Open questions for next PRs

- **Parser scope for first PR.** OpenMetrics extensions (`# UNIT`, `# EOF`,
  exemplars) — defer. Histogram bucket grouping (`*_bucket`, `*_sum`,
  `*_count` collapse into one metric) — defer or include? Likely defer
  to a follow-up.
- **Parser dep or write-our-own?** Quick scan: `parse-prometheus-text-format`
  is old; `prom-client` doesn't expose its parser cleanly. Likely write
  our own (~200 LOC for the v0 subset). Naysayer-aligned.
- **Resource handler shape.** MCP resources can be static URIs or
  templated. v0: static `grafana://guidance/<filename>`. Templates
  later if useful.
- **Multi-target panels.** Grafana timeseries (and most other) panels
  accept an array of queries — e.g., rate(requests) and rate(errors) on
  the same chart, or counter rate alongside a sibling histogram's p95.
  `grafana_timeseries_panel_build` MUST therefore take `targets: [{ expr,
  legendFormat, refId?, ...}]` (or similar), not a single `expr`. Single
  query is the common case but the API has to accommodate many.
  Captured here so it isn't forgotten when the panel-builder tool lands.

### Verified sources

- Original Entry 008 ratification (this entry amends it)
- MCP Resources concept
  ([modelcontextprotocol.io/docs/concepts/resources](https://modelcontextprotocol.io/docs/concepts/resources))
- Prometheus exposition format spec
  ([prometheus.io/docs/instrumenting/exposition_formats](https://prometheus.io/docs/instrumenting/exposition_formats/))
- OpenMetrics spec
  ([openmetrics.io/](https://openmetrics.io/))

### Next research entries (planned)

- **Entry 014 — Foundation SDK coverage matrix.** Owner: Grafana Expert.
- **Entry 015 — Foundation SDK API ergonomics.** Owner: LLM Expert +
  TypeScript Expert.
- **Entry 016 — Transitive dependency license audit.** Owner: Naysayer.

---

## Entry 012 — Integration tests against real Grafana (architecture + license review)

**Date:** 2026-05-16.
**Owners:** Grafana Expert (architecture), Naysayer (license review).
**Triggered by:** Agent-team review (post-PR-23) surfacing the gap that no
generated dashboard JSON had ever been round-tripped through a real
Grafana instance. The Grafana Expert independently flagged that the
Foundation SDK 0.0.12 emits `schemaVersion: 42` (Grafana 13's number)
while we claim to target Grafana 12.4 (which uses `schemaVersion: 41`) —
without a real Grafana to import against, we could not say whether that
mattered.

### Architecture decision (ratified)

Integration tests boot a real `grafana/grafana:12.4.0` container via
**Testcontainers** (Apache 2.0, MIT-compatible per §1.7), POST our
generated dashboard JSON to `/api/dashboards/db`, and assert the
response. One container per test file, started in `beforeAll`, stopped
in `afterAll`. Unique dashboard UIDs per test prevent interference.

- **Run command:** `pnpm test:integration` (separate from `pnpm test`).
- **Lifecycle config:** `vitest.integration.config.ts` (separate from
  `vitest.config.ts`) — extended timeouts for cold-start, `fileParallelism:
  false` so the suite shares one container per file rather than spawning
  many.
- **Docker availability check:** the suite probes Docker at module load
  via `docker info` and *skips* with a console warning rather than
  failing if Docker is absent. Local devs without Docker still get a
  green `pnpm test`.
- **CI:** a new `integration` job in `.github/workflows/ci.yml`, Linux
  only (macOS/Windows GitHub runners don't ship Docker by default).
  **Required: blocks merge on failure** from day one — the suite was
  verified stable across three consecutive clean runs (8.5s / 8.0s /
  7.0s) before being promoted.

### License review (per AGENTS.md §1.7)

Grafana OSS is **AGPL-3.0**. AGENTS.md §1.7 forbids AGPL in *"runtime
code, generated output, or anything we redistribute"* but allows
copyleft for *"dev-only tooling (test runners, linters) ... each such
case is reviewed."*

**This is reviewed and approved as dev-only tooling.** Concrete
boundaries:

- Grafana runs in a **separate process** in a Docker container managed
  by Testcontainers — not linked, not imported, not bundled.
- The npm package we publish (`@jburgess/mcp-grafana`) contains **zero
  bytes** of Grafana source code or compiled output. `package.json`'s
  `files` field is `["dist", "README.md", "LICENSE", "CHANGELOG.md"]`;
  the integration tests live under `test/integration/` which is excluded.
- Test-time only — `grafana/grafana:12.4.0` is never pulled by a user
  installing `@jburgess/mcp-grafana`. It is only pulled by contributors
  running `pnpm test:integration` or by CI's integration job.
- Communication is over HTTP API only (Grafana's documented public
  surface). We don't depend on any Grafana internals.

Naysayer's standing concern about copyleft contamination is addressed:
no part of the AGPL-licensed artifact reaches our distribution.

### Findings from initial integration run

The first run surfaced one expected concern and confirmed two assumptions:

1. **schemaVersion: 42 (claimed Grafana 13) imports cleanly into Grafana
   12.4.** The Grafana Expert worried this might be rejected. Empirical
   result: status 200, success. Grafana 12.4 is forward-compatible on
   this field (or at least permissive). The drift is real but not a
   correctness blocker. Re-revisit if Grafana 12.x ever tightens.

2. **`buildTimeseriesPanel` output (no `id`) imports cleanly.** Grafana
   server-side auto-assigns when missing. We can keep the LLM's job
   simple by not requiring panel ids at build time.

3. **Round-trip operations all 200.** `buildDashboard`, `insertPanel`,
   `updatePanel`, `movePanel`, `removePanel` all produce JSON that
   Grafana 12.4 accepts. The Node Exporter Full fixture (141 panels,
   16 rows, mixed format, real production dashboard) imports cleanly
   both as-is and after each mutation operation.

4. **Negative case verifies suite teeth.** Posting a dashboard without
   a title returns 400 from Grafana; the suite catches this and
   `expect.toBe(400)`. If this stops failing, either Grafana's API
   changed or our post helper is masking errors — the test would alert.

### Verified sources

- Testcontainers (Apache 2.0): [testcontainers.com](https://testcontainers.com/)
- Grafana HTTP API ([POST /api/dashboards/db](https://grafana.com/docs/grafana/latest/developers/http_api/dashboard/#create--update-dashboard))
- Grafana OSS license confirmed AGPL-3.0 ([github.com/grafana/grafana/blob/main/LICENSE](https://github.com/grafana/grafana/blob/main/LICENSE))
- AGENTS.md §1.7 (permissive-licensing policy + dev-only-tooling exemption)
- AGENTS.md §3 (test categories — "Integration: import generated assets into a real Grafana instance (containerized) and assert they load. Gated behind a separate test command")

---

## Entry 013 — Panel style: sidecar skill vs in-tree opinion (ratified)

**Date:** 2026-05-16
**Researcher:** team (six-perspective debate per AGENTS.md §2)
**Decision:** **Ship `skills/grafana-style-guide.md` as a copyable reference
skill (frontmatter + prose + illustrative `StyleGuide` JSON). The
forthcoming `lintPanel(panel, styleGuide)` primitive and
`grafana_panel_lint` MCP tool require the caller to pass a
`StyleGuide` — no `defaultStyleGuide` export, no profile family, no
plugin API. A read-only MCP resource serves the skill file; no
filesystem-write tool.** User-ratified 2026-05-16.
**Triggered by:** the user's question — *"can we specify that time series
panels should have a table on the right with max / mean / last? or that
units should be `locale` or `short`?"*
**Question:** How (and where) does mcp-grafana ship opinion about panel
style — units, legends, thresholds, descriptions — given Entry 011's
ratified split between deterministic primitives (code) and textual
guidance (markdown served as MCP resources)?

### What was on the table

Panel style is a recognized concept in the Grafana ecosystem (see
`kubernetes-mixin`, `monitoring-mixins`, and Grafana Labs' own
Mimir / Loki / Tempo reference dashboards) but there is no single
canonical encoding of it. Different teams converge on different in-house
conventions for unit codes, legend rendering, threshold colors, and
required descriptions.

The user's two motivating examples were checkable Grafana panel
properties:

1. `options.legend = { displayMode: 'table', placement: 'right', calcs: ['max', 'mean', 'lastNotNull'] }` — a structural shape.
2. `fieldConfig.defaults.unit` membership in an allow-list (`short`,
   `reqps`, etc.) and exclusion of others (`locale`, `none`).

Both are checkable from the panel JSON alone; both are *opinion*, not
schema-validity.

### The six-perspective debate

A subagent per AGENTS.md §2 perspective produced a short
recommendation; the synthesis below records the convergence and the
single substantive disagreement.

| Perspective | Position |
|---|---|
| **Grafana Expert** | One profile (`default`) only. Veto on shipping `red-method` / `use-method` / `golden-signals` as lint profiles — those are *methodology*, not rendering style; conflating them misleads LLM callers. Grafana v12 `legend.calcs` reducer IDs (`lastNotNull`, `mean`, `max`) are stable since v9 and correct for our target. Every panel-style rule is a "should", not a "must" — Grafana renders defaults silently; only structural rules (id presence, gridPos shape) are "must" and they live in `validate.ts` already. |
| **TypeScript Expert** | `lintPanel(panel, styleGuide: StyleGuide)` with profiles exported as plain const objects (option C of A–E). Tree-shakeable; `LintIssue { path, ruleId, severity, message }` separate from `ValidationResult` so severity isn't lost. Veto on plugin `defineRule` API (option E): defeats serialization and declarative diffing for no concrete demand. |
| **MCP Expert** | Resource-first with a soft tool. Skill served as `mcp://grafana/skills/...md` (read-only); `grafana_panel_lint(panel, styleGuide?)` returns `{ violations[] }`. No stateful setter, no auto-apply inside `*_build`. Veto on `grafana_style_guide_set` as a stateful call. |
| **LLM Expert** | Operator picks the profile at config time, not the model per-call; warnings (not errors) for violations; `red-method` / `use-method` / `golden-signals` are names the model recognizes from training. Veto on required `styleGuide` arg on every panel-build call. |
| **Naysayer** | Kill the proposal as scoped — Entry 011 (ratified the day before) explicitly rejected encoding heuristic rules in TS. Smallest defensible version: one markdown file in `docs/guidance/`. Revisit only when a second user with conflicting taste appears. |
| (Doc Writer not separately convened — the proposal is doc-shaped throughout.) | |

### Convergence (5-of-5)

- **One profile, not a family.** Reject named methodology profiles
  (`red-method` etc.) as lint surface.
- **No statefulness, no required tool arg.** No `_set` call; no
  required `styleGuide:` arg on per-call build tools.
- **Warnings, never errors; never auto-fix.** Style ≠ schema-validity.
- **Markdown is the primary medium for *why*; code is the medium for
  *check*.**

### The one substantive disagreement

Naysayer wanted the proposal killed entirely under §1.8 (Entry 011) on
the grounds that "encoding heuristic rules in TS duplicates LLM
training." The hole in that argument: checking
`panel.options.legend.placement === 'right'` is a deterministic
structural check over a panel JSON shape, exactly like the existing
`validate.ts` work. The *opinion* (right vs bottom) lives in
markdown; the *check* lives in code. That split is what §1.8 ratifies,
not what it forbids. The lint primitive is acceptable; what would
violate §1.8 is bundling an opinion *as code*. Hence the rule: no
`defaultStyleGuide` constant, no profile family, no `defineRule`
plugin — the lint primitive accepts a `StyleGuide` arg and has no
fallback.

### The further user reframing (and where it landed)

After the initial team verdict, two follow-up rounds with the user
narrowed the surface area further:

1. **Sidecar repo vs same repo.** Initial recommendation was a separate
   sidecar repo so the skill could release independently and avoid
   opinion lock-in. User pushed back: "I think it should be in the
   same repo" — but asked about scaffolding the skill out to a user's
   filesystem from the MCP server. The scaffolding pattern has strong
   non-MCP precedent (`create-react-app`, `eslint --init`,
   `rustup component add`, the Cursor `.cursorrules` ecosystem), no
   MCP-specific precedent yet, but is coherent if framed as a
   starter the user owns after install.
2. **Drop the install tool.** User then identified that
   `grafana_skill_install` is intrusive (filesystem write through MCP
   is a permission cliff; fails in sandboxed environments) and
   client-coupled (hard-codes `~/.claude/skills/`). The cleaner shape:
   the MCP server delivers content (read-only resource) but does not
   install; users move bits with their own tools (`cp`, `@`-include,
   paste).

### Decision

User-ratified 2026-05-16. The full ratified shape:

- `skills/grafana-style-guide.md` ships in this repo as a copyable reference
  skill (frontmatter + prose + illustrative `StyleGuide` JSON).
  Modeled on kubernetes-mixin and the monitoring-mixins corpus.
- `lintPanel(panel, styleGuide)` library primitive and
  `grafana_panel_lint` MCP tool are forthcoming; both require the
  caller to pass a `StyleGuide`. No `defaultStyleGuide` export.
- Read-only MCP resource at `mcp://grafana/skills/grafana-style-guide.md`
  serves the skill file for runtime fetch. No filesystem-write tool.
- README documents per-client on-ramps (`cp` for Claude Code,
  `@`-include for Cursor, paste-into-prompt for generic clients).
- `AGENTS.md` §1.8 + §5 list both delivery modes for markdown
  guidance: `docs/guidance/*.md` for project-authored guidance and
  `skills/*.md` for user-installable shareable opinions. Both are
  markdown; the distinction is delivery mode.

### Rejected alternatives (so we don't go back)

Each of the following came up during the debate or the user reframings
and was rejected. If a future PR proposes any of them, this entry is
the document to cite.

- **`grafana_skill_install` tool** — rejected on portability
  (hard-codes Claude Code's `~/.claude/skills/` and fails for Cursor
  / generic MCP clients) and on MCP design grounds (filesystem-write
  through MCP is a permission cliff and fails in sandboxed
  environments). The MCP server delivers content via read-only
  resource; users move bits with their own tools.
- **Named profile family** (`red-method`, `use-method`,
  `golden-signals`) — Grafana Expert veto: methodology, not rendering
  style. Conflating the two would mislead LLM callers into thinking
  that selecting one configures their SLO posture. Methodology
  recipes live as prose inside the skill, not as lint-profile names.
- **Plugin `defineRule` API** — rejected per AGENTS.md §2.6 as
  premature abstraction with no concrete consumer demanding it. The
  `StyleGuide` JSON shape is data-driven; rule kinds grow by
  extending the schema, not by accepting user-supplied rule functions.
- **`defaultStyleGuide` exported constant** — every exported default
  becomes the implicit standard and pre-1.0 API surface. The skill
  file *is* the project's reference instance; it travels as content,
  not as code. The lint primitive has no fallback — the caller passes
  a `StyleGuide` or the call errors.
- **Bundled `docs/guidance/panel-style.md`** (pre-skill framing) —
  still locks every user into one bundled default; release velocity
  of the opinion coupled to mcp-grafana releases. The skill is the
  same content with the framing changed to "starter the user owns".
- **Sidecar repo / separate npm package** — too much friction for a
  shareable markdown file; users have to find, install, and configure
  a second thing. The skill lives in this repo with the explicit
  framing that copies are user-owned.
- **Stateful `grafana_style_guide_set` MCP call** — MCP Expert veto:
  hidden server state across tool invocations is invisible to the
  model on resume, breaks parallel calls, and couples us to a
  transport assumption (single long-lived session). Style guide
  passes per-call as data, not as session state.
- **Required `styleGuide:` arg on `grafana_timeseries_panel_build`
  and other build tools** — LLM Expert veto: the model will forget;
  pushes config-time policy into per-call tribal knowledge. Lint and
  build stay separate per AGENTS.md §1.6.
- **Auto-rejection or auto-fix of style violations during build** —
  rejected per LLM Expert and MCP Expert: style is opinion, never
  `error`. Lint returns `warn` / `info` severity issues; the LLM
  decides whether to fix.

### Consequences

- mcp-grafana stays opinion-free in its lint surface. No bundled
  default profile; the skill is the only place an opinion lives.
- Users who disagree fork the skill. There is no profile selection
  mechanism in the project.
- The `StyleGuide` schema is API surface mcp-grafana owns forever.
  Keep it small and additive; rule identifiers grow by addition only.
- The skill living in the same repo couples its release cadence to
  mcp-grafana. Acceptable as long as the skill is framed as a starter,
  not a managed artifact. If a second team with conflicting taste
  appears, the right answer is they fork the skill — not that the
  project grows a profile mechanism.
- Cross-client portability is preserved because the skill is just
  markdown. Claude Code consumes it as a skill; Cursor as a rule;
  generic MCP clients as a resource or paste-into-prompt content.

### Agent acceptance

- **Grafana Expert** — accepts; vetoed methodology profiles (kept out).
  `legend.calcs` reducer IDs are stable since Grafana v9 and correct
  for the v12 target.
- **TypeScript Expert** — accepts; `StyleGuide` stays data-driven,
  `LintIssue` separate from `ValidationError` to preserve severity.
- **MCP Expert** — accepts; read-only resource + soft tool, no
  stateful setter, no install tool, no per-call required arg on
  build tools.
- **LLM Expert** — accepts; skill frontmatter triggers the model;
  warnings (not errors) preserve agency.
- **Senior Doc Writer** — accepts; skill is documentation the model
  consumes at runtime; same content across clients with no
  client-specific markup.
- **Naysayer** — accepts the docs-only landing. The skill itself is
  prose, not code, and adds zero runtime surface. Implementation work
  deferred until a failing test justifies each piece (correct TDD
  posture per §3). Standing veto on the rejected alternatives above.

### Naming and scope (second debate, post-ratification)

After the initial ratification, the user raised that the skill's
working name (`grafana-panel-style`, file `skills/panel-style.md`) was
too generic and proposed `grafana-style-guide` to keep the scope open.
Six perspectives weighed in.

| Perspective | Position |
|---|---|
| **Grafana Expert** | Accept the broader name *if and only if* the body declares scope explicitly. Grafana lexicon prefers "conventions" or "best practices" over "style guide," but the latter is industry-generic enough that the LLM routes correctly. Conflict risk with Grafana Labs' Saga design system + `writers-toolkit` docs style guide is nonzero but mitigated by frontmatter `description`. Veto: shipping a broad name with panel-only content and no in-file scope declaration. |
| **TypeScript Expert** | Accept; rename the API surface to match. `GrafanaStyleGuide` (umbrella) with `PanelStyleGuide` (slice). `lintPanel(panel, guide: PanelStyleGuide)` takes the narrow slice. Veto: shipping a bare `StyleGuide` export — collides with Storybook / ESLint vocabulary and erases the Grafana domain at the import site. |
| **MCP Expert** | Drop the redundant `grafana-` prefix from the file path; `mcp://grafana/skills/grafana-style-guide.md` stutters under the `grafana/` URI authority. Tools need disambiguators (flat namespace); resources don't (hierarchical). Veto: keeping `grafana-` on the file when it's already in the URI authority. |
| **LLM Expert** | Accept the broad name; over-load is the cheap failure mode (a skill in context for an irrelevant task costs tokens; under-load on a relevant task silently ships unstyled output). Modern selectors are description-dominant; name is mostly a slug. Veto: keeping a narrow name (`*-panel-style`) while broadening scope later — the selector skips it on dashboard tasks. |
| **Senior Doc Writer** | Accept; broad first name is coherent if siblings are scoped narrowly (`grafana-alert-rules`, `grafana-promql-recipes`). README section retitles "Grafana style skill"; on-ramp prose acknowledges current scope. Veto: shipping the rename without updating the README body — name advertises breadth, content delivers panel rules, reader bounces. |
| **Naysayer** | **Full veto on the rename.** "Keeps it open" is YAGNI's tell — naming a container for vapor. Honesty: reader opens `grafana-style-guide`, expects variable / alert / layout conventions, finds panel rules only — misled. Kitchen-sink risk: broad names are gravity wells for "while we're at it" additions. Smallest viable position: keep `grafana-panel-style`. |

### Naming and scope: resolution

The MCP Expert's prefix-strip veto and the user's later instruction
"the rule filename must match the frontmatter `name` value" together
settle the path: **file = `skills/grafana-style-guide.md`, frontmatter
`name: grafana-style-guide`**, file-and-frontmatter parity wins over
URI brevity.

The Naysayer's veto is honored by **adopting the scope-honesty
concessions** that four of the other five agents required as their
condition of acceptance:

- The skill body opens with an explicit `## Scope` section declaring
  v0.1 = panels (units / legends / thresholds / titles / descriptions),
  with dashboards / alert rules / recording rules / folder taxonomy
  listed as not-yet-covered.
- The README section is retitled "Grafana style skill" and the on-ramp
  prose acknowledges current scope.
- The frontmatter `description` names panels as the current trigger so
  the selector doesn't over-fire on pure-dashboard tasks before
  dashboard content exists.

Type-system implications captured for issue #25: the exported root
type becomes `GrafanaStyleGuide` (umbrella, namespaced `{ panels,
units, descriptions, ... }`), with `PanelStyleGuide` as the slice
`lintPanel` consumes. No bare `StyleGuide` export. Schema JSON keeps
its current shape (`panels.timeseries.*` already half-namespaced)
since lifting `units` to a peer of `panels` is already the natural fit.

The MCP resource-URI policy that codifies the file-and-frontmatter
parity decided above — and the parallel rule for `docs/guidance/*.md`
— now lives in
[`docs/conventions/mcp-resource-uris.md`](./docs/conventions/mcp-resource-uris.md)
(per issue #29). Future skill or guidance authors should consult that
document rather than re-deriving the convention from this entry's
discussion. The working glossary distinguishing **skill** / **style
guide** / **style skill** / **guidance** is in
[`docs/glossary.md`](./docs/glossary.md) (per issue #30).

The Naysayer's standing concerns about kitchen-sink scope creep
remain on the record. If a future addition to the skill body falls
outside the declared Scope section's planned areas, this entry is
the place to revisit whether the rename was right.

### Process gate for future skill content (Naysayer-mandated)

Before any non-panel content lands in `skills/grafana-style-guide.md`,
the contributor must edit the `## Scope` section **in the same PR** —
promote the area from "not yet covered" to a declared sub-scope, and
broaden the frontmatter `description` trigger to match. If those two
edits don't appear in the diff, the PR is presumptive scope creep and
this subsection is the citation. Recorded as the Naysayer's standing
veto on the rename; surfaced here so it doesn't live only in a PR-review
transcript.

### Where the LLM is bad / good (Entry 011 re-applied)

This decision is consistent with the same boundary Entry 011 drew:

- **The LLM is *good* at**: applying a panel-style opinion to a
  specific PromQL expression, especially the conditional rules
  ("bounded cardinality → table-right; unbounded → hidden") that
  depend on inferring properties of the query the lint primitive
  cannot derive from the panel JSON alone. The skill prose lives here.
- **The lint primitive is *good* at**: catching the unconditional
  structural rules ("if `displayMode: 'table'` then `calcs` must
  include at least one reducer", "`unit` must be from the allow-list,
  not `locale`"). Deterministic, mechanical, regression-protected by
  unit tests.

### Open questions for the implementation PR(s)

- **`StyleGuide` schema URL.** ADR uses `https://mcp-grafana.dev/style-guide.v1.json` as a placeholder. Will we actually host that schema? If not, document the schema in-repo under `docs/schemas/` and have the `$schema` field point to a stable repo path or just be a version tag.
- **Rule identifier namespace.** Initial set: `legend.placement`, `legend.displayMode`, `legend.calcs`, `unit.allowList`, `unit.deny`, `descriptions.required`. Per panel-type scoping (the skill's `panels.timeseries.*` block) is the proposed shape; finalize when the lint primitive lands.
- **MCP resource handler.** Entry 011's `src/mcp/resources.ts` is itself unbuilt. The style-skill resource will be the *first* user of that handler. The handler should be generic enough to also serve future `docs/guidance/*.md` files.
- **`LintIssue` vs `ValidationError` reuse vs duplication.** TypeScript Expert recommended a separate type to preserve severity. Confirm in the implementation PR.

### Open-questions resolution (settled in PR #35 — issue #25)

Three of the four open questions above landed; one stays deferred.

- **Rule identifier namespace** — **resolved**: JSONPath-style dotted paths into the umbrella, with units / descriptions nested under `panels` rather than as umbrella siblings so the `PanelStyleGuide` slice contains everything `lintPanel` needs. Initial rule ids: `panels.units.allowList`, `panels.units.deny`, `panels.descriptions.required`, `panels.timeseries.legend.placement`, `panels.timeseries.legend.displayMode`, `panels.timeseries.legend.calcs` (order-sensitive). Namespace is additive — future panel types (stat, table, gauge, heatmap) and cross-type families grow by addition. The skill JSON was restructured to match (pre-release; flagged as illustrative in v0).
- **MCP resource handler** — **resolved**: `src/mcp/resources.ts` exports `registerMarkdownResources(server)` which walks `skills/*.md` and `docs/guidance/*.md`, registering each as a read-only resource at the URI shape from `docs/conventions/mcp-resource-uris.md`. Content is loaded fresh per request (no cache) so a skill edit reflects without a server restart. Missing directories tolerated silently. Per AGENTS.md §1.8 there is no companion write tool.
- **`LintIssue` vs `ValidationError`** — **resolved**: distinct types. `LintIssue` carries a `severity: 'warn' | 'info'` literal-union (never `error`) plus a `ruleId` field; `ValidationError` has only `path` and `message`. Conflating them would have lost the severity axis the two domains carry. The TypeScript Expert's recommendation held.
- **`StyleGuide` schema URL** — **deferred**: the placeholder `https://mcp-grafana.dev/style-guide.v1.json` does not resolve and was removed from the skill JSON. Revisit when there's a concrete hosting decision (project domain, GitHub-raw URL on `main`, in-repo `docs/schemas/` path, or a bare version tag). Until then, the `GrafanaStyleGuide.$schema` field stays optional and the skill ships without it.

### Verified sources

- kubernetes-mixin ([github.com/kubernetes-monitoring/kubernetes-mixin](https://github.com/kubernetes-monitoring/kubernetes-mixin)) — Apache-2.0, de facto Grafana style for production Kubernetes observability.
- monitoring-mixins directory ([monitoring.mixins.dev](https://monitoring.mixins.dev/)) — corpus of mixins from many projects.
- Anthropic Agent Skills format — markdown with YAML frontmatter
  (`name`, `description`).
- Precedent for "package ships a copyable artifact":
  `create-react-app` / `npm init <template>`, `eslint --init`,
  `rustup component add`, Cursor `.cursorrules` ecosystem.
- AGENTS.md §1.8 (Entry 011's reframing); §1.6 (small composable
  builders); §2.6 (Naysayer's veto on premature abstraction).

### Future ADR

`docs/adr/0013-grafana-style-guide-as-sidecar-skill.md` — not yet written. As
with Entries 005–012, ratification lives in this entry; the ADR file
will follow the project's general ADR backlog (no ADRs exist in
`docs/adr/` yet — see Entry 001's note on `0001-typed-substrate.md`).

---

## Entry 014 — Dashboard-level lint: thin aggregator over `lintPanel` (ratified)

**Date:** 2026-05-17. **Status:** ratified, shipped in PR #36.

Issue #31 item 1 originally proposed `grafana_dashboard_lint(dashboard)`
as a tool with a hardcoded rule catalogue: `title-query-mismatch`,
`hidden-but-referenced`, `unit-mismatch`, `missing-description`,
`naming-inconsistency`, `single-step-threshold`, `empty-default-value`,
`duplicate-title`. The team review on the parent issue (Grafana+TS,
MCP+LLM, Doc Writer+Naysayer, run before any of #31 shipped) reshaped
this to a thin aggregator constraint: walk panels, call `lintPanel`
per panel, add only those dashboard-level rules that are
**structural and deterministic** — heuristic / taste-laden rules stay
in the skill's prose.

This entry records the reshape decision so a future contributor opening
the original #31 item #1 doesn't re-derive it from PR comments.

### What landed (PR #36)

Three dashboard-level rules, all structural:

1. **`dashboards.panels.duplicateTitles`** — counts non-row panel
   titles. Excludes rows (section markers; share titles legitimately)
   AND `repeat:`-using panels (Grafana's repeat creates N runtime
   copies sharing the source title by design).
2. **`dashboards.variables.hiddenButReferenced`** — variable with
   `hide: 2` interpolated in a panel or row title. Recognises all
   four Grafana interpolation syntaxes (matches `rename.ts` and
   `validate.ts`'s regex precedent). Tolerates string-form `hide: "2"`
   (some round-trips coerce). Path is indexed form
   `templating.list[N].hide` (consistent with sibling rules).
3. **`dashboards.variables.emptyDefault`** — `query` /
   `datasource` / `interval` variables only. Other types
   (`custom`, `constant`, `textbox`, `adhoc`) exempt — empty is
   legitimate for them.

Type addition: `DashboardStyleGuide` under
`GrafanaStyleGuide.dashboards`. Each rule is an opt-in `boolean` flag.

Plus a `lintPanel` behavior change: skip row panels for
`panels.descriptions.required` (rows are section markers, not
visualizations; matches `inspectDashboard`'s existing
`panelsMissingDescription` convention).

### What was cut (with reasoning)

The four taste-laden rules from the original #31 wishlist:

- **`title-query-mismatch`** — semantic comparison of panel title
  against query. Pure taste; an LLM with the skill prose can do this
  more reliably than a code rule.
- **`unit-mismatch`** — heuristic like "`rate(*_total)` → `reqps`".
  §1.8 territory (encoding LLM-knowable taste); also covered by
  #31 item 10's `panels_find` + a `docs/guidance/units.md` (planned).
- **`naming-inconsistency`** — flagging `role_nchf` against ten
  camelCase siblings is a one-off judgement, not a rule. The
  variable rename tool (PR #33) is the cure; the lint rule would
  fire on every legitimately-snake_cased Grafana convention.
- **`single-step-threshold`** — "threshold has only one user-defined
  step" is taste, not a defect — single-step is right for boolean
  metrics, wrong for percent. The skill prose says when to use what;
  encoding it as a fire-or-not rule loses that nuance.

All four cuts cite AGENTS.md §1.8 (the no-heuristic-rules-in-code
principle, Entry 011's revised stance).

### Architectural shape

```
GrafanaStyleGuide (umbrella)
├── panels: PanelStyleGuide
│     ├── timeseries: TimeseriesPanelStyle
│     ├── units:      UnitStyleGuide
│     └── descriptions: DescriptionStyleGuide
└── dashboards: DashboardStyleGuide          ← Entry 014 added this
      ├── panels:    { duplicateTitles? }
      └── variables: { hiddenButReferenced?, emptyDefault? }
```

`lintPanel(panel, guide.panels)` and `lintDashboard(dashboard, guide)`
share the same `LintResult` shape. The aggregator rebases
`lintPanel`'s `$`-rooted paths onto `panels[N].*` so consumers can
group issues by panel. Per-panel-level issues come first in the
result list, then dashboard-level issues — stable ordering so a
consumer can iterate without surprises.

### Open questions deferred

- **Per-rule severity configurability.** Current rules hardcode
  severity (`info` for `duplicateTitles` / `emptyDefault`; `warn` for
  `hiddenButReferenced`). A future revision may let the skill set
  severity per rule — e.g. a team that treats duplicate titles as a
  shipping blocker. Not in v0; trivial to add when need is shown.
- **`duplicateTitles: { except: string[] }` escape hatch.** A
  dashboard with intentional shared titles (e.g. "CPU" per cluster)
  has no opt-out today other than disabling the whole rule. Same
  story — add when need is shown; pre-1.0 surface, non-breaking to
  extend later.
- **More dashboard-level rules.** Candidates that fit the structural
  bar: orphan-row detection (row with no panels under it),
  unreferenced-variable detection (variable in `templating.list` but
  never interpolated). Not in v0 — surface them as separate proposals
  with the same §1.8 test.

### Consequences

- The lint primitive's rule namespace is officially additive across
  both panel and dashboard scopes. Future panel types (`stat`,
  `table`, `gauge`, `heatmap`) and future cross-cutting rule families
  slot in by addition.
- The `skills/grafana-style-guide.md` JSON block now includes a
  `dashboards` section. The skill body's `## Scope` section was
  updated to acknowledge that dashboard-level *structural* rules are
  covered in v0.1, with prose guidance still TODO.
- The cuts (4 of 8 originally-proposed rules) are documented above
  rather than disappearing — future contributors who think
  "shouldn't we add a `title-query-mismatch` rule?" find the reasoning
  here, not in a PR description.


---

## Entry 015 — `panel_update_bulk` cut in favor of compose-existing-primitives (ratified)

**Date:** 2026-05-17. **Status:** ratified, shipped in the PR that
adds `docs/guidance/bulk-panel-updates.md`.

Issue #31 item 3 proposed `grafana_dashboard_panel_update_bulk`
("one call, one validation") as the last actionable item on the #31
umbrella. Three parallel design proposals ran from team perspectives
(Grafana+MCP, TS+LLM, Doc Writer+Naysayer). The Naysayer recommended
**cut**; the user concurred. This entry records why, the steelman of
the would-have-been design, and what shipped in its place.

### What the three proposals converged on

All three agreed on the shape *if* the tool shipped:
- Single-form patch entry `{panelId, patch}[]` (no
  `{panelIds[], patch}` or `{filter, patch}` discriminated union).
- Per-patch outcomes keyed by both `index` AND `panelId`.
- `MAX_PATCHES` cap (100–200 — divergent on the exact number).
- No auto-validate post-pass (caller composes `validateDashboard`).
- Reject patches that modify `panel.id` (would break the lookup of
  subsequent patches in the same batch).

### Where they diverged

- **Atomicity.** Grafana+MCP: `mode: 'atomic' | 'best-effort'`,
  default atomic. TS+LLM: atomic-only with a discriminated-union
  result for TS narrowing. Naysayer: best-effort is the natural
  shape — and best-effort is the loop the caller already writes.
- **Existence.** Grafana+MCP and TS+LLM both proposed the tool.
  Naysayer recommended cut.

### Why the cut won

Four reasons, in descending order of weight:

1. **Atomicity is wrong for the use case.** The motivating
   workflow from #31 is independent panel-level fixes — add a
   description, change a unit. All-or-nothing rollback when 2 of
   19 patches fail forces the LLM to re-issue the 17 valid
   patches anyway, *with worse error attribution*. Best-effort
   per-panel is closer to the workflow's nature — and best-effort
   per-panel is just the loop the caller writes.
2. **Tool-call cost is mostly self-imposed taste.** 76 sequential
   `panel_update` calls cost ~75ms of CPU server-side over stdio.
   Token overhead for tool-call envelopes is ~50 × 76 ≈ 4k
   tokens — real but modest. The "76 visible tool calls clutter
   the conversation UI" critique is a UX issue, not an API one.
3. **Failure attribution is better per-call.** "Panel 638 not
   found" said once is clearer than "patch[7] failed: panel 638
   not found" embedded in a 76-element outcomes array.
4. **§1.6 small composable builders.** `panel_find` +
   `panel_update` + `validateDashboard` already compose into the
   workflow. Adding a fourth tool for the compose-them-yourself
   case would dilute the family.

### Steelman of the would-have-been design (preserved)

- `findPanels` was built specifically as the precursor; PR #38
  shipped with README/CHANGELOG framing that named the bulk tool as
  "forthcoming." Cutting the tool means the README must change to
  point at the guidance doc instead — done in the same PR.
- The closed filter DSL choice in `findPanels` was justified partly
  by the pipeline. Pulling the second half could be read as
  over-design in retrospect; but the find primitive is independently
  useful (visualizing the panel surface, scripting client-side
  follow-ups other than bulk update). Not orphaned.
- One tool call where the LLM enumerates `[{panelId, patch}, ...]`
  reads more clearly in the transcript as a single audited intent
  than 76 sequential mutations. A real ergonomic loss for the
  transcript reader, accepted as the cost of the cut. Guidance doc
  partially recovers this by giving the model a script template that
  reads as one logical step.

### What shipped instead

`docs/guidance/bulk-panel-updates.md` — explains the
`panel_find` → loop `panel_update` → `validateDashboard` pattern with
a worked example (the 19-unit fix from the #31 session that motivated
the bulk proposal). Served as a read-only MCP resource at
`mcp://grafana/docs/guidance/bulk-panel-updates.md` via the existing
markdown-resource handler from PR #35. **First file under
`docs/guidance/`** — validates the "missing directories tolerated
silently, light up automatically when a file lands" contract that PR
#35 deliberately built into the handler.

### Revisit trigger (Naysayer-mandated)

If telemetry from real LLM sessions shows the loop's overhead is
moving the needle on completion rate or user satisfaction, file a
follow-up issue with the data and the cut will be revisited with
that data. Until then: the guidance doc is the answer. The
revisit-with-data discipline matches Entry 011's standing instruction
("pick the smallest answer that lets the next test pass").

### Consequences

- Tool count stays at 14 (was going to bump to 15).
- Issue #31 closes after this PR — every item is shipped (#1, #2,
  #7, #10, #11, #12), cut (#3, #4, #5, #6), or deferred (#8, #9,
  #13, #14) with citation. Per AGENTS.md §6.1 the umbrella closes
  with a final summary comment.
- The first `docs/guidance/*.md` file establishes the path that
  future project-authored guidance (RED-method, USE-method, naming
  conventions, units suggestion patterns deferred from #4, etc.)
  will follow.
- `findPanels`'s framing in README and CHANGELOG was updated to
  point at the guidance doc rather than the cut tool.


---

## Entry 016 — `dashboards.layout.firstRowCategorical`: DEFER dissolved by mandatory tag scoping (ratified)

**Date:** 2026-05-23. **Status:** ratified, shipped.

Issue #54 (`firstRowCategorical` — "the overview dashboard fold should
lead with categorical health, not a wall of numbers") sat in
long-running DEFER. The blocker was never the detection — sorting the
top-level panels by `gridPos.y` and classifying the top band is purely
mechanical — but the *prescription*: there is no structural "this is an
overview dashboard" signal in Grafana JSON, so a global rule would fire
on drill-down / per-pod / per-component dashboards that legitimately
open with timeseries (Grafana Labs' own Mimir writes/reads dashboards
are exactly such drill-downs). The issue's own escalation policy said
to CUT if two more lint cycles shipped without one of three unblock
criteria landing — and several had (#76, #77, #79, #83).

This entry records why we reshaped-and-shipped rather than cut, and the
shape that dissolved the blocker.

### The decision

The three "unblock criteria" in the issue were not mutually exclusive,
and the cheapest defensible combination was overlooked: **make scoping
mandatory and explicit, keyed on the native Grafana `tags[]` field.**

- Criterion 2 (a tag signal in dashboard JSON) and criterion 3 (an
  opt-in flag) collapse into one config: `firstRowCategorical?:
  boolean | { overviewTag?: string }`. `{ overviewTag: "overview" }`
  fires only on dashboards carrying the tag; bare `true` fires on every
  dashboard (for a style-guide copy governing an overview-only folder).
- `tags` is a *real structural signal* — a native field, set
  per-dashboard, surviving JSON round-trips — unlike free-form title
  text (the TS/MCP DEFER camp's correct objection to a title-regex
  scope). This is why the type does **not** offer a `titlePattern` form.
- The matching convention ("tag overview dashboards `overview`") landed
  in `skills/grafana-style-guide.md` in the same change — both the
  `## Dashboards` row-sequence section and the rule's own prose — so
  the signal the rule keys on has a documented home, satisfying the
  "no rule without a convention" half of the DEFER argument.

This is the same reshape move Entry 014 / issue #56 record: when a
DEFER blocker is dissolvable by changing rule *shape* rather than
waiting for an external event, the issue is shippable now.

### Why not CUT (the escalation policy's nominal verdict)

The escalation policy existed to stop "ship a boolean nobody turns on."
Mandatory tag scoping is the opposite: the rule is inert until a team
adopts the `overview` tag convention, at which point it enforces the
skill's single most important dashboard rule on exactly the dashboards
it should — and the detection primitive (`panelGridPos`, the row band)
already existed. Cutting would have discarded correct, cheap, already-
buildable logic that catches the guide's flagship anti-pattern.

### What shipped

- `DashboardStyleGuide.layout.firstRowCategorical` and
  `checkFirstRowCategorical` in `src/assets/lint.ts`. Detection: among
  top-level non-row panels with a `gridPos`, take the minimum-`y` band;
  fire `warn` when it has ≥1 numeric/graph panel (`stat`, `gauge`,
  `timeseries`, `barchart`, `bargauge`) and 0 categorical-health panel
  (`state-timeline`, `alertlist`). A fold with categorical health
  passes; a text-only header fold (no numeric/graph panel) does not
  fire; panels without a `gridPos` and legacy nested `row.panels[]`
  children are out of scope (the fold is a top-level positioned
  concept).
- Skill: tag convention added; issue #54 moved out of the
  "What is *not* machine-checked yet" list; JSON example extended with
  the `layout` block.
- Detection-only — the recommended fix
  (`grafana_state_timeline_panel_build` + an alertlist on row 1) is the
  author's / LLM's to apply.

### Out of scope (still skill prose only)

The unscoped row-sequence judgement (row 2 = RED/USE, rows 3..N =
pipeline-ordered decomposition) and multi-timescale strips remain
review-checklist items — they have no per-dashboard opt-in signal and
no mechanical composition test.
