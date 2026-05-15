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

- **Entry 004 — Foundation SDK coverage matrix.** Owner: Grafana Expert.
- **Entry 005 — Foundation SDK API ergonomics** (hands-on; what an LLM
  stumbles on). Owner: LLM Expert + TypeScript Expert.
- **Entry 006 — Runtime validation choice** (Zod v4 vs Valibot vs ArkType;
  Standard-Schema compatible). Owner: TypeScript Expert.
- **Entry 007 — Transitive dependency license audit** for Vitest +
  `@grafana/grafana-foundation-sdk` + `@modelcontextprotocol/sdk`
  together. Owner: Naysayer.
