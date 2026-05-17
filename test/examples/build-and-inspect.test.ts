import { describe, expect, it } from 'vitest';

import { main } from '../../examples/build-and-inspect.js';

// The examples/ directory's contract per AGENTS.md §4: "Every example
// is exercised by CI. A broken example fails the build." This test
// imports the example's exported `main()`, runs it, and asserts on
// the outputs that the example's docstring promises. If the example
// breaks (rename / signature change / build pipeline change), CI fails.

describe('examples/build-and-inspect.ts', () => {
  it('produces a dashboard with the requested title and one panel', () => {
    const { dashboard, summary } = main();

    expect(dashboard).toBeDefined();
    expect(dashboard.title).toBe('HTTP service');

    expect(summary.detail).toBe('summary');
    expect(summary.title).toBe('HTTP service');
    expect(summary.panelCount).toBe(1);
    // The single panel uses `reqps` so it should appear in the
    // dashboard's datasource refs / unit reachability via inspect.
    // (Summary-level doesn't expose unit directly; the panels-detail
    // view does — covered by other tests.)
  });

  it('matches the README quickstart promise: deterministic output across repeat runs', () => {
    // AGENTS.md §1.4 — given the same inputs, generated assets must
    // be byte-identical. The example takes no inputs; consecutive
    // calls must produce equal dashboards.
    const a = main();
    const b = main();
    expect(JSON.stringify(a.dashboard)).toBe(JSON.stringify(b.dashboard));
  });
});
