/**
 * Generic MCP resource handler for skill / guidance markdown.
 *
 * Registers each skill (`skills/<name>/SKILL.md`) and every
 * `docs/guidance/*.md` file in the installed package as a read-only MCP
 * resource. URI shapes follow `docs/conventions/mcp-resource-uris.md`:
 *
 *   skills/<name>/SKILL.md    → mcp://grafana/skills/<name>.md
 *   docs/guidance/<name>.md   → mcp://grafana/docs/guidance/<name>.md
 *
 * Skills use the directory form (`<name>/SKILL.md`) the Claude Code and
 * Codex plugin loaders expect, so the same file serves the MCP resource
 * and the bundled plugin skill. The served URI keeps the flat
 * `skills/<name>.md` leaf for backwards compatibility.
 *
 * Read-only — there is no companion write tool, and the server never
 * mutates the on-disk files. Content is loaded fresh on each read so a
 * skill edit reflects immediately without a server restart.
 *
 * Path resolution mirrors `server.ts`'s package.json read: this file
 * is at `src/mcp/resources.ts` in source and `dist/mcp/resources.js`
 * after build, so `../../` resolves to the package root in both
 * shapes. Missing directories are tolerated silently — a freshly
 * scaffolded package without `docs/guidance/` is valid.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type ResourceLayout = 'flat' | 'skill-dir';

interface ResourceDir {
  /** Path under the package root (e.g. `skills`, `docs/guidance`). */
  relativePath: string;
  /** Prefix on the MCP URI, e.g. `skills` or `docs/guidance`. */
  uriPrefix: string;
  /**
   * `flat` — every `*.md` directly in the dir is a resource.
   * `skill-dir` — each subdirectory with a `SKILL.md` is a resource,
   * surfaced under the flat URI leaf `<subdir>.md`.
   */
  layout: ResourceLayout;
}

const RESOURCE_DIRS: ResourceDir[] = [
  { relativePath: 'skills', uriPrefix: 'skills', layout: 'skill-dir' },
  { relativePath: 'docs/guidance', uriPrefix: 'docs/guidance', layout: 'flat' },
];

interface DiscoveredResource {
  /** URI leaf and basis for the resource name; always ends in `.md`. */
  leaf: string;
  /** Absolute path to the markdown file to serve. */
  absFile: string;
}

function discoverResources(absDir: string, layout: ResourceLayout): DiscoveredResource[] {
  if (!existsSync(absDir)) return [];
  if (layout === 'flat') {
    return readdirSync(absDir)
      .filter((f) => extname(f) === '.md')
      .sort()
      .map((f) => ({ leaf: f, absFile: resolve(absDir, f) }));
  }
  // skill-dir: each `<name>/SKILL.md` → leaf `<name>.md` so the URI stays
  // `mcp://grafana/skills/<name>.md` (stable across the flat→dir move).
  // Keying on the nested `SKILL.md` (rather than `Dirent.isDirectory()`)
  // also picks up a symlinked skill directory and naturally ignores
  // stray files; auxiliary skill files (e.g. `references/`) are ignored.
  return readdirSync(absDir)
    .filter((name) => existsSync(resolve(absDir, name, 'SKILL.md')))
    .sort()
    .map((name) => ({ leaf: `${name}.md`, absFile: resolve(absDir, name, 'SKILL.md') }));
}

/**
 * Discover every skill / guidance markdown file under the project's
 * resource directories and register it as a read-only MCP resource.
 * Returns the list of registered URIs for tests / smoke checks.
 */
export function registerMarkdownResources(server: McpServer): string[] {
  const registered: string[] = [];

  for (const dir of RESOURCE_DIRS) {
    const absDir = resolve(PACKAGE_ROOT, dir.relativePath);
    for (const { leaf, absFile } of discoverResources(absDir, dir.layout)) {
      const uri = `mcp://grafana/${dir.uriPrefix}/${leaf}`;
      const resourceName = `${dir.uriPrefix.replace(/\//g, '-')}-${basename(leaf, '.md')}`;

      server.registerResource(
        resourceName,
        uri,
        {
          title: leaf,
          description: `${dir.uriPrefix}/${leaf} — read-only markdown resource. See docs/conventions/mcp-resource-uris.md for the naming convention.`,
          mimeType: 'text/markdown',
        },
        async (resourceUri: URL) => {
          // Read on each request so an edit to the file is reflected
          // immediately without a server restart. Files are small
          // (KBs) and reads are local — no caching needed.
          const text = readFileSync(absFile, 'utf8');
          return {
            contents: [
              {
                uri: resourceUri.toString(),
                mimeType: 'text/markdown',
                text,
              },
            ],
          };
        },
      );

      registered.push(uri);
    }
  }

  return registered;
}
