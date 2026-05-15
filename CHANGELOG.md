# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Project scaffolding: TypeScript (strict, ES2023, NodeNext), Vitest,
  pnpm via corepack, MIT LICENSE, `engines: ">=22.0.0"`.
- `AGENTS.md` establishing the six-agent review model
  (Grafana / TypeScript / MCP / LLM / Doc Writer / Naysayer), the TDD
  workflow, the documentation contract, the permissive-licensing
  principle, and the no-runtime-LLM-in-core intelligence-layer principle.
- `research.md` capturing the substrate decisions (Foundation SDK,
  Vitest + fast-check, MCP SDK, Zod v4, MIT license, Node 24 / pnpm,
  Grafana 12.x target, intelligence layer architecture).
- README skeleton describing the project intent and state.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) running
  `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, and
  `pnpm build` on Node 22 and Node 24 (matrix, `fail-fast: false`).
  Triggers on pushes to `main` and pull requests targeting `main`.
- `buildDashboard({ title })`: the thinnest possible wrapper over the
  Foundation SDK's `DashboardBuilder`. Produces a JSON-serializable
  Grafana `Dashboard` object whose `.title` matches the input. First
  exercise of the Foundation SDK substrate; proves the
  test/typecheck/build pipeline end-to-end with real code.
- `@grafana/grafana-foundation-sdk` (^0.0.12, Apache-2.0) added as a
  runtime dependency.
