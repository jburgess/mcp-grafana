import { describe, expect, it } from 'vitest';

import { buildTimeseriesPanel } from '../../src/assets/panel.js';

describe('buildTimeseriesPanel', () => {
  it('produces a panel with the given title and a single target', () => {
    const panel = buildTimeseriesPanel({
      title: 'HTTP requests',
      targets: [{ expr: 'rate(http_requests_total[$__rate_interval])' }],
    });

    expect(panel.title).toBe('HTTP requests');
    expect(panel.targets).toHaveLength(1);
    expect((panel.targets?.[0] as { expr?: string })?.expr).toBe(
      'rate(http_requests_total[$__rate_interval])',
    );
  });

  it('supports multiple targets on the same chart (multi-expression panels)', () => {
    const panel = buildTimeseriesPanel({
      title: 'HTTP rate vs errors',
      targets: [
        {
          expr: 'sum(rate(http_requests_total[$__rate_interval]))',
          legendFormat: 'all',
        },
        {
          expr: 'sum(rate(http_requests_total{status=~"5.."}[$__rate_interval]))',
          legendFormat: 'errors',
        },
      ],
    });

    expect(panel.targets).toHaveLength(2);
    const targets = panel.targets as Array<{ expr?: string; legendFormat?: string }>;
    expect(targets[0]?.legendFormat).toBe('all');
    expect(targets[1]?.legendFormat).toBe('errors');
  });

  it('propagates description and unit when provided', () => {
    const panel = buildTimeseriesPanel({
      title: 'x',
      description: 'total processed HTTP requests per second',
      unit: 'reqps',
      targets: [{ expr: 'up' }],
    });

    expect(panel.description).toBe('total processed HTTP requests per second');
    expect(JSON.stringify(panel)).toContain('"reqps"');
  });

  it('omits optional fields when not provided', () => {
    const panel = buildTimeseriesPanel({
      title: 'x',
      targets: [{ expr: 'up' }],
    });

    expect(panel.description).toBeUndefined();
  });
});
