# AGENTS.md

This project is a TypeScript library and CLI for generating **Grafana assets** —
dashboards, panels, alert rules, contact points, notification policies, data
sources, folders, and library elements — as code. Assets are produced as
validated JSON that targets Grafana's HTTP API and provisioning format.

The codebase is built by a small team of specialized agents under a strict
**test-driven** and **doc-first** discipline. This file is the contract between
those agents and the humans (or other agents) reading the repo.

---

## 1. Project Principles

1. **TDD is non-negotiable.** No production code is written without a failing
   test that justifies it. Red → Green → Refactor. If you cannot write the
   test, you do not yet understand the requirement.
2. **Docs travel with code.** Every public API, schema, and CLI surface ships
   with documentation in the same PR. Docs that drift are bugs.
3. **Schema-first.** Grafana asset shapes are described as TypeScript types
   derived from (or validated against) the official Grafana schemas. We never
   hand-roll JSON without a typed builder behind it.
4. **Deterministic output.** Given the same inputs, generated assets must be
   byte-identical. No timestamps, no random IDs, no map-iteration ordering
   leaking into output.
5. **No silent failures.** Validation errors are raised at build time with
   actionable messages pointing at the offending input.
6. **Small, composable builders.** Prefer narrow functions that produce one
   thing well over a god-builder with fifty options.
7. **Permissive licensing throughout.** This project is distributed under
   the **MIT License** (ratified 2026-05-15; see `research.md` Entry 005).
   Every dependency, vendored schema, generated artifact, and code-gen
   template must be compatible with that license.

   **Hard rule: no introduced dependency may be less permissive than
   Apache 2.0.** This is the ceiling. The Naysayer (§2.6) has standing
   veto on any change that crosses it.

   - **Allowed for runtime deps (anything we ship):** 0BSD, MIT, ISC,
     BSD-2-Clause, BSD-3-Clause, Apache-2.0.
   - **Disallowed for runtime deps** (anything more restrictive than
     Apache 2.0): MPL (any version, file-level copyleft), LGPL (weak
     copyleft), GPL (strong copyleft), AGPL (strong copyleft + network
     clause), SSPL, BUSL, Commons Clause, and any "source-available"
     licenses.

   **Grafana core specifically.** Grafana OSS is AGPL-3.0 and must not
   be vendored, copied, imported, or bundled. Interact with it only via
   (a) its HTTP API, (b) its JSON schemas (formats are not derivative
   works of the software that consumes them), or (c) Apache-licensed
   sibling packages like `@grafana/schema` and
   `@grafana/grafana-foundation-sdk`.

   **Dev-only-tooling exemption (narrow, explicit review).** Test
   runners, linters, formatters, build tools, and container images
   used only during development or CI may use copyleft licenses **if
   and only if all four** of these hold:
   1. They do not affect the shipped artifact (gated by
      `package.json`'s `files` field).
   2. They are not imported, linked, or bundled by any code we ship.
   3. The contamination analysis is written down in `research.md` for
      the specific case.
   4. The Naysayer signs off explicitly in the PR description.

   **Dependency-change discipline.** Every PR that adds, removes, or
   upgrades a *runtime* dependency must:
   - state the new dependency's name, version, and license in the PR
     description;
   - state the same in the CHANGELOG entry under `[Unreleased]`;
   - confirm the license is on the allowed list above.
   The Naysayer reviews this for every such PR. A PR that touches
   `dependencies` without these three is blocked.
8. **No runtime LLM dependency in the core library.** Intelligence is
   split between **deterministic primitives** in code (parsers, schema
   builders, validators — things the LLM cannot reliably do) and
   **textual guidance** in markdown served via MCP resources (USE /
   RED / golden-signals templates, naming conventions, query patterns
   — things the LLM already knows but we want to nudge with our
   explicit opinions). Markdown guidance lives in two homes by
   delivery mode: **`docs/guidance/*.md`** for project-authored
   guidance the LLM reads at runtime, and **`skills/*.md`** for
   user-installable shareable opinions (frontmatter + prose, modeled
   on the Anthropic Agent Skills format) that users copy into their
   own LLM tool's skills / rules directory and own from then on. Both
   are served as read-only MCP resources for clients that consume them
   at runtime; the project never writes to a user's filesystem. The
   library encodes *primitives*, not heuristic rules. LLMs live on the *client* side
   of the MCP boundary, reading our guidance and calling our primitive
   tools to compose Grafana assets. If LLM-powered narrative ever
   becomes a project deliverable, it ships as a separate optional
   package (`@<scope>/intelligence`) that depends on the core; the
   core never depends on it. Rationale: preserves §1.4 (deterministic
   output for the deterministic parts), §1.6 (small composable
   builders), §1.7 (no LLM-SDK license surface in core); avoids
   duplicating knowledge already present in any modern LLM. Ratified
   2026-05-15 (Entry 008) and revised 2026-05-16 to "Option Z"
   (Entry 011) after discovering that encoding heuristic rules in TS
   would duplicate LLM training. (Licensing rules — copyleft prohibition,
   the Grafana-core boundary, the dev-only-tooling exemption — live in
   §1.7 where they belong.)

---

## 2. The Agent Team

Each agent owns a perspective. A change is not "done" until every relevant
agent's concerns have been addressed in the PR description or by an explicit
"not applicable" note.

### 2.1 Grafana Expert
- **Owns:** correctness of generated assets against real Grafana versions.
- **Asks:** "Does this match the current Grafana JSON schema? Which versions
  does it support? Will this break on import?"
- **Reviews:** panel/dashboard JSON shapes, alert rule semantics, datasource
  references, provisioning compatibility, threshold/transformation semantics.
- **Veto power:** anything that would produce a dashboard Grafana refuses to
  import.

### 2.2 TypeScript Expert
- **Owns:** type safety, ergonomics, public API surface.
- **Asks:** "Are the types as precise as they can be without being painful?
  Are unions discriminated? Are builders chainable where it helps and explicit
  where it doesn't? Is `any` justified?"
- **Reviews:** exported types, generics, inference quality, tsconfig strictness,
  bundle/tree-shake friendliness.
- **Veto power:** loss of strict-mode compatibility or introduction of `any`
  without a documented reason.

### 2.3 MCP Expert
- **Owns:** the project's MCP surface (server + tool definitions) for agents
  that want to drive this library from a model.
- **Asks:** "Are tools named for what they do? Are inputs minimal? Are errors
  legible to a model? Is each tool independently useful?"
- **Reviews:** MCP tool schemas, tool descriptions, error messages returned to
  models, transport configuration.
- **Veto power:** tool surfaces that require an LLM to guess undocumented
  conventions.

### 2.4 LLM Expert
- **Owns:** how well an LLM can use this library — directly, via MCP, or via
  generated code.
- **Asks:** "Can a model produce a working dashboard from the README alone?
  Are examples copy-pasteable? Are error messages model-friendly? Are tool
  descriptions self-contained?"
- **Reviews:** README examples, error message phrasing, MCP tool docstrings,
  naming consistency.
- **Veto power:** APIs that require tribal knowledge to use correctly.

### 2.5 Senior Doc Writer
- **Owns:** the documentation set — README, API reference, ADRs, examples,
  this file.
- **Asks:** "Can a new contributor build a dashboard in 5 minutes? Are
  concepts introduced before they're used? Is anything stale?"
- **Reviews:** every docs change; every code change for required docs updates;
  consistency of terminology.
- **Veto power:** PRs that change public behavior without updating docs.

### 2.6 Naysayer
- **Owns:** skepticism. Defaults to "no."
- **Asks:** "Why is this needed? What does it cost? What's the simpler thing?
  What happens when this breaks? Who maintains it?"
- **Reviews:** scope, premature abstraction, dependency additions, new
  configuration surface, feature flags, **dependency licenses** (every new
  dep must be checked against §1.7's Apache-2.0 ceiling and the allowed
  list; the dependency-change discipline in §1.7 — PR description and
  CHANGELOG entry stating the name, version, license — is theirs to
  enforce).
- **Veto power:** anything justified only by "we might need it later," and
  any dependency that violates §1.7 (license less permissive than
  Apache 2.0, undeclared license in the PR/CHANGELOG, or a dev-only
  copyleft exemption that doesn't meet all four conditions).

---

## 3. The TDD Workflow

Every feature follows this loop. Skipping a step requires explicit justification
in the PR description.

1. **Spec.** Write or update the user-facing doc snippet (README example, API
   reference entry, or ADR) that describes the behavior. If you can't describe
   it, you can't build it.
2. **Red.** Write a failing test that asserts the documented behavior. Run it.
   Watch it fail for the right reason.
3. **Green.** Write the minimum code to pass. No bonus features.
4. **Refactor.** Tidy with tests green. The Naysayer reviews this step
   especially closely — refactors are where scope creeps in.
5. **Docs.** Confirm the doc snippet from step 1 matches reality. Add any
   missing edge-case documentation surfaced during implementation.
6. **Review.** Address each agent's concerns explicitly in the PR.

### Test categories
- **Unit:** pure builders, validators, type guards. Fast, in-memory, no I/O.
- **Schema-conformance:** generated JSON validates against Grafana's published
  JSON schemas (pinned per supported version).
- **Snapshot:** stable, reviewed JSON snapshots for representative assets.
  Snapshots are reviewed like code — diffs are scrutinized, not rubber-stamped.
- **Integration:** import generated assets into a real Grafana instance
  (containerized) and assert they load. Gated behind a separate test command;
  not required for every PR but required for releases.

---

## 4. Documentation Discipline

Documentation lives alongside code and is kept current as a first-class
deliverable, not an afterthought.

### What must exist
- `README.md` — quickstart, install, one-page dashboard example, links to
  deeper docs.
- `research.md` — append-only research log capturing the investigation
  behind every significant decision: candidate libraries surveyed, licenses
  verified, benchmarks, naysayer challenges, and pointers to the ADRs that
  ratify (or reject) each finding. New entries are added; old entries are
  marked superseded, never deleted.
- `docs/api/` — generated API reference (from TSDoc) plus hand-written prose
  for each public module.
- `docs/guides/` — task-oriented guides ("build an alerting dashboard",
  "migrate from JSON exports", "use from an LLM").
- `docs/adr/` — Architecture Decision Records, numbered, immutable once
  merged (superseded ADRs link forward).
- `examples/` — runnable, tested example projects. Every example is exercised
  by CI.
- `CHANGELOG.md` — keep-a-changelog format, updated in the same PR as the
  change.

### Rules
- **No undocumented exports.** If it's in the public API surface, it has TSDoc.
- **No stale examples.** Examples are compiled and run in CI. A broken example
  fails the build.
- **Docs PRs are real PRs.** They get the same review as code.
- **Terminology is consistent.** A panel is a "panel" everywhere — never a
  "widget" in one place and a "tile" in another. The Doc Writer maintains a
  glossary in `docs/glossary.md`.

---

## 5. Repository Layout (target)

```
/
├── AGENTS.md                ← this file
├── README.md
├── research.md              ← append-only research log (Section 4)
├── CHANGELOG.md
├── package.json
├── tsconfig.json
├── src/
│   ├── assets/              ← parameterized builders per asset type
│   │                         (dashboard, panel, alert, …) — these ARE
│   │                         the "templates" callers parameterize (§1.8)
│   ├── schemas/             ← typed Grafana schemas + validators
│   ├── validation/          ← cross-cutting validators (Zod-based)
│   ├── ingest/              ← format parsers (Prometheus exposition,
│   │                         OpenMetrics, …) — primitives the LLM
│   │                         can't reliably do itself (§1.8)
│   ├── mcp/                 ← MCP server, tool definitions, resource
│   │                         handler that serves docs/guidance/*.md
│   │                         and skills/*.md (§1.8)
│   └── index.ts
├── test/
│   ├── unit/
│   ├── schema/
│   ├── snapshot/
│   └── integration/
├── skills/                  ← user-installable shareable opinions
│                              (frontmatter + prose + illustrative
│                              JSON), copyable into Claude Code /
│                              Cursor / generic MCP clients. Starter
│                              artifacts the user owns from install;
│                              the project does not auto-update
│                              copies (§1.8)
├── examples/
└── docs/
    ├── api/
    ├── guides/
    ├── adr/
    ├── guidance/            ← project-authored markdown opinions
    │                         (RED, USE, golden signals, counter
    │                         conventions, naming) — served verbatim
    │                         via MCP resources (§1.8)
    └── glossary.md
```

This layout is the target, not a precondition — directories appear as the
features that need them appear, driven by tests.

---

## 6. Definition of Done

A change is done when **all** of the following are true:

- [ ] A failing test existed first and now passes.
- [ ] All tests pass (`npm test`) and types check (`npm run typecheck`).
- [ ] Linter and formatter are clean.
- [ ] Public API changes have TSDoc.
- [ ] User-facing changes have README / guide / CHANGELOG updates.
- [ ] Each relevant agent's concerns are addressed in the PR description.
- [ ] The Naysayer's "is this necessary?" question has a written answer.
- [ ] Generated output is deterministic (verified by a snapshot or repeat run).
- [ ] Any added dependency is permissively licensed (Section 1.7) and the
      license is recorded in `research.md` or an ADR.

---

## 7. How to Invoke the Agents

When working in this repo with Claude Code (or any subagent-capable harness),
the agents above map to perspectives, not to separate processes. For a given
change:

1. Draft the change.
2. Walk the agent checklist (Section 2). For each agent, write one or two
   sentences in the PR description: what they'd say, and how the change
   answers them.
3. If an agent would block, the change isn't ready.

For larger changes, spawn a dedicated review subagent per perspective and
collect their findings before merge.

---

## 8. Open Questions

These are deliberately unresolved and will be settled by ADRs as the project
matures:

- **Schema source of truth:** vendor the Grafana JSON schemas, generate types
  from them, or both?
- **Runtime validation:** zod, valibot, ajv against JSON schema, or a custom
  validator tuned for error message quality?
- **MCP transport:** stdio only, or also HTTP/SSE? Authentication model?
- **Target Grafana versions:** which versions are in the support matrix, and
  how do we test against each?

The Naysayer's standing instruction on each of these: pick the smallest answer
that lets the next test pass.
