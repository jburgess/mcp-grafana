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
  configuration surface, feature flags.
- **Veto power:** anything justified only by "we might need it later."

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
├── CHANGELOG.md
├── package.json
├── tsconfig.json
├── src/
│   ├── assets/              ← builders per asset type (dashboard, panel, …)
│   ├── schemas/             ← typed Grafana schemas + validators
│   ├── validation/          ← cross-cutting validators
│   ├── mcp/                 ← MCP server + tool definitions
│   └── index.ts
├── test/
│   ├── unit/
│   ├── schema/
│   ├── snapshot/
│   └── integration/
├── examples/
└── docs/
    ├── api/
    ├── guides/
    ├── adr/
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
