# Glossary

Terms used across the mcp-grafana codebase, docs, and PR
descriptions. Where two terms are near-synonyms, this glossary
disambiguates them.

## guidance (project-authored)

A markdown file under `docs/guidance/` served as an MCP resource via
the project's resource handler. Project-authored — the project owns
the prose, and clients read it at runtime without copying anything to
their filesystem. Distinct from **skills** (which are user-installable
copies users own from then on). Examples: RED-method patterns,
USE-method patterns, naming conventions, query patterns. See
`AGENTS.md` §1.8 and the MCP resource-URI convention in
[`docs/conventions/mcp-resource-uris.md`](./conventions/mcp-resource-uris.md).

## skill

A markdown file under `skills/` with YAML frontmatter (`name`,
`description`) conforming to the
[Anthropic Agent Skills format](https://www.anthropic.com/news/agent-skills).
A skill is a user-installable, shareable opinion: users copy the file
into their own LLM tool's skills / rules directory (Claude Code,
Cursor, generic MCP, etc.) and own the copy from then on — the
project does not auto-update installed copies. The file name MUST
equal the frontmatter `name` value; see the MCP resource-URI
convention in
[`docs/conventions/mcp-resource-uris.md`](./conventions/mcp-resource-uris.md)
for the full rule. The reference skill in this project is
`skills/grafana-style-guide.md`.

## style guide

A *content type* — opinion about how an asset should look (units,
legends, thresholds, axis labels, titles, descriptions). Carried by a
skill, but the term "style guide" refers to the *content*, not the
file. The machine-readable form of a style guide is the
`GrafanaStyleGuide` JSON shape (umbrella) and its slices
(`PanelStyleGuide`, etc.). See `research.md` Entry 013 for the
six-perspective debate that produced this shape; see [issue
#25](https://github.com/jburgess/mcp-grafana/issues/25) for the
implementation tracking.

## style skill

**Informal shorthand** for a skill whose content type is a style
guide. `skills/grafana-style-guide.md` is the project's reference
style skill — a skill (the file shape) carrying a style guide (the
content type). The README's "Grafana style skill" section uses this
shorthand. The three terms are not synonyms; they layer:

- **skill** = file shape (markdown + frontmatter under `skills/`).
- **style guide** = content type (opinion about asset appearance).
- **style skill** = the combination — a skill carrying a style guide.

## StyleGuide (JSON shape)

The machine-readable form of a **style guide**, consumed by the
`lintPanel` library function and the `grafana_panel_lint` MCP tool.
Exported root type is `GrafanaStyleGuide` (umbrella, namespaced
`{ panels, units, descriptions, ... }`); per-domain slices are
`PanelStyleGuide`, etc. The library deliberately does **not** export
a bare `StyleGuide` type — it collides with Storybook / ESLint
vocabulary and erases the Grafana domain at the import site. See
[issue #25](https://github.com/jburgess/mcp-grafana/issues/25) and
`research.md` Entry 013.
