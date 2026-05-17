/**
 * Generic MCP resource handler for skill / guidance markdown.
 *
 * Registers every `skills/*.md` and `docs/guidance/*.md` file in the
 * installed package as a read-only MCP resource. URI shapes follow
 * `docs/conventions/mcp-resource-uris.md`:
 *
 *   skills/<name>.md          → mcp://grafana/skills/<name>.md
 *   docs/guidance/<name>.md   → mcp://grafana/docs/guidance/<name>.md
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

interface ResourceDir {
  /** Path under the package root (e.g. `skills`, `docs/guidance`). */
  relativePath: string;
  /** Prefix on the MCP URI, e.g. `skills` or `docs/guidance`. */
  uriPrefix: string;
}

const RESOURCE_DIRS: ResourceDir[] = [
  { relativePath: 'skills', uriPrefix: 'skills' },
  { relativePath: 'docs/guidance', uriPrefix: 'docs/guidance' },
];

function listMarkdownFiles(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir)
    .filter((f) => extname(f) === '.md')
    .sort();
}

/**
 * Discover every markdown file under the project's resource
 * directories and register it as a read-only MCP resource. Returns
 * the list of registered URIs for tests / smoke checks.
 */
export function registerMarkdownResources(server: McpServer): string[] {
  const registered: string[] = [];

  for (const dir of RESOURCE_DIRS) {
    const absDir = resolve(PACKAGE_ROOT, dir.relativePath);
    for (const fileName of listMarkdownFiles(absDir)) {
      const uri = `mcp://grafana/${dir.uriPrefix}/${fileName}`;
      const absFile = resolve(absDir, fileName);
      const resourceName = `${dir.uriPrefix.replace(/\//g, '-')}-${basename(fileName, '.md')}`;

      server.registerResource(
        resourceName,
        uri,
        {
          title: fileName,
          description: `${dir.uriPrefix}/${fileName} — read-only markdown resource. See docs/conventions/mcp-resource-uris.md for the naming convention.`,
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
