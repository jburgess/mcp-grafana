import { describe, expect, it } from 'vitest';

import { main } from '../../examples/pr-review.js';

// AGENTS.md §4: every example is exercised by CI. This one also proves the
// pr-review recipe (docs/guidance/pr-review.md) turns a dashboard diff into
// the risk-ordered changelist the recipe describes.

describe('examples/pr-review.ts', () => {
  it('surfaces the planted change at every risk tier', () => {
    const { diff } = main();
    // Removed panel (Latency p99).
    expect(diff.panelsRemoved.map((p) => p.title)).toContain('Latency p99');
    // Added panel (Saturation).
    expect(diff.panelsAdded.map((p) => p.title)).toContain('Saturation');
    // Panel 1 changed unit and query; panel 2 changed datasource.
    const p1 = diff.panelsChanged.find((c) => c.id === 1);
    const p2 = diff.panelsChanged.find((c) => c.id === 2);
    expect(p1?.changes.map((c) => c.field).sort()).toEqual(['targets', 'unit']);
    expect(p2?.changes.map((c) => c.field)).toEqual(['datasource']);
    // uid change at the dashboard level.
    expect(diff.dashboardChanges.map((c) => c.field)).toContain('uid');
    // Panel 5 changed only a threshold — invisible to the projection, so it
    // surfaces as otherChanges with an empty changes list.
    const p5 = diff.panelsChanged.find((c) => c.id === 5);
    expect(p5?.changes).toEqual([]);
    expect(p5?.otherChanges).toBe(true);
  });

  it('surfaces the out-of-projection change in the changelist', () => {
    const { changelist } = main();
    const other = changelist.find((i) => i.kind === 'other-changes');
    expect(other?.panel).toBe('Cache hit rate');
  });

  it('orders the changelist removals-first, cosmetic-last', () => {
    const { changelist } = main();
    expect(changelist.length).toBeGreaterThan(0);
    // The first item is the removal (tier 1).
    expect(changelist[0]?.kind).toBe('panel-removed');
    // Tiers are non-decreasing across the list.
    const tiers = changelist.map((i) => i.tier);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
  });

  it('flags the datasource swap with its before/after', () => {
    const { changelist } = main();
    const swap = changelist.find((i) => i.kind === 'datasource-swap');
    expect(swap?.panel).toBe('Error ratio');
    expect(swap?.detail).toContain('prom');
    expect(swap?.detail).toContain('mimir');
  });

  it('is deterministic across repeat runs (AGENTS.md §1.4)', () => {
    const a = main();
    const b = main();
    expect(JSON.stringify(a.changelist)).toBe(JSON.stringify(b.changelist));
  });
});
