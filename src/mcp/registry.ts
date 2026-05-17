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
