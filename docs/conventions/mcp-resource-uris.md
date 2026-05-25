# MCP resource-URI naming convention

This project serves markdown content (skills and project-authored
guidance) as MCP resources. The two content types live in different
directories with different ownership rules, and their MCP resource
URIs follow distinct conventions documented below.

The convention is settled once here so future skill authors do not
re-open the file-name vs frontmatter-name vs URI-authority debate. The
debate that produced these rules is captured in
[`research.md`](../../research.md) Entry 013 (the "Naming and scope"
subsection, ratified 2026-05-16).

> **Also served as prompts.** The three flagship *workflow* recipes under
> `docs/guidance/` (`scaffold-from-metrics.md`, `audit-review.md`,
> `pr-review.md`) are additionally exposed as MCP **prompts** — one-click
> entry points in prompt-aware clients — via `registerPrompt`
> (`src/mcp/prompts.ts`). This is a second delivery surface for the same
> files, not a new URI scheme: the resource URIs below are unchanged, and
> the prompt body is the same markdown read fresh. See
> [`research.md`](../../research.md) Entry 022.

## Rules

### `skills/<name>/SKILL.md` — user-installable shareable opinions

Each skill is a **directory** under `skills/` containing a `SKILL.md`
file (the directory form the Claude Code and Codex plugin loaders
require, so the same file serves the MCP resource and the bundled plugin
skill — see [`research.md`](../../research.md) Entry 019). The skill
**directory name MUST equal the YAML frontmatter `name` value**. The MCP
resource URI keeps the flat `<name>.md` leaf (unchanged across the
earlier flat→directory move, so existing references stay valid):

```
mcp://grafana/skills/<name>.md
```

Examples:

| Directory on disk                    | `SKILL.md` frontmatter `name` | MCP URI                                       |
| ------------------------------------ | ----------------------------- | --------------------------------------------- |
| `skills/grafana-style-guide/SKILL.md` | `grafana-style-guide`         | `mcp://grafana/skills/grafana-style-guide.md` |

The "stutter" — `grafana/` authority plus `grafana-` directory prefix —
is **accepted** as the cost of directory-and-frontmatter parity. The MCP
Expert's preference for stripping the redundant prefix on the path was
overridden by the user's instruction that the skill name must match the
frontmatter `name` value, and by the cross-tool ergonomics argument:
users install skills into their own LLM tooling (and plugin loaders
discover them) by directory name, and a skill whose on-disk name differs
from its frontmatter identity is a small but real source of confusion.
See [`research.md`](../../research.md) Entry 013 "Naming and scope:
resolution" (the original parity decision) and Entry 019 (the
plugin-driven move to the `SKILL.md` directory form).

### `docs/guidance/*.md` — project-authored guidance

File names under `docs/guidance/` are the source of truth. There is
**no frontmatter `name` field** to keep in sync. The MCP resource URI
is:

```
mcp://grafana/docs/guidance/<name>.md
```

Examples (hypothetical, as `docs/guidance/` directory will land with
the first guidance file):

| File on disk                  | MCP URI                                       |
| ----------------------------- | --------------------------------------------- |
| `docs/guidance/red-method.md` | `mcp://grafana/docs/guidance/red-method.md`   |
| `docs/guidance/use-method.md` | `mcp://grafana/docs/guidance/use-method.md`   |

Guidance files are **project-authored** (not user-installable). The
project owns the prose; clients read it at runtime via the MCP
resource handler. **No `grafana-` filename prefix** is needed — the
`grafana/` authority on the URI already supplies that, and these
files are not installed into a per-user shared namespace where they
would collide with other tools' guidance.

## Cross-cutting rules

All skill and guidance files served as MCP resources are
**read-only**:

- **No write tool** exposes the resource paths. The MCP server
  delivers content; users move bits with their own tools (editor,
  copy-paste, shell). See `AGENTS.md` §1.8.
- **No installer** targets a specific filesystem path. The project
  does not auto-update copies installed by users.
- **No filesystem mutation** of any kind via MCP tools that touch
  these paths.

This boundary is durable, not a v0 deferral — the project's role is
to ship the canonical version and serve it as a resource; clients
choose what to do with it.

## Where this policy lives

This document is the single source of truth. It is linked from:

- [`AGENTS.md`](../../AGENTS.md) §1.8 (the section that describes the
  two content modes — `docs/guidance/*.md` for project-authored
  guidance and `skills/*.md` for user-installable opinions).
- [`research.md`](../../research.md) Entry 013's "Naming and scope:
  resolution" subsection (forward pointer to the codified policy).

When the project accumulates more skills or guidance files, the
authors do not need to relitigate path-vs-frontmatter vs URI-authority
trade-offs — this policy is the answer.
