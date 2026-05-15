import { describe, expect, it } from 'vitest';

import { buildDashboard } from '../../src/index.js';

describe('buildDashboard', () => {
  it('produces a dashboard whose title matches the input', () => {
    const dashboard = buildDashboard({ title: 'My Dashboard' });

    expect(dashboard.title).toBe('My Dashboard');
  });
});
