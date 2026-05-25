import { describe, expect, it } from 'vitest';

import { main } from '../../examples/audit-review.js';

// AGENTS.md §4: every example is exercised by CI. This one also proves
// the audit-review recipe (docs/guidance/audit-review.md) composes the
// shipped primitives into a working load→lint→prioritise→fix→verify loop.

describe('examples/audit-review.ts', () => {
  it('lints the messy dashboard and finds the planted issues', () => {
    const { before } = main();
    const ruleIds = new Set(before.issues.map((i) => i.ruleId));
    // The silent-failure (warn) findings on panel 1.
    expect(ruleIds.has('dashboards.panels.datasourceDeclared')).toBe(true);
    expect(ruleIds.has('panels.targets.promqlSemantic')).toBe(true);
    // A representative hygiene (info) finding.
    expect(ruleIds.has('dashboards.variables.unreferenced')).toBe(true);
    expect(ruleIds.has('dashboards.panels.orphanRow')).toBe(true);
  });

  it('prioritises warn findings before info', () => {
    const { report } = main();
    expect(report.warn.length).toBeGreaterThan(0);
    expect(report.info.length).toBeGreaterThan(0);
    expect(report.warn.every((i) => i.severity === 'warn')).toBe(true);
    expect(report.info.every((i) => i.severity === 'info')).toBe(true);
  });

  it('surfaces the summary for orientation', () => {
    const { summary } = main();
    expect(summary.detail).toBe('summary');
    expect(summary.title).toBe('API service');
    expect(summary.panelCount).toBeGreaterThan(0);
  });

  it('fix → verify: patching the datasource clears that finding', () => {
    const { before, after, fixedPanelId } = main();
    const datasourceFindingsFor = (r: { issues: Array<{ ruleId: string; panelId?: number | string }> }) =>
      r.issues.filter(
        (i) => i.ruleId === 'dashboards.panels.datasourceDeclared' && i.panelId === fixedPanelId,
      );
    // Present before the fix, gone after.
    expect(datasourceFindingsFor(before).length).toBe(1);
    expect(datasourceFindingsFor(after).length).toBe(0);
    // The fix is targeted — overall warn count drops by exactly that one.
    const warnCount = (r: { issues: Array<{ severity: string }> }) =>
      r.issues.filter((i) => i.severity === 'warn').length;
    expect(warnCount(after)).toBe(warnCount(before) - 1);
  });

  it('is deterministic across repeat runs (AGENTS.md §1.4)', () => {
    const a = main();
    const b = main();
    expect(JSON.stringify(a.before.issues)).toBe(JSON.stringify(b.before.issues));
  });
});
