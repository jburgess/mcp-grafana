# ADR 0002 — Panel style ships as a reference skill, not as code

**Status:** Accepted (2026-05-16)
**Related:** `research.md` Entry 012; `AGENTS.md` §1.8; ADR 0001 (typed substrate, pending — number reserved per `research.md` Entry 001)

## Context

Grafana panels carry style decisions that are independent of the data they
display: which display unit (`short` vs `locale` vs `reqps`), how the
legend renders (`bottom list` vs `right table with calcs`), threshold
conventions, whether a description is required, and so on. Teams converge
on in-house conventions for these decisions, and there is no single
project-wide "correct" answer — the kubernetes-mixin, Grafana Labs' own
Mimir / Loki / Tempo reference dashboards, and any large internal
observability platform each encode a slightly different taste.

mcp-grafana exposes builders, validators, inspect, insert, and update
primitives for Grafana assets. The question was whether (and how) the
project should also ship *opinion* about panel style — and how that
opinion should reach the LLMs that drive the builders.

Four shapes were considered:

1. **Hard-coded TypeScript lint rules** — a `defaultStyleGuide` constant
   plus a checker that enforces it. Every change of taste becomes a
   release; the project owns the opinion forever; encoding rules in TS
   re-litigates `AGENTS.md` §1.8 (Entry 011), which explicitly rejected
   "encoding heuristic rules in TypeScript" on the grounds that it
   duplicates LLM training.
2. **Markdown bundled in `docs/guidance/`** — opinion served as an MCP
   resource by the project. Better than (1), but still locks every user
   into one bundled default. Release velocity of the opinion stays
   coupled to mcp-grafana releases.
3. **Sidecar npm package or separate repo** — taste lives in a different
   release artifact than the tooling. Maximally decoupled, but the
   friction of "go install a second thing" suppresses adoption for what
   is, fundamentally, a shareable markdown file.
4. **Reference skill *inside* this repo, framed as a copyable starter** —
   `skills/panel-style.md` is a markdown artifact (frontmatter + prose +
   embedded `StyleGuide` JSON) that users copy into their own LLM
   tool's skills / rules directory and own from then on. mcp-grafana
   ships zero default opinion in code; the lint primitive (forthcoming)
   takes a `StyleGuide` arg with no fallback.

The team debate (`research.md` Entry 012) converged on (4) over
several rounds, with each round narrowing the surface area:

- Reject named profile families (`red-method` / `use-method` /
  `golden-signals`) — Grafana Expert veto: those are methodology, not
  panel style, and conflating them misleads LLM callers.
- Reject a `defaultStyleGuide` exported constant — Naysayer: every named
  default is pre-1.0 API surface we own forever.
- Reject a `grafana_skill_install` tool — MCP Expert + portability:
  hard-coding `~/.claude/skills/` couples us to one client, and
  filesystem-write tools are a permission cliff that fails in sandboxed
  environments.
- Reject coupling lint to build (`grafana_timeseries_panel_build` does
  *not* auto-apply lint) — §1.6 composability and LLM Expert: required
  per-call style args invite the model to forget them.

## Decision

We adopt option 4. The repo ships:

- **`skills/panel-style.md`** — markdown with frontmatter, prose
  rationale, and an embedded illustrative `StyleGuide` JSON block.
  Modeled on the kubernetes-mixin / monitoring-mixins corpus and
  Grafana Labs' reference dashboards. Framed unambiguously as a
  starter: users `cp` it into their own skills/rules directory and own
  the copy from then on.
- **`lintPanel(panel, styleGuide: StyleGuide)` library primitive**
  (forthcoming) — *requires* the caller to pass a `StyleGuide`. No
  `defaultStyleGuide` export. Returns `LintResult { issues: LintIssue[],
  truncated? }` with `LintIssue { path, ruleId, severity:
  'warn' | 'info', message }`. Severity is `warn` or `info` only —
  style is opinion, never `error`.
- **`grafana_panel_lint` MCP tool** (forthcoming) — adapter over
  `lintPanel`, same required-arg shape. Returns issues; never rejects;
  never auto-fixes.
- **Read-only MCP resource at `mcp://grafana/skills/panel-style.md`**
  (forthcoming) — serves the skill file from disk for runtime fetch by
  the model. Discoverable via `resources/list`. No write tool.

The skill is the carrier of *opinion*. The lint primitive is the carrier
of *check*. The `StyleGuide` JSON schema is the contract between them —
small, schema-versioned (`$schema` URL), additive-only.

The lint primitive and MCP wiring are tracked as follow-up work; this
ADR ratifies the architecture, and the skill file ships ahead of the
checker so the prose can be reviewed and forked independently.

## On-ramps

The README expands these; in summary:

- **Claude Code:** `cp $(npm root -g)/@jburgess/mcp-grafana/skills/panel-style.md ~/.claude/skills/`
- **Cursor:** `@`-include in chat, or paste into `.cursorrules`
- **Generic MCP client / paste-into-prompt:** fetch the resource at
  `mcp://grafana/skills/panel-style.md`, or grab the file directly from
  the repo or installed package.

The MCP server delivers content (read-only resource) but does not
install (no filesystem-write tool). Users move bits with their own
tools.

## Consequences

- mcp-grafana stays opinion-free in its lint surface. No bundled
  default profile; the skill is the only place an opinion lives.
- Users who disagree with the skill fork it. There is no profile
  selection mechanism, no `defineRule` plugin API, no
  per-call `styleGuide:` arg on build tools.
- The `StyleGuide` schema is API surface mcp-grafana owns forever.
  Keep it small and additive; rule identifiers (`legend.placement`,
  `unit.allowList`, etc.) are the only growth axis, and grow by
  addition only.
- The skill living in the same repo couples its release cadence to
  mcp-grafana. This is acceptable as long as the skill is framed as a
  starter, not as a managed artifact. If a second team with conflicting
  taste appears, the right answer is they fork the skill — not that the
  project grows a profile mechanism.
- Cross-client portability is preserved because the skill is just
  markdown. Claude Code consumes it as a skill; Cursor as a rule;
  generic MCP clients as a resource or as paste-into-prompt content.
  No part of the design hard-codes any one client's conventions.
- §1.8's "primitives in code, opinions in markdown" split (`AGENTS.md`)
  extends from `docs/guidance/*.md` (project-authored guidance, e.g.
  RED / USE templates) to `skills/*.md` (user-installable shareable
  opinions). Both are markdown; the distinction is delivery mode.

## Alternatives revisited (so we don't go back)

- **`grafana_skill_install` tool** — rejected on portability
  (hard-codes one client's filesystem layout) and on MCP design
  grounds (filesystem-write via tool is a permission cliff and fails
  in sandboxed environments).
- **Named profile family** (`red-method` / `use-method` /
  `golden-signals`) — Grafana Expert veto: methodology, not rendering
  style. Such patterns live as prose recipes inside or alongside the
  skill, not as lint-profile names.
- **Plugin `defineRule` API** — rejected per `AGENTS.md` §2.6 as
  premature abstraction with no concrete consumer demanding it. The
  `StyleGuide` JSON shape is data-driven; rule kinds are added by
  extending the schema, not by accepting user-supplied rule functions.
- **`defaultStyleGuide` exported constant** — rejected because every
  exported default becomes the implicit standard and pre-1.0 API
  surface. The skill file *is* the project's reference instance; it
  travels as content, not as code.
- **Auto-lint inside `grafana_timeseries_panel_build`** — rejected per
  §1.6 (small composable builders) and LLM Expert: bundling lint into
  build forces every caller through one workflow and trains the LLM to
  suppress lint output it didn't ask for.

## Agent review

- **Grafana Expert:** accepts. Vetoed the named-methodology profiles
  (out of scope of the skill's framing now). Notes that `legend.calcs`
  reducer IDs (`lastNotNull`, `mean`, `max`) have been stable since
  Grafana v9 and are correct for the v12 target.
- **TypeScript Expert:** accepts the `StyleGuide`-as-data shape and the
  separate `LintIssue` / `LintResult` types (distinct from
  `ValidationResult`, since style ≠ schema-validity loses the severity
  axis otherwise). Will revisit when implementing the lint primitive.
- **MCP Expert:** accepts. The read-only resource + soft tool surface
  matches MCP idioms; the rejection of a stateful `style_guide_set`
  call and of an `install` tool both preserve transport-agnosticism
  and avoid hidden server state.
- **LLM Expert:** accepts. Skill frontmatter gives the model a clear
  "use this when building a Grafana panel" trigger; no required per-call
  arg means the LLM cannot forget to pass it; warnings (not errors)
  preserve the model's agency to decide.
- **Doc Writer:** accepts. The skill is documentation that the model
  consumes at runtime; same content travels across clients with no
  client-specific markup. The starter framing in the skill's own prose
  and in this ADR's consequences avoids any implication that the
  project manages the user's copy.
- **Naysayer:** the implementation work is still deferred until a
  failing test justifies each piece, which is the right TDD posture.
  The skill itself is prose, not code, and adds zero runtime surface.
  Acceptable on the explicit understanding that future PRs do not
  smuggle in a `defaultStyleGuide`, a profile selector, or any of the
  rejected alternatives above. If they do, this ADR is the document to
  cite.
