import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DashboardRegistry,
  REGISTRY_URI_PREFIX,
  applyWriteResult,
  resolveDashboardArg,
} from '../../src/mcp/registry.js';

function tempFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-grafana-registry-'));
  const path = join(dir, name);
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('DashboardRegistry', () => {
  describe('register / export', () => {
    it('returns a URI under the session-dashboard prefix', () => {
      const r = new DashboardRegistry();
      const uri = r.register({ title: 'd' });
      expect(uri.startsWith(REGISTRY_URI_PREFIX)).toBe(true);
    });

    it('returns sequential ids starting at 1', () => {
      const r = new DashboardRegistry();
      const a = r.register({ title: 'a' });
      const b = r.register({ title: 'b' });
      const c = r.register({ title: 'c' });
      expect(a).toBe(`${REGISTRY_URI_PREFIX}1`);
      expect(b).toBe(`${REGISTRY_URI_PREFIX}2`);
      expect(c).toBe(`${REGISTRY_URI_PREFIX}3`);
    });

    it('exports the registered dashboard by URI', () => {
      const r = new DashboardRegistry();
      const uri = r.register({ title: 'My Dashboard', panels: [] });
      const result = r.export(uri);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.dashboard.title).toBe('My Dashboard');
      }
    });

    it('returns unknown-uri error when exporting a URI that was not registered', () => {
      const r = new DashboardRegistry();
      const result = r.export(`${REGISTRY_URI_PREFIX}99`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unknown-uri');
      }
    });

    it('deep-clones on register so caller mutation does not affect stored dashboard', () => {
      const r = new DashboardRegistry();
      const input: { title: string; nested?: { v: number } } = {
        title: 'd',
        nested: { v: 1 },
      };
      const uri = r.register(input as Record<string, unknown>);
      input.nested!.v = 99;
      const result = r.export(uri);
      if (!result.ok) throw new Error('expected ok');
      const dash = result.dashboard as { nested?: { v: number } };
      expect(dash.nested?.v).toBe(1);
    });

    it('deep-clones on export so consumer mutation does not affect stored dashboard', () => {
      const r = new DashboardRegistry();
      const uri = r.register({ title: 'd', n: { v: 1 } });
      const first = r.export(uri);
      if (!first.ok) throw new Error('expected ok');
      (first.dashboard.n as { v: number }).v = 99;

      const second = r.export(uri);
      if (!second.ok) throw new Error('expected ok');
      expect((second.dashboard.n as { v: number }).v).toBe(1);
    });
  });

  describe('loadFromPath', () => {
    it('reads, parses, and registers a JSON file', () => {
      const path = tempFile('d.json', JSON.stringify({ title: 'From File' }));
      const r = new DashboardRegistry();
      const result = r.loadFromPath(path);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const exported = r.export(result.uri);
        if (!exported.ok) throw new Error('export failed');
        expect(exported.dashboard.title).toBe('From File');
      }
    });

    it('returns not-found error for a missing file', () => {
      const r = new DashboardRegistry();
      const result = r.loadFromPath('/nonexistent/path/dashboard.json');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not-found');
      }
    });

    it('returns parse-error for invalid JSON', () => {
      const path = tempFile('bad.json', '{ this is not json');
      const r = new DashboardRegistry();
      const result = r.loadFromPath(path);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('parse-error');
      }
    });

    it('returns not-an-object for a JSON file whose root is an array', () => {
      const path = tempFile('arr.json', '[1, 2, 3]');
      const r = new DashboardRegistry();
      const result = r.loadFromPath(path);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not-an-object');
      }
    });
  });

  describe('close', () => {
    it('removes a registered dashboard from the registry', () => {
      const r = new DashboardRegistry();
      const uri = r.register({ title: 'd' });
      expect(r.size()).toBe(1);

      const result = r.close(uri);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.removed).toBe(true);
      expect(r.size()).toBe(0);

      // Subsequent export fails.
      const exp = r.export(uri);
      expect(exp.ok).toBe(false);
    });

    it('is idempotent — closing an unknown URI returns removed:false, not an error', () => {
      const r = new DashboardRegistry();
      const result = r.close(`${REGISTRY_URI_PREFIX}999`);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.removed).toBe(false);
    });

    it('rejects URIs not under the registry prefix as malformed', () => {
      const r = new DashboardRegistry();
      const result = r.close('http://example.com/whatever');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('unknown-uri');
    });

    it('treats prefix-matching but absent URIs as removed:false (permissive)', () => {
      // A URI under the registry prefix but with a non-existent / unparseable
      // id (e.g. `…/dashboard/abc` or `…/dashboard/` with empty id) is still
      // structurally "a registry URI" — close is intentionally permissive and
      // returns `removed: false` rather than erroring. Pinned to lock in the
      // contract (the alternative — erroring — was discussed in PR #72 review).
      const r = new DashboardRegistry();
      const abc = r.close(`${REGISTRY_URI_PREFIX}abc`);
      expect(abc.ok).toBe(true);
      if (abc.ok) expect(abc.removed).toBe(false);

      const empty = r.close(REGISTRY_URI_PREFIX);
      expect(empty.ok).toBe(true);
      if (empty.ok) expect(empty.removed).toBe(false);
    });
  });
});

describe('resolveDashboardArg', () => {
  it('returns the inline dashboard when only `dashboard` is provided', () => {
    const r = new DashboardRegistry();
    const result = resolveDashboardArg({ dashboard: { title: 'inline' } }, r);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dashboard.title).toBe('inline');
  });

  it('resolves the registry dashboard when only `dashboardUri` is provided', () => {
    const r = new DashboardRegistry();
    const uri = r.register({ title: 'from-registry' });
    const result = resolveDashboardArg({ dashboardUri: uri }, r);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dashboard.title).toBe('from-registry');
  });

  it('errors with `both-provided` when both arguments are supplied', () => {
    const r = new DashboardRegistry();
    const uri = r.register({ title: 'd' });
    const result = resolveDashboardArg({ dashboard: { title: 'x' }, dashboardUri: uri }, r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('both-provided');
  });

  it('errors with `neither-provided` when both arguments are absent', () => {
    const r = new DashboardRegistry();
    const result = resolveDashboardArg({}, r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('neither-provided');
  });

  it('errors with `unknown-uri` when the dashboardUri does not resolve', () => {
    const r = new DashboardRegistry();
    const result = resolveDashboardArg({ dashboardUri: `${REGISTRY_URI_PREFIX}999` }, r);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown-uri');
  });

  it('treats empty-string `dashboardUri` as absent (so inline dashboard still resolves)', () => {
    const r = new DashboardRegistry();
    const result = resolveDashboardArg({ dashboard: { title: 'd' }, dashboardUri: '' }, r);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dashboard.title).toBe('d');
  });
});

describe('DashboardRegistry.replace', () => {
  it('updates the stored dashboard with a deep clone', () => {
    const r = new DashboardRegistry();
    const uri = r.register({ title: 'before' });
    const next: { title: string; n: { v: number } } = { title: 'after', n: { v: 1 } };
    const result = r.replace(uri, next as Record<string, unknown>);
    expect(result.ok).toBe(true);

    // Caller mutation does not propagate.
    next.n.v = 99;
    const exp = r.export(uri);
    if (!exp.ok) throw new Error('export failed');
    expect((exp.dashboard as { n: { v: number } }).n.v).toBe(1);
    expect(exp.dashboard.title).toBe('after');
  });

  it('errors with unknown-uri when replacing a URI that was not registered', () => {
    const r = new DashboardRegistry();
    const result = r.replace(`${REGISTRY_URI_PREFIX}99`, { title: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown-uri');
  });
});

describe('applyWriteResult', () => {
  it('passes through the inline result unchanged when dashboardUri is undefined', () => {
    const r = new DashboardRegistry();
    const env = applyWriteResult({
      dashboardUri: undefined,
      registry: r,
      result: { dashboard: { title: 'x' }, errors: [] },
    });
    expect(env).toEqual({ dashboard: { title: 'x' }, errors: [] });
  });

  it('replaces the registry slot and returns { uri, summary, errors[] } on success', () => {
    const r = new DashboardRegistry();
    const uri = r.register({ title: 'before' });

    const env = applyWriteResult({
      dashboardUri: uri,
      registry: r,
      result: {
        dashboard: { title: 'after', panels: [{ id: 1, type: 'timeseries', title: 'X' }] },
        errors: [],
      },
    }) as { uri: string; summary: { title: string; panelCount: number }; errors: unknown[] };

    expect(env.uri).toBe(uri);
    expect(env.summary.title).toBe('after');
    expect(env.summary.panelCount).toBe(1);
    expect(env.errors).toEqual([]);

    // Registry slot was actually replaced.
    const exp = r.export(uri);
    if (!exp.ok) throw new Error('export failed');
    expect(exp.dashboard.title).toBe('after');
  });

  it('preserves tool-specific extra fields (e.g. rewrites, locations) on URI success', () => {
    const r = new DashboardRegistry();
    const uri = r.register({ title: 'before' });

    const env = applyWriteResult({
      dashboardUri: uri,
      registry: r,
      result: {
        dashboard: { title: 'after' },
        errors: [],
        rewrites: 3,
        locations: ['templating.list[0].name', 'panels[0].targets[0].expr'],
      },
    }) as {
      uri: string;
      summary: unknown;
      errors: unknown[];
      rewrites: number;
      locations: string[];
    };

    expect(env.rewrites).toBe(3);
    expect(env.locations).toHaveLength(2);
  });

  it('returns { uri, errors[] } and does NOT mutate the registry on failure', () => {
    const r = new DashboardRegistry();
    const uri = r.register({ title: 'before' });

    const env = applyWriteResult({
      dashboardUri: uri,
      registry: r,
      result: {
        errors: [{ path: 'panel.id', message: 'unknown panelId' }],
      },
    }) as { uri: string; summary?: unknown; errors: unknown[] };

    expect(env.uri).toBe(uri);
    expect(env.summary).toBeUndefined();
    expect(env.errors).toHaveLength(1);

    // Registry slot unchanged.
    const exp = r.export(uri);
    if (!exp.ok) throw new Error('export failed');
    expect(exp.dashboard.title).toBe('before');
  });
});
