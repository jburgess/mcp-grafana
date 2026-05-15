import { describe, expect, it } from 'vitest';
import { PanelBuilder } from '@grafana/grafana-foundation-sdk/timeseries';

import { buildDashboard } from '../../src/index.js';

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
});
