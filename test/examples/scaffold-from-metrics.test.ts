import { describe, expect, it } from 'vitest';

import { main, SAMPLE_METRICS } from '../../examples/scaffold-from-metrics.js';

// AGENTS.md §4: every example is exercised by CI. This one is also the
// proof that the scaffold-from-metrics recipe
// (docs/guidance/scaffold-from-metrics.md) actually composes the shipped
// primitives into a dashboard that lints clean against a realistic
// GrafanaStyleGuide — i.e. the recipe's "Step 4 self-check" passes.

describe('examples/scaffold-from-metrics.ts', () => {
  it('scaffolds a dashboard that lints clean against the recipe style guide', () => {
    const { lint } = main();
    // The recipe's Step 2 defaults are chosen to satisfy every enabled
    // rule; a non-empty issue list means the recipe and the builders
    // have drifted apart.
    expect(lint.issues).toEqual([]);
  });

  it('produces the row-sequence the recipe prescribes (categorical fold first)', () => {
    const { dashboard } = main();
    const panels = (dashboard as unknown as { panels: Array<{ type?: string; title?: string }> })
      .panels;

    // First positioned panel is the categorical-health state-timeline —
    // the "fold" the firstRowCategorical rule enforces.
    expect(panels[0]?.type).toBe('state-timeline');
    expect(panels[0]?.title).toBe('Service health');

    // The two RED/USE section rows are present, in order.
    const rowTitles = panels.filter((p) => p.type === 'row').map((p) => p.title);
    expect(rowTitles).toEqual(['Requests, errors, latency (RED)', 'Resources (USE)']);
  });

  it('tags the dashboard `overview` so the fold rule is in scope', () => {
    const { dashboard } = main();
    const tags = (dashboard as unknown as { tags?: string[] }).tags ?? [];
    expect(tags).toContain('overview');
  });

  it('maps each panelled metric and folds histogram siblings', () => {
    const { metrics, dashboard } = main();
    // The parser emits histogram siblings (`_bucket` / `_sum` / `_count`)
    // as distinct families — the recipe folds `_sum` / `_count` into the
    // duration panel rather than giving them their own panels.
    const names = metrics.map((m) => m.name).sort();
    expect(names).toEqual([
      'http_request_duration_seconds',
      'http_request_duration_seconds_bucket',
      'http_request_duration_seconds_count',
      'http_request_duration_seconds_sum',
      'http_requests_total',
      'process_resident_memory_bytes',
      'up',
    ]);

    // The metrics the recipe turns into panels are all referenced.
    const json = JSON.stringify(dashboard);
    for (const name of [
      'up',
      'http_requests_total',
      'http_request_duration_seconds_bucket',
      'process_resident_memory_bytes',
    ]) {
      expect(json).toContain(name);
    }
    // The folded siblings are intentionally NOT given their own panels.
    expect(json).not.toContain('http_request_duration_seconds_sum');
    expect(json).not.toContain('http_request_duration_seconds_count');
  });

  it('is deterministic across repeat runs (AGENTS.md §1.4)', () => {
    const a = main();
    const b = main();
    expect(JSON.stringify(a.dashboard)).toBe(JSON.stringify(b.dashboard));
  });

  it('exports the raw sample exposition for documentation reuse', () => {
    expect(SAMPLE_METRICS).toContain('# TYPE http_requests_total counter');
  });
});
