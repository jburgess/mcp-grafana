import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { validateDashboard, validatePanel } from '../../src/assets/validate.js';

describe('validateDashboard - required top-level fields', () => {
  it('a dashboard with title and panels is valid', () => {
    const result = validateDashboard({
      title: 'Service',
      panels: [{ id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a non-object dashboard', () => {
    const result = validateDashboard('not a dashboard');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/object/i);
  });

  it('flags missing title with path "title"', () => {
    const result = validateDashboard({ panels: [] });
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.path === 'title');
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/title/i);
  });

  it('accepts a dashboard with no panels (empty allowed)', () => {
    const result = validateDashboard({ title: 'Empty' });
    expect(result.valid).toBe(true);
  });
});

describe('validateDashboard - panel id uniqueness', () => {
  it('passes when all panel ids are unique', () => {
    const result = validateDashboard({
      title: 't',
      panels: [
        { id: 1, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
        { id: 2, type: 'timeseries', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('flags duplicate top-level ids at each path with the other locations listed', () => {
    const result = validateDashboard({
      title: 't',
      panels: [
        { id: 5, type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } },
        { id: 5, type: 'stat', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
      ],
    });
    expect(result.valid).toBe(false);
    const dupErrors = result.errors.filter((e) => /duplicate panel id 5/.test(e.message));
    expect(dupErrors).toHaveLength(2);
    expect(dupErrors.map((e) => e.path).sort()).toEqual(['panels[0].id', 'panels[1].id']);
  });

  it('detects duplicates across legacy-nested rows (row.panels[])', () => {
    const result = validateDashboard({
      title: 't',
      panels: [
        {
          id: 10,
          type: 'row',
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            { id: 99, type: 'timeseries', gridPos: { x: 0, y: 1, w: 12, h: 8 } },
          ],
        },
        {
          id: 20,
          type: 'row',
          gridPos: { x: 0, y: 9, w: 24, h: 1 },
          panels: [
            { id: 99, type: 'timeseries', gridPos: { x: 0, y: 10, w: 12, h: 8 } },
          ],
        },
      ],
    });
    expect(result.valid).toBe(false);
    const paths = result.errors
      .filter((e) => /duplicate panel id 99/.test(e.message))
      .map((e) => e.path)
      .sort();
    expect(paths).toEqual(['panels[0].panels[0].id', 'panels[1].panels[0].id']);
  });

  it('flags a panel missing an id', () => {
    const result = validateDashboard({
      title: 't',
      panels: [{ type: 'timeseries', gridPos: { x: 0, y: 0, w: 12, h: 8 } }],
    });
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => /missing.*id/i.test(e.message));
    expect(err?.path).toBe('panels[0].id');
  });
});

describe('validateDashboard - variable references', () => {
  const dashWithVars = (...exprs: string[]) => ({
    title: 't',
    templating: { list: [{ name: 'env', type: 'custom' }, { name: 'service', type: 'query' }] },
    panels: exprs.map((expr, i) => ({
      id: i + 1,
      type: 'timeseries',
      gridPos: { x: 0, y: i * 8, w: 24, h: 8 },
      targets: [{ expr }],
    })),
  });

  it('passes when target.expr only references declared variables', () => {
    const result = validateDashboard(dashWithVars('rate(http{env="$env"}[$__rate_interval])'));
    expect(result.valid).toBe(true);
  });

  it('flags $undeclared with a path-localized error', () => {
    const result = validateDashboard(dashWithVars('rate(http{env="$env",team="$team"}[5m])'));
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => /\$team/.test(e.message));
    expect(err?.path).toBe('panels[0].targets[0].expr');
    expect(err?.message).toMatch(/unknown variable/i);
  });

  it('accepts built-in variables ($__interval, $__rate_interval, $__from, $timeFilter)', () => {
    const result = validateDashboard({
      title: 't',
      panels: [
        {
          id: 1,
          type: 'timeseries',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [
            { expr: 'rate(x[$__rate_interval])' },
            { expr: 'rate(x[$__interval]) and y > $__from and z < $__to' },
            { query: 'SELECT * WHERE $timeFilter' },
          ],
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('flags variables in ${braced} and [[legacy]] syntaxes', () => {
    const result = validateDashboard(dashWithVars(
      'rate(x{a="${nope}",b="[[also_nope]]"}[5m])',
    ));
    expect(result.valid).toBe(false);
    const messages = result.errors.map((e) => e.message).join(' | ');
    expect(messages).toMatch(/\$nope/);
    expect(messages).toMatch(/\$also_nope/);
  });

  it('flags variable refs in datasource.uid', () => {
    const result = validateDashboard({
      title: 't',
      templating: { list: [{ name: 'ds', type: 'datasource' }] },
      panels: [
        {
          id: 1,
          type: 'timeseries',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          datasource: { uid: '${ds}', type: 'prometheus' },
        },
        {
          id: 2,
          type: 'timeseries',
          gridPos: { x: 12, y: 0, w: 12, h: 8 },
          datasource: { uid: '${nonexistent_ds}', type: 'prometheus' },
        },
      ],
    });
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => /\$nonexistent_ds/.test(e.message));
    expect(err?.path).toBe('panels[1].datasource');
  });

  it('ignores variables when no templating section exists (no false positives on built-ins)', () => {
    const result = validateDashboard({
      title: 't',
      panels: [
        {
          id: 1,
          type: 'timeseries',
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [{ expr: 'rate(x[$__rate_interval])' }],
        },
      ],
    });
    expect(result.valid).toBe(true);
  });
});

describe('validateDashboard - against real fixture (Node Exporter Full)', () => {
  it('the vendored Node Exporter Full dashboard validates clean', () => {
    const raw = readFileSync(
      new URL('../fixtures/node-exporter-full.json', import.meta.url),
      'utf8',
    );
    const dashboard = JSON.parse(raw) as unknown;
    const result = validateDashboard(dashboard);
    if (!result.valid) {
      // Surface diagnostics so a regression has actionable output, not just "false".
      console.error('Validation errors:', JSON.stringify(result.errors, null, 2));
    }
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('validatePanel - no context', () => {
  it('a well-formed panel is valid', () => {
    const result = validatePanel({
      id: 1,
      type: 'timeseries',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
    });
    expect(result.valid).toBe(true);
  });

  it('flags missing id', () => {
    const result = validatePanel({ type: 'timeseries' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toMatch(/missing.*id/i);
  });

  it('flags malformed gridPos (non-numeric fields)', () => {
    const result = validatePanel({
      id: 1,
      type: 'timeseries',
      gridPos: { x: 0, y: 0, w: '12', h: 8 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe('$.gridPos.w');
  });

  it('does not flag undeclared variable refs without dashboard context', () => {
    // Without context we have no template list to compare against; only schema checks apply.
    const result = validatePanel({
      id: 1,
      type: 'timeseries',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      targets: [{ expr: 'rate(x{env="$env"}[5m])' }],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a non-object panel', () => {
    const result = validatePanel(null);
    expect(result.valid).toBe(false);
  });
});

describe('validatePanel - with dashboard context', () => {
  const dashboard = {
    title: 't',
    templating: { list: [{ name: 'env', type: 'custom' }] },
    panels: [],
  };

  it('passes when refs resolve against dashboard variables', () => {
    const result = validatePanel(
      {
        id: 1,
        type: 'timeseries',
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        targets: [{ expr: 'rate(x{env="$env"}[$__rate_interval])' }],
      },
      dashboard,
    );
    expect(result.valid).toBe(true);
  });

  it('flags undeclared variables the same way dashboard_validate would', () => {
    const result = validatePanel(
      {
        id: 1,
        type: 'timeseries',
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        targets: [{ expr: 'rate(x{team="$team"}[5m])' }],
      },
      dashboard,
    );
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => /\$team/.test(e.message));
    expect(err?.path).toBe('$.targets[0].expr');
  });
});

describe('validateDashboard - truncation', () => {
  it('caps error count and sets truncated=true when over 100 errors', () => {
    const panels = Array.from({ length: 150 }, () => ({
      // every panel missing id → 150 schema errors
      type: 'timeseries',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
    }));
    const result = validateDashboard({ title: 't', panels });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeLessThanOrEqual(100);
    expect(result.truncated).toBe(true);
  });

  it('omits truncated flag when error count is at or below cap', () => {
    const result = validateDashboard({ panels: [] });
    expect(result.truncated).toBeUndefined();
  });
});
