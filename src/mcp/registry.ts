/**
 * Session-scoped, in-memory registry for dashboard JSON resources.
 *
 * Why this exists: the dashboard-consuming MCP tools (inspect, validate,
 * lint, panel_insert / _update / _move / _remove, variable_rename, …)
 * all accept the dashboard as an inline JSON object. For real
 * dashboards (the node-exporter fixture is 15.5k lines, ~50–70k
 * tokens) that JSON lands in the LLM's tool-call arguments AND in the
 * write tools' result `dashboard` field — compounded across every
 * step of an audit or build workflow.
 *
 * The registry keeps the parsed dashboard in memory under a URI; the
 * LLM only sees the URI plus small structured results. JSON enters
 * the LLM's context only via an explicit `grafana_dashboard_export`
 * step. Per AGENTS.md §1.8 the project never writes to the user's
 * filesystem; export hands the JSON back to the caller who uses the
 * host's own Write tool if they want to persist.
 *
 * Lifecycle: the registry is a per-`McpServer` instance Map (see
 * `src/mcp/server.ts` — `createMcpServer()` constructs both together).
 * Because the MCP SDK creates a fresh server per session and discards
 * it when the session ends, the registry is automatically session-
 * scoped — no explicit teardown hook needed. `grafana_dashboard_close`
 * is offered for callers who want to free memory explicitly before
 * session end.
 *
 * URI scheme: `mcp://grafana/session/dashboard/<n>` where `<n>` is a
 * sequential per-registry counter starting at 1. Chosen over content-
 * addressable hashing because the latter would dedupe distinct loads
 * of the same dashboard (callers might legitimately want two slots) —
 * and deterministic sequential ids make tests cleaner.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type Dict, asDict, deepClone } from '../assets/_internal.js';
import { inspectDashboard } from '../assets/inspect.js';

export const REGISTRY_URI_PREFIX = 'mcp://grafana/session/dashboard/';

export interface RegistryLoadOk {
  ok: true;
  uri: string;
}

export interface RegistryError {
  ok: false;
  error: { code: 'not-found' | 'parse-error' | 'not-an-object' | 'unknown-uri'; message: string };
}

export interface RegistryExportOk {
  ok: true;
  dashboard: Dict;
}

export interface RegistryCloseOk {
  ok: true;
  /** True when the URI was present and removed; false when it was already absent. */
  removed: boolean;
}

export type LoadResult = RegistryLoadOk | RegistryError;
export type ExportResult = RegistryExportOk | RegistryError;
export type CloseResult = RegistryCloseOk | RegistryError;

/**
 * Per-session dashboard registry. One instance per `McpServer`.
 *
 * Stored values are deep-cloned on insert AND on export. Insert clone
 * means the file-system source (or any caller-supplied object) is
 * decoupled from the in-memory slot. Export clone means downstream
 * tools that mutate the result don't reach back into the registry's
 * authoritative copy. Mutating writes (item 3 of the umbrella) get a
 * separate API that doesn't clone — they operate on the registry
 * copy in place.
 */
export class DashboardRegistry {
  private readonly slots = new Map<string, Dict>();
  private nextId = 1;

  /**
   * Loads a dashboard from a filesystem path, parses it, and registers
   * it under a fresh URI. Returns the URI on success or a structured
   * error on failure (file not found, parse error, root is not an
   * object). Path is resolved against the process CWD; absolute paths
   * are honoured verbatim.
   */
  loadFromPath(path: string): LoadResult {
    const absolute = resolve(path);
    let text: string;
    try {
      text = readFileSync(absolute, 'utf8');
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'not-found',
          message: `cannot read file: ${absolute} (${(err as Error).message})`,
        },
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'parse-error',
          message: `invalid JSON in ${absolute}: ${(err as Error).message}`,
        },
      };
    }

    const dashboard = asDict(parsed);
    if (!dashboard) {
      return {
        ok: false,
        error: {
          code: 'not-an-object',
          message: `dashboard at ${absolute} must be a JSON object at the root`,
        },
      };
    }

    return { ok: true, uri: this.register(dashboard) };
  }

  /**
   * Registers a pre-parsed dashboard object directly. Used by tests
   * and by sibling load tools (a future `dashboard_fetch` over HTTP
   * would call this after parsing). The input is deep-cloned so the
   * caller's object is not aliased.
   */
  register(dashboard: Dict): string {
    const id = this.nextId;
    this.nextId++;
    const uri = `${REGISTRY_URI_PREFIX}${id}`;
    this.slots.set(uri, deepClone(dashboard));
    return uri;
  }

  /**
   * Retrieves the dashboard registered at `uri` as a deep clone. The
   * clone protects the authoritative copy from downstream mutation —
   * mutating writes go via a dedicated method (added in item 3 of the
   * umbrella).
   */
  export(uri: string): ExportResult {
    const stored = this.slots.get(uri);
    if (!stored) {
      return {
        ok: false,
        error: {
          code: 'unknown-uri',
          message: `no dashboard registered at ${uri}`,
        },
      };
    }
    return { ok: true, dashboard: deepClone(stored) };
  }

  /**
   * Replaces the dashboard registered at `uri` with the given value.
   * The new value is deep-cloned on insert (same discipline as
   * `register`). Used by the write tools' registry-mutation path —
   * after a library function produces a modified dashboard, this
   * stores the new state under the original URI so subsequent reads
   * see the mutation. Errors when the URI is not present.
   */
  replace(uri: string, dashboard: Dict): LoadResult {
    if (!this.slots.has(uri)) {
      return {
        ok: false,
        error: {
          code: 'unknown-uri',
          message: `no dashboard registered at ${uri}`,
        },
      };
    }
    this.slots.set(uri, deepClone(dashboard));
    return { ok: true, uri };
  }

  /**
   * Removes the dashboard registered at `uri`. Returns `removed: false`
   * when the URI is not (or no longer) present — closing an unknown
   * URI is not an error. Idempotent.
   */
  close(uri: string): CloseResult {
    if (!uri.startsWith(REGISTRY_URI_PREFIX)) {
      return {
        ok: false,
        error: {
          code: 'unknown-uri',
          message: `${uri} is not a valid registry URI (must start with ${REGISTRY_URI_PREFIX})`,
        },
      };
    }
    const removed = this.slots.delete(uri);
    return { ok: true, removed };
  }

  /**
   * Returns the count of dashboards currently registered. Exposed for
   * tests and for future inspection tools; not part of the MCP tool
   * surface.
   */
  size(): number {
    return this.slots.size;
  }
}

/**
 * Result of resolving a `{ dashboard?, dashboardUri? }` tool input into a
 * concrete dashboard. Used by every read tool that accepts both inline
 * JSON and a registry URI — the resolver enforces mutual exclusion,
 * handles the URI lookup, and produces a structured error for the tool
 * to forward verbatim.
 */
export type ResolvedDashboard =
  | { ok: true; dashboard: Dict }
  | {
      ok: false;
      error: { code: 'both-provided' | 'neither-provided' | 'unknown-uri'; message: string };
    };

/**
 * Resolves a tool's `{ dashboard?, dashboardUri? }` input into a concrete
 * dashboard object. Encapsulates the "exactly one of" enforcement and
 * the registry lookup so every read tool wires the same way.
 *
 * Why a helper rather than inline checks: five tools (and counting)
 * grow this argument shape. Inline duplication is the failure mode
 * that produced the `remove.ts` id-less-panel bug (see `_internal.ts`
 * docstring). One implementation, one error catalogue, one tested
 * code path.
 *
 * The resolver does NOT clone the dashboard from the registry — the
 * read tools are read-only, so they can safely read from the
 * authoritative copy. Write tools (item 3 of #65) will use a separate
 * helper that returns the registry's mutable slot.
 */
export function resolveDashboardArg(
  args: { dashboard?: unknown; dashboardUri?: string | undefined },
  registry: DashboardRegistry,
): ResolvedDashboard {
  const hasInline = args.dashboard !== undefined;
  const hasUri = typeof args.dashboardUri === 'string' && args.dashboardUri.length > 0;

  if (hasInline && hasUri) {
    return {
      ok: false,
      error: {
        code: 'both-provided',
        message:
          'pass exactly one of `dashboard` (inline JSON) or `dashboardUri` (registry URI), not both',
      },
    };
  }
  if (!hasInline && !hasUri) {
    return {
      ok: false,
      error: {
        code: 'neither-provided',
        message:
          'pass exactly one of `dashboard` (inline JSON) or `dashboardUri` (registry URI)',
      },
    };
  }

  if (hasUri) {
    const result = registry.export(args.dashboardUri as string);
    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: 'unknown-uri',
          message: result.error.message,
        },
      };
    }
    return { ok: true, dashboard: result.dashboard };
  }

  // hasInline. asDict-narrowing is the caller's responsibility — the
  // existing tools all do their own defensive narrowing (a sticking
  // point inherited from when the MCP boundary used `z.record(...)`
  // which permits any object shape).
  return { ok: true, dashboard: args.dashboard as Dict };
}

/**
 * Shape returned by every write tool's library function: an optional
 * `dashboard` (absent on failure) plus structured `errors[]`. Each
 * specific result type (`InsertResult`, `UpdateResult`, `MoveResult`,
 * `RemoveResult`, `RenameVariableResult`) is structurally assignable
 * to this shape, plus may carry extra fields like `rewrites` and
 * `locations`. We don't intersect with `Record<string, unknown>` here
 * because the specific result types don't carry an index signature
 * (and `exactOptionalPropertyTypes: true` rejects the intersection);
 * extra fields are still preserved at runtime by the spread inside
 * `applyWriteResult`.
 */
export type WriteResult = { dashboard?: Dict; errors: unknown[] };

/**
 * Translates a write tool's library result into the right MCP envelope
 * depending on whether the caller used inline `dashboard` or a
 * `dashboardUri`. Centralises the protocol so every write tool wires
 * the same way:
 *
 * - **Inline (`dashboardUri === undefined`)**: returns the result
 *   unchanged — today's `{ dashboard?, errors[], ...rest }` shape.
 * - **URI, failure (`result.dashboard` absent)**: returns
 *   `{ uri, errors[], ...rest }` — the URI is surfaced for caller
 *   context but no summary is computed (there's nothing to summarise).
 *   The registry slot is NOT mutated.
 * - **URI, success (`result.dashboard` present)**: writes the new
 *   dashboard back into the registry under the same URI, computes a
 *   bounded `summary` (the same shape as `grafana_dashboard_inspect
 *   detail:"summary"`), and returns `{ uri, summary, errors[],
 *   ...rest }`. The big dashboard JSON does NOT enter the LLM
 *   context — that's the whole point of #65.
 *
 * Caller-supplied extra result fields (e.g. `rewrites`, `locations`
 * on `renameVariable`) flow through both shapes — they're small,
 * useful, and not the dashboard JSON.
 */
export function applyWriteResult(args: {
  dashboardUri: string | undefined;
  registry: DashboardRegistry;
  result: WriteResult;
}): Record<string, unknown> {
  const { dashboardUri, registry, result } = args;

  if (dashboardUri === undefined) {
    return result;
  }

  // `dashboard` is the field we strip from the registry-path response.
  // Everything else (errors, plus tool-specific extras) flows through.
  const { dashboard, ...rest } = result;

  if (dashboard === undefined) {
    return { uri: dashboardUri, ...rest };
  }

  registry.replace(dashboardUri, dashboard);
  const summary = inspectDashboard(dashboard, { detail: 'summary' });
  return { uri: dashboardUri, summary, ...rest };
}
