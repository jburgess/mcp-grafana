import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DashboardRegistry,
  REGISTRY_URI_PREFIX,
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
