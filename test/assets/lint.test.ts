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
});
