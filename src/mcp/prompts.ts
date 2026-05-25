/**
 * MCP prompts for the flagship workflow recipes.
 *
 * The server already serves every `docs/guidance/*.md` file as a read-only
 * MCP *resource* (see resources.ts). Prompts are a different surface: a
 * prompt-aware client shows them in a picker as one-click "start this
 * workflow" entries, optionally with arguments. This module registers the
 * three end-to-end *workflow* recipes — the build / audit / review legs —
 * as prompts so a user can launch them without first knowing the resource
 * URI exists.
 *
 * Curated, not auto-discovered: the reference docs (units, descriptions,
 * thresholds, bulk-panel-updates, session-resource-registry) are patterns
 * a workflow leans on, not tasks a user kicks off, so they stay resources
 * only. Each entry below names its backing guidance file; the prompt body
 * is that file read fresh on each request (single source of truth — the
 * markdown is never duplicated here). The drift guard is the prompt-list
 * test, which asserts the exact registered set.
 *
 * Per AGENTS.md §1.8 the opinion stays in the markdown; this module only
 * plumbs it to the prompt surface and prepends the caller-supplied inputs.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GUIDANCE_DIR = resolve(PACKAGE_ROOT, 'docs/guidance');

interface RecipePrompt {
  /** Prompt name as the client sees it. */
  name: string;
  /** Backing guidance file under docs/guidance/. */
  file: string;
  title: string;
  description: string;
  /**
   * Optional string arguments. MCP prompt arguments are always strings; an
   * absent value is allowed (every arg here is optional so the prompt is
   * useful even with nothing filled in). Each entry is rendered into a
   * short "inputs" preamble prepended to the recipe body.
   */
  args: Array<{ name: string; describe: string; label: string }>;
}

const RECIPE_PROMPTS: RecipePrompt[] = [
  {
    name: 'grafana_scaffold_dashboard',
    file: 'scaffold-from-metrics.md',
    title: 'Scaffold a dashboard from /metrics',
    description:
      'Turn a Prometheus /metrics scrape into a committable, lint-clean ' +
      'Grafana dashboard (the build leg). Follows the RED / USE / ' +
      'golden-signals patterns from the style guide.',
    args: [
      {
        name: 'metricsPath',
        label: 'metrics file',
        describe:
          'Filesystem path to a saved Prometheus /metrics scrape to scaffold from. ' +
          'Optional — omit to scaffold from metrics you provide inline.',
      },
    ],
  },
  {
    name: 'grafana_audit_dashboard',
    file: 'audit-review.md',
    title: 'Audit an existing dashboard',
    description:
      'Load → inspect → lint → prioritise → fix → verify an existing ' +
      'Grafana dashboard, producing a prioritised review of what is wrong ' +
      'and how to fix it (the audit leg).',
    args: [
      {
        name: 'dashboardPath',
        label: 'dashboard file',
        describe:
          'Filesystem path to the dashboard JSON to audit. Optional — omit ' +
          'to audit a dashboard you provide inline.',
      },
    ],
  },
  {
    name: 'grafana_review_dashboard_change',
    file: 'pr-review.md',
    title: 'Review a dashboard change',
    description:
      'Diff two Grafana dashboards and turn the semantic deltas into a ' +
      'risk-ordered changelist (the review leg). Pairs with ' +
      'grafana_dashboard_diff.',
    args: [
      {
        name: 'basePath',
        label: 'base (before) file',
        describe:
          'Filesystem path to the "before" dashboard JSON. Optional — omit ' +
          'to pass dashboards inline.',
      },
      {
        name: 'headPath',
        label: 'head (after) file',
        describe:
          'Filesystem path to the "after" dashboard JSON. Optional — omit ' +
          'to pass dashboards inline.',
      },
    ],
  },
];

// MCP prompt messages are delivered as a `user` turn. The recipe bodies are
// second-person instructional markdown ("tell you HOW to…"), so handed over
// raw they read as the user's *essay* rather than as a procedure to run —
// the model may summarize the recipe back instead of executing it. This
// directive frames the body unambiguously as instructions to carry out.
const DIRECTIVE =
  'Carry out the following Grafana workflow recipe to complete the request. ' +
  'The markdown below is a set of instructions for you to FOLLOW — compose ' +
  'the named tools in the steps described — not a document to summarize back.';

// Builds the prompt message text: the directive, the caller-supplied inputs
// (if any), then the recipe body verbatim. Omitted args contribute nothing
// (every arg is optional). Arg order follows the recipe's declared order, so
// the output is stable regardless of how the client orders the arguments.
function buildPromptText(
  recipe: RecipePrompt,
  args: Record<string, string | undefined>,
  body: string,
): string {
  const lines: string[] = [];
  for (const arg of recipe.args) {
    const value = args[arg.name];
    if (value !== undefined && value !== '') {
      lines.push(`- ${arg.label}: \`${value}\``);
    }
  }
  const inputs = lines.length > 0 ? `Use these inputs for this run:\n${lines.join('\n')}\n\n` : '';
  return `${DIRECTIVE}\n\n${inputs}${body}`;
}

/**
 * Registers the workflow-recipe prompts. Returns the list of registered
 * prompt names for tests / smoke checks. A recipe whose backing file is
 * missing is skipped silently (mirrors the resource handler's
 * missing-file tolerance) rather than registering a prompt that would
 * error on read.
 */
export function registerRecipePrompts(server: McpServer): string[] {
  const registered: string[] = [];

  for (const recipe of RECIPE_PROMPTS) {
    const absFile = resolve(GUIDANCE_DIR, recipe.file);
    if (!existsSync(absFile)) continue;

    const argsSchema: Record<string, z.ZodOptional<z.ZodString>> = {};
    for (const arg of recipe.args) {
      argsSchema[arg.name] = z.string().optional().describe(arg.describe);
    }

    server.registerPrompt(
      recipe.name,
      {
        title: recipe.title,
        description: recipe.description,
        argsSchema,
      },
      (args: Record<string, string | undefined>) => {
        // Read fresh on each request so a recipe edit reflects immediately
        // (same contract as the resource handler). Files are small / local.
        const body = readFileSync(absFile, 'utf8');
        return {
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: buildPromptText(recipe, args, body) },
            },
          ],
        };
      },
    );

    registered.push(recipe.name);
  }

  return registered;
}
