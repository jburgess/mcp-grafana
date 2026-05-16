import { describe, expect, it } from 'vitest';
import { PanelBuilder } from '@grafana/grafana-foundation-sdk/timeseries';

import { buildDashboard, buildTimeseriesPanel } from '../../src/index.js';

describe('buildDashboard', () => {
  it('produces a dashboard whose title matches the input', () => {
    const dashboard = buildDashboard({ title: 'My Dashboard' });

    expect(dashboard.title).toBe('My Dashboard');
  });

  it('includes a provided panel builder in the dashboard', () => {
    const dashboard = buildDashboard({
      title: 'My Dashboard',
      panels: [new PanelBuilder().title('CPU usage')],
    });

    expect(dashboard.panels).toHaveLength(1);
    expect(dashboard.panels?.[0]?.title).toBe('CPU usage');
  });

  it('omits panels when none are provided', () => {
    const dashboard = buildDashboard({ title: 'My Dashboard' });

    expect(dashboard.panels ?? []).toHaveLength(0);
  });

  it('accepts a pre-built panel JSON object (output of buildTimeseriesPanel)', () => {
    const panel = buildTimeseriesPanel({
      title: 'HTTP requests',
      targets: [{ expr: 'rate(http_requests_total[$__rate_interval])' }],
    });

    const dashboard = buildDashboard({
      title: 'My Dashboard',
      panels: [panel],
    });

    expect(dashboard.panels).toHaveLength(1);
    expect(dashboard.panels?.[0]?.title).toBe('HTTP requests');
  });

  it('accepts a mix of pre-built panel JSON and SDK panel builders', () => {
    const prebuiltPanel = buildTimeseriesPanel({
      title: 'Errors',
      targets: [{ expr: 'sum(rate(http_requests_total{status=~"5.."}[5m]))' }],
    });

    const dashboard = buildDashboard({
      title: 'My Dashboard',
      panels: [new PanelBuilder().title('CPU usage'), prebuiltPanel],
    });

    expect(dashboard.panels).toHaveLength(2);
    const titles = dashboard.panels?.map((p) => p.title);
    expect(titles).toEqual(['CPU usage', 'Errors']);
  });
});
