/**
 * Integration tests: round-trip our generated dashboard JSON through a real
 * Grafana 12.4 container. Surfaces correctness issues that unit tests can't
 * catch by definition — schema-version drift, missing required fields,
 * panel-shape gotchas, etc.
 *
 * Requires Docker on the host. If Docker isn't reachable, the whole suite
 * skips with a clear message rather than failing — keeping local dev (and
 * non-Docker CI runners) usable. CI has a dedicated job that DOES require
 * Docker; failures there block merges.
 *
 * Lifecycle: one Grafana container for the whole file, started in beforeAll
 * and torn down in afterAll. Each test posts a uniquely-named dashboard to
 * avoid interference; nothing is reused between tests.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { buildDashboard } from '../../src/assets/dashboard.js';
import { insertPanel } from '../../src/assets/insert.js';
import { movePanel } from '../../src/assets/move.js';
import { buildTimeseriesPanel } from '../../src/assets/panel.js';
import { removePanel } from '../../src/assets/remove.js';
import { updatePanel } from '../../src/assets/update.js';

// Detect Docker availability at module load. If absent, mark the suite as
// skipped; testcontainers would otherwise throw with a confusing connection
// error.
async function dockerReachable(): Promise<boolean> {
  try {
    // testcontainers itself probes Docker on first use; we use a cheap
    // probe instead so the skip happens BEFORE the long beforeAll timeout.
    const { exec } = await import('node:child_process');
    return await new Promise<boolean>((resolve) => {
      exec('docker info', { timeout: 3000 }, (err) => resolve(!err));
    });
  } catch {
    return false;
  }
}

const dockerAvailable = await dockerReachable();
const describeIfDocker = dockerAvailable ? describe : describe.skip;

if (!dockerAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integration] Skipping Grafana round-trip tests: Docker is not reachable. ' +
      'Start the Docker daemon to run them.',
  );
}

interface GrafanaPostResult {
  status: number;
  body: { status?: string; uid?: string; message?: string };
}

async function postDashboard(
  baseUrl: string,
  dashboard: unknown,
): Promise<GrafanaPostResult> {
  const auth = 'Basic ' + Buffer.from('admin:admin').toString('base64');
  const resp = await fetch(`${baseUrl}/api/dashboards/db`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
    },
    body: JSON.stringify({ dashboard, overwrite: false }),
  });
  const text = await resp.text();
  let body: GrafanaPostResult['body'];
  try {
    body = JSON.parse(text) as GrafanaPostResult['body'];
  } catch {
    body = { message: text };
  }
  return { status: resp.status, body };
}

// Uniquifies a dashboard so repeated test runs don't collide on uid/title.
function withUniqueIdentity<T extends Record<string, unknown>>(
  dashboard: T,
  tag: string,
): T {
  const stamp = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { ...dashboard, id: null, uid: stamp, title: `${dashboard.title ?? 'test'} (${stamp})` };
}

describeIfDocker('grafana integration: round-trip our generated JSON through Grafana 12.4', () => {
  let container: StartedTestContainer;
  let baseUrl: string;

  beforeAll(async () => {
    container = await new GenericContainer('grafana/grafana:12.4.0')
      .withExposedPorts(3000)
      // Disable Grafana's signup/init prompts so the default admin:admin
      // credentials work immediately.
      .withEnvironment({
        GF_AUTH_ANONYMOUS_ENABLED: 'false',
        GF_USERS_ALLOW_SIGN_UP: 'false',
      })
      .withWaitStrategy(Wait.forHttp('/api/health', 3000).forStatusCode(200))
      .start();
    baseUrl = `http://${container.getHost()}:${container.getMappedPort(3000)}`;
  });

  afterAll(async () => {
    if (container) await container.stop();
  });

  it('accepts a dashboard built from scratch via buildDashboard + buildTimeseriesPanel', async () => {
    const panel = buildTimeseriesPanel({
      title: 'HTTP requests',
      unit: 'reqps',
      targets: [{ expr: 'rate(http_requests_total[5m])' }],
    });
    const dashboard = buildDashboard({
      title: 'Integration build-from-scratch',
      panels: [panel],
    });
    const result = await postDashboard(
      baseUrl,
      withUniqueIdentity(dashboard as unknown as Record<string, unknown>, 'scratch'),
    );
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('success');
  });

  it('accepts an empty dashboard (just a title)', async () => {
    const dashboard = buildDashboard({ title: 'Integration empty' });
    const result = await postDashboard(
      baseUrl,
      withUniqueIdentity(dashboard as unknown as Record<string, unknown>, 'empty'),
    );
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('success');
  });

  it('accepts the real Node Exporter Full fixture (16 rows, 141 panels, mixed format)', async () => {
    const dashboard = JSON.parse(
      readFileSync(new URL('../fixtures/node-exporter-full.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    const result = await postDashboard(baseUrl, withUniqueIdentity(dashboard, 'nef'));
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('success');
  });

  it('accepts the real fixture after insertPanel into a modern-format row', async () => {
    const dashboard = JSON.parse(
      readFileSync(new URL('../fixtures/node-exporter-full.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    const newPanel = buildTimeseriesPanel({
      title: 'NEW PANEL from MCP',
      unit: 'short',
      targets: [{ expr: 'rate(my_custom_metric[5m])' }],
    });
    // Row id 261 is "Quick CPU / Mem / Disk" — modern-format row in this fixture.
    const inserted = insertPanel(dashboard, newPanel, { mode: 'inRow', rowId: 261 });
    expect(inserted.errors).toEqual([]);
    const result = await postDashboard(baseUrl, withUniqueIdentity(inserted.dashboard as Record<string, unknown>, 'rt-insert'));
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('success');
  });

  it('accepts the real fixture after updatePanel changes a nested unit', async () => {
    const dashboard = JSON.parse(
      readFileSync(new URL('../fixtures/node-exporter-full.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    // Panel id 323 is "Pressure" — has unit "percentunit"; change to "decbytes"
    const updated = updatePanel(dashboard, 323, {
      fieldConfig: { defaults: { unit: 'decbytes' } },
    });
    expect(updated.errors).toEqual([]);
    const result = await postDashboard(baseUrl, withUniqueIdentity(updated.dashboard as Record<string, unknown>, 'rt-update'));
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('success');
  });

  it('accepts the real fixture after movePanel reorders a row', async () => {
    const dashboard = JSON.parse(
      readFileSync(new URL('../fixtures/node-exporter-full.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    // Move row 263 ("Basic CPU / Mem / Net / Disk") to append (will carry trailing siblings)
    const moved = movePanel(dashboard, 263, { mode: 'append' });
    expect(moved.errors).toEqual([]);
    const result = await postDashboard(baseUrl, withUniqueIdentity(moved.dashboard as Record<string, unknown>, 'rt-move'));
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('success');
  });

  it('accepts the real fixture after removePanel deletes a nested panel', async () => {
    const dashboard = JSON.parse(
      readFileSync(new URL('../fixtures/node-exporter-full.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    // Panel id 323 is nested under a modern-format row; remove it
    const removed = removePanel(dashboard, 323);
    expect(removed.errors).toEqual([]);
    const result = await postDashboard(baseUrl, withUniqueIdentity(removed.dashboard as Record<string, unknown>, 'rt-remove'));
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('success');
  });

  it('rejects a deliberately malformed dashboard (sanity check: suite has teeth)', async () => {
    // Empty title — Grafana refuses this. If this test ever stops failing,
    // either Grafana's API changed or our post helper is masking errors.
    const result = await postDashboard(baseUrl, { panels: [] });
    expect(result.status).toBe(400);
    expect(result.body.message).toMatch(/title/i);
  });
});
