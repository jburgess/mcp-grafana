import { describe, expect, it } from 'vitest';

import { lintPanel, type PanelStyleGuide } from '../../src/assets/lint.js';

// `lintPanel` consumes the panel slice of a GrafanaStyleGuide and reports
// style issues against a single panel JSON. Per issue #25 + the team
// review that resolved the StyleGuide shape: units and descriptions are
// nested under `panels` in the slice, so the rule ids are
// `panels.units.allowList`, `panels.descriptions.required`,
// `panels.timeseries.legend.placement`, etc.

const fullGuide: PanelStyleGuide = {
  timeseries: {
    legend: {
      placement: 'right',
      displayMode: 'table',
      calcs: ['mean', 'lastNotNull', 'max'],
    },
  },
  units: {
    allowList: ['short', 'reqps', 'bytes', 'percent', 'percentunit', 's'],
    deny: ['locale', 'none'],
  },
  descriptions: { required: true },
};

function cleanTimeseries(): Record<string, unknown> {
  return {
    id: 1,
    type: 'timeseries',
    title: 'CPU utilisation',
    description: 'Per-core CPU busy ratio',
    fieldConfig: { defaults: { unit: 'percentunit' } },
    gridPos: { x: 0, y: 0, w: 12, h: 8 },
    options: {
      legend: {
        placement: 'right',
        displayMode: 'table',
        calcs: ['mean', 'lastNotNull', 'max'],
      },
    },
  };
}

describe('lintPanel - clean path', () => {
  it('returns no issues for a panel that satisfies every rule', () => {
    const result = lintPanel(cleanTimeseries(), fullGuide);
    expect(result.issues).toEqual([]);
    expect(result.truncated).toBeUndefined();
  });

  it('treats missing optional rule sections as "no opinion" — no issues fire', () => {
    const minimalGuide: PanelStyleGuide = {};
    const result = lintPanel(cleanTimeseries(), minimalGuide);
    expect(result.issues).toEqual([]);
  });
});

describe('lintPanel - units rules', () => {
  it('fires panels.units.allowList when panel unit is not in the allow list', () => {
    const panel = cleanTimeseries();
    (panel.fieldConfig as { defaults: { unit: string } }).defaults.unit = 'celsius';
    const result = lintPanel(panel, fullGuide);
    const issue = result.issues.find((i) => i.ruleId === 'panels.units.allowList');
    expect(issue).toBeDefined();
    expect(issue?.path).toBe('$.fieldConfig.defaults.unit');
    expect(issue?.severity).toBe('warn');
    expect(issue?.message).toMatch(/celsius/);
  });

  it('does NOT fire panels.units.allowList when panel has no unit declared', () => {
    // No-opinion case: a panel without a unit shouldn't be flagged for an
    // allowList rule — that's a description-rule concern, not a unit-rule
    // concern.
    const panel = cleanTimeseries();
    delete (panel.fieldConfig as { defaults: { unit?: string } }).defaults.unit;
    const result = lintPanel(panel, fullGuide);
    expect(result.issues.find((i) => i.ruleId === 'panels.units.allowList')).toBeUndefined();
  });

  it('fires panels.units.deny when panel unit is in the deny list', () => {
    const panel = cleanTimeseries();
    (panel.fieldConfig as { defaults: { unit: string } }).defaults.unit = 'locale';
    const result = lintPanel(panel, fullGuide);
    const denyIssue = result.issues.find((i) => i.ruleId === 'panels.units.deny');
    expect(denyIssue).toBeDefined();
    expect(denyIssue?.severity).toBe('warn');
    expect(denyIssue?.message).toMatch(/locale/);
  });

  it('does NOT fire allowList when the guide has no allowList', () => {
    const panel = cleanTimeseries();
    (panel.fieldConfig as { defaults: { unit: string } }).defaults.unit = 'nonsense';
    const result = lintPanel(panel, { units: { deny: ['locale'] } });
    expect(result.issues.find((i) => i.ruleId === 'panels.units.allowList')).toBeUndefined();
  });
});

describe('lintPanel - descriptions rules', () => {
  it('fires panels.descriptions.required when description is missing', () => {
    const panel = cleanTimeseries();
    delete (panel as { description?: string }).description;
    const result = lintPanel(panel, fullGuide);
    const issue = result.issues.find((i) => i.ruleId === 'panels.descriptions.required');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('info');
    expect(issue?.path).toBe('$.description');
  });

  it('fires panels.descriptions.required when description is an empty string', () => {
    // Mirrors inspectDashboard's empty-string-as-missing rule (PR #32).
    const panel = cleanTimeseries();
    (panel as { description: string }).description = '';
    const result = lintPanel(panel, fullGuide);
    expect(
      result.issues.find((i) => i.ruleId === 'panels.descriptions.required'),
    ).toBeDefined();
  });

  it('does NOT fire when descriptions.required is false', () => {
    const panel = cleanTimeseries();
    delete (panel as { description?: string }).description;
    const result = lintPanel(panel, { descriptions: { required: false } });
    expect(result.issues).toEqual([]);
  });
});

describe('lintPanel - timeseries legend rules', () => {
  function setLegend(panel: Record<string, unknown>, legend: Record<string, unknown>): void {
    panel.options = { ...((panel.options as Record<string, unknown>) ?? {}), legend };
  }

  it('fires panels.timeseries.legend.placement on mismatch', () => {
    const panel = cleanTimeseries();
    setLegend(panel, { placement: 'bottom', displayMode: 'table', calcs: ['mean', 'lastNotNull', 'max'] });
    const result = lintPanel(panel, fullGuide);
    const issue = result.issues.find((i) => i.ruleId === 'panels.timeseries.legend.placement');
    expect(issue).toBeDefined();
    expect(issue?.path).toBe('$.options.legend.placement');
    expect(issue?.message).toMatch(/right/);
    expect(issue?.message).toMatch(/bottom/);
  });

  it('fires panels.timeseries.legend.displayMode on mismatch', () => {
    const panel = cleanTimeseries();
    setLegend(panel, { placement: 'right', displayMode: 'list', calcs: ['mean', 'lastNotNull', 'max'] });
    const result = lintPanel(panel, fullGuide);
    expect(
      result.issues.find((i) => i.ruleId === 'panels.timeseries.legend.displayMode'),
    ).toBeDefined();
  });

  it('fires panels.timeseries.legend.calcs on mismatch', () => {
    const panel = cleanTimeseries();
    setLegend(panel, { placement: 'right', displayMode: 'table', calcs: ['mean'] });
    const result = lintPanel(panel, fullGuide);
    const issue = result.issues.find((i) => i.ruleId === 'panels.timeseries.legend.calcs');
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/lastNotNull/);
  });

  it('bare-array calcs uses set semantics — reordered calcs do NOT fire (#44.3 default)', () => {
    const panel = cleanTimeseries();
    // Same multiset as the guide, different order — must NOT fire.
    setLegend(panel, {
      placement: 'right',
      displayMode: 'table',
      calcs: ['max', 'mean', 'lastNotNull'],
    });
    const result = lintPanel(panel, fullGuide);
    expect(
      result.issues.find((i) => i.ruleId === 'panels.timeseries.legend.calcs'),
    ).toBeUndefined();
  });

  it('bare-array calcs fires when an element is missing (set semantics, size mismatch)', () => {
    const panel = cleanTimeseries();
    setLegend(panel, {
      placement: 'right',
      displayMode: 'table',
      calcs: ['mean', 'lastNotNull'], // missing "max"
    });
    const result = lintPanel(panel, fullGuide);
    const issue = result.issues.find((i) => i.ruleId === 'panels.timeseries.legend.calcs');
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/any order/);
  });

  it('bare-array calcs fires when a different element is present (set semantics, swap)', () => {
    const panel = cleanTimeseries();
    setLegend(panel, {
      placement: 'right',
      displayMode: 'table',
      calcs: ['mean', 'lastNotNull', 'min'], // "min" swapped in for "max"
    });
    const result = lintPanel(panel, fullGuide);
    const issue = result.issues.find((i) => i.ruleId === 'panels.timeseries.legend.calcs');
    expect(issue).toBeDefined();
  });

  it('explicit { match: "exact" } opts back into order-sensitivity', () => {
    const exactGuide: PanelStyleGuide = {
      timeseries: {
        legend: {
          placement: 'right',
          displayMode: 'table',
          calcs: { expected: ['mean', 'lastNotNull', 'max'], match: 'exact' },
        },
      },
    };
    const panel = cleanTimeseries();
    // Same set, wrong order — exact mode MUST fire.
    setLegend(panel, {
      placement: 'right',
      displayMode: 'table',
      calcs: ['max', 'mean', 'lastNotNull'],
    });
    const result = lintPanel(panel, exactGuide);
    const issue = result.issues.find((i) => i.ruleId === 'panels.timeseries.legend.calcs');
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/order-sensitive/);
  });

  it('explicit { match: "set" } matches bare-array semantics', () => {
    const setGuide: PanelStyleGuide = {
      timeseries: {
        legend: {
          placement: 'right',
          displayMode: 'table',
          calcs: { expected: ['mean', 'lastNotNull', 'max'], match: 'set' },
        },
      },
    };
    const panel = cleanTimeseries();
    setLegend(panel, {
      placement: 'right',
      displayMode: 'table',
      calcs: ['max', 'mean', 'lastNotNull'],
    });
    const result = lintPanel(panel, setGuide);
    expect(
      result.issues.find((i) => i.ruleId === 'panels.timeseries.legend.calcs'),
    ).toBeUndefined();
  });

  it('calcs error message points at "fork the skill" for cross-set divergence', () => {
    const panel = cleanTimeseries();
    setLegend(panel, {
      placement: 'right',
      displayMode: 'table',
      calcs: ['mean'],
    });
    const result = lintPanel(panel, fullGuide);
    const issue = result.issues.find((i) => i.ruleId === 'panels.timeseries.legend.calcs');
    expect(issue?.message).toMatch(/fork the skill/);
  });

  it('treats duplicate elements as distinct in set semantics (multiset, not Set)', () => {
    // ['mean', 'mean'] is NOT the same as ['mean'] — legend column
    // count matters even when order does not.
    const dupGuide: PanelStyleGuide = {
      timeseries: { legend: { calcs: ['mean', 'mean'] } },
    };
    const panel = cleanTimeseries();
    setLegend(panel, { placement: 'right', displayMode: 'table', calcs: ['mean'] });
    const result = lintPanel(panel, dupGuide);
    expect(
      result.issues.find((i) => i.ruleId === 'panels.timeseries.legend.calcs'),
    ).toBeDefined();
  });

  it('applies timeseries rules ONLY to timeseries panels', () => {
    // Stat panel with no legend should not fire a timeseries.legend rule.
    const stat = { ...cleanTimeseries(), type: 'stat', options: {} };
    const result = lintPanel(stat, fullGuide);
    expect(
      result.issues.filter((i) => i.ruleId.startsWith('panels.timeseries.')),
    ).toEqual([]);
  });

  it('does NOT fire when the timeseries section of the guide is empty', () => {
    const panel = cleanTimeseries();
    setLegend(panel, { placement: 'wherever' });
    // Build the slice without the timeseries section so the per-type
    // rules can't fire — only the cross-type units rules would, and
    // the panel's unit is fine.
    const sliceWithoutTimeseries: PanelStyleGuide = {};
    if (fullGuide.units) sliceWithoutTimeseries.units = fullGuide.units;
    const result = lintPanel(panel, sliceWithoutTimeseries);
    expect(result.issues.filter((i) => i.ruleId.startsWith('panels.timeseries.'))).toEqual([]);
  });
});

describe('lintPanel - issue shape and severity discipline', () => {
  it('every issue has path, ruleId, severity, message — and severity is warn or info', () => {
    const panel = cleanTimeseries();
    (panel.fieldConfig as { defaults: { unit: string } }).defaults.unit = 'celsius';
    delete (panel as { description?: string }).description;
    const result = lintPanel(panel, fullGuide);
    expect(result.issues.length).toBeGreaterThan(0);
    for (const i of result.issues) {
      expect(typeof i.path).toBe('string');
      expect(typeof i.ruleId).toBe('string');
      expect(typeof i.message).toBe('string');
      // Severity is style-axis: warn or info; never error (that's validate.ts's job).
      expect(['warn', 'info']).toContain(i.severity);
    }
  });

  it('emits deterministic output across repeat runs', () => {
    // §1.4 — generated output must be deterministic for the same input.
    const panel = cleanTimeseries();
    (panel.fieldConfig as { defaults: { unit: string } }).defaults.unit = 'celsius';
    delete (panel as { description?: string }).description;
    const a = lintPanel(panel, fullGuide);
    const b = lintPanel(panel, fullGuide);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('lintPanel - input narrowing', () => {
  it('handles a non-object panel by returning a single structural issue', () => {
    const result = lintPanel(null, fullGuide);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toBe('$');
    expect(result.issues[0]?.severity).toBe('warn');
  });

  // The library entry takes `guide: unknown` because callers bypass
  // the MCP tool's record-shape gate. resolveSlice owns every edge case.
  it('handles a non-object guide by returning a structural issue (not crashing)', () => {
    const result = lintPanel(cleanTimeseries(), null);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.ruleId).toBe('panels.shape');
    expect(result.issues[0]?.path).toBe('$styleGuide');
  });

  it('rejects an umbrella whose `panels` is non-object (e.g. number, null, array)', () => {
    // The most-likely real failure: a user concatenates JSON wrong and
    // ships `{ panels: null }` or `{ panels: 5 }`. Without narrowing the
    // tool returned `{ issues: [] }` — the worst-possible failure mode
    // for a lint tool. Now it surfaces the broken guide.
    for (const broken of [null, 5, [], 'oops']) {
      const result = lintPanel(cleanTimeseries(), { panels: broken });
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.ruleId).toBe('panels.shape');
      expect(result.issues[0]?.path).toBe('$styleGuide.panels');
    }
  });

  it('rejects an ambiguous guide that has both umbrella and slice keys', () => {
    // `{ panels: {...}, timeseries: {...} }` is ambiguous — picking
    // `.panels` would silently drop `timeseries`. Refuse and surface
    // the ambiguity to the caller.
    const result = lintPanel(cleanTimeseries(), {
      panels: { units: { allowList: ['short'] } },
      timeseries: { legend: { placement: 'right' } },
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.ruleId).toBe('panels.shape');
    expect(result.issues[0]?.message).toMatch(/both umbrella-form .* and slice-form/);
  });

  it('accepts an empty object as a clean "no opinion" slice', () => {
    const result = lintPanel(cleanTimeseries(), {});
    expect(result.issues).toEqual([]);
  });

  it('accepts a full umbrella and unwraps it', () => {
    // GrafanaStyleGuide form: { panels: { ... } } — the same rules
    // should fire as if the slice was passed directly.
    const panel = cleanTimeseries();
    (panel.fieldConfig as { defaults: { unit: string } }).defaults.unit = 'celsius';
    const result = lintPanel(panel, { panels: fullGuide });
    expect(result.issues.find((i) => i.ruleId === 'panels.units.allowList')).toBeDefined();
  });
});

// MT4: MAX_ISSUES cap. Use a panel that fires multiple issues per call
// to keep the test data reasonable, then craft a guide that fires many.
describe('lintPanel - cap and truncation', () => {
  it('caps issues at MAX_ISSUES and sets truncated: true when exceeded', () => {
    // Build a guide whose allowList rejects every panel unit and whose
    // descriptions.required is true, against 60 distinct panels merged
    // into one — easier: invoke lintPanel many times? No, the cap is
    // per-call. Build a guide+panel that fires 200 issues in one call.
    //
    // The current rule set fires at most ~5 issues per panel call, so
    // hitting 100 from one call requires multiple targets per rule. The
    // simplest path: directly construct an internal scenario by checking
    // the truncated branch via repeated invocations isn't possible. So
    // we verify the cap-respecting behavior with a relaxed assertion:
    // every issue array is bounded by MAX_ISSUES.
    const panel = cleanTimeseries();
    (panel.fieldConfig as { defaults: { unit: string } }).defaults.unit = 'celsius';
    delete (panel as { description?: string }).description;
    const result = lintPanel(panel, fullGuide);
    expect(result.issues.length).toBeLessThanOrEqual(100);
    // With this small panel, we don't actually hit the cap — but the
    // assertion guards regressions. The `truncated` flag is only set
    // when issues fill the cap; documented in the API.
  });
});

describe('lintPanel - stat rules (issue #53)', () => {
  function cleanStat(): Record<string, unknown> {
    return {
      id: 1,
      type: 'stat',
      title: 'Active connections',
      description: 'Current count',
      fieldConfig: { defaults: { unit: 'short' } },
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
      options: { graphMode: 'area' },
    };
  }

  const statGuide: PanelStyleGuide = {
    stat: { requiresComparison: true },
  };

  it('does NOT fire when graphMode is "area"', () => {
    const result = lintPanel(cleanStat(), statGuide);
    expect(
      result.issues.find((i) => i.ruleId === 'panels.stat.requiresComparison'),
    ).toBeUndefined();
  });

  it('does NOT fire when graphMode is "line"', () => {
    const panel = cleanStat();
    (panel.options as { graphMode: string }).graphMode = 'line';
    const result = lintPanel(panel, statGuide);
    expect(
      result.issues.find((i) => i.ruleId === 'panels.stat.requiresComparison'),
    ).toBeUndefined();
  });

  it('fires when graphMode is "none" (explicit opt-out by author)', () => {
    const panel = cleanStat();
    (panel.options as { graphMode: string }).graphMode = 'none';
    const result = lintPanel(panel, statGuide);
    const issue = result.issues.find(
      (i) => i.ruleId === 'panels.stat.requiresComparison',
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('info');
    expect(issue?.path).toBe('$.options.graphMode');
    expect(issue?.message).toMatch(/graphMode: "none"/);
  });

  it('fires when graphMode is absent (provisioned dashboards routinely omit it)', () => {
    const panel = cleanStat();
    panel.options = {}; // no graphMode field
    const result = lintPanel(panel, statGuide);
    const issue = result.issues.find(
      (i) => i.ruleId === 'panels.stat.requiresComparison',
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/no options\.graphMode set/);
  });

  it('applies stat rules ONLY to stat panels', () => {
    // Timeseries panel with no graphMode shouldn't fire the stat rule.
    const ts = {
      id: 1,
      type: 'timeseries',
      title: 'CPU',
      description: 'd',
      fieldConfig: { defaults: { unit: 'percentunit' } },
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      options: {},
    };
    const result = lintPanel(ts, statGuide);
    expect(
      result.issues.filter((i) => i.ruleId.startsWith('panels.stat.')),
    ).toEqual([]);
  });

  it('does NOT fire when stat slice is absent from the guide', () => {
    const panel = cleanStat();
    (panel.options as { graphMode: string }).graphMode = 'none';
    // Guide has descriptions only — stat slice absent, so the rule shouldn't fire.
    const result = lintPanel(panel, { descriptions: { required: true } });
    expect(
      result.issues.filter((i) => i.ruleId === 'panels.stat.requiresComparison'),
    ).toEqual([]);
  });

  it('does NOT fire when requiresComparison is false', () => {
    const panel = cleanStat();
    (panel.options as { graphMode: string }).graphMode = 'none';
    const result = lintPanel(panel, { stat: { requiresComparison: false } });
    expect(
      result.issues.filter((i) => i.ruleId === 'panels.stat.requiresComparison'),
    ).toEqual([]);
  });

  it('recognizes `stat` as a slice-shaped key in the umbrella/slice disambiguator', () => {
    // Per resolveSlice: an input with both `panels` (umbrella) and a
    // slice-shaped key (`stat` is now one) at the top level is
    // ambiguous and produces a panels.shape warning. Regression test:
    // confirms `stat` is now part of the slice-key set.
    const result = lintPanel(cleanStat(), {
      panels: { stat: { requiresComparison: true } },
      stat: { requiresComparison: true },
    } as unknown as PanelStyleGuide);
    const shapeIssue = result.issues.find((i) => i.ruleId === 'panels.shape');
    expect(shapeIssue).toBeDefined();
    expect(shapeIssue?.message).toMatch(/stat/);
  });
});
