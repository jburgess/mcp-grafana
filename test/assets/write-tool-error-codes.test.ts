/**
 * Error-code contract for the five write tools (insertPanel,
 * updatePanel, movePanel, removePanel, renameVariable).
 *
 * Closes team-retrospective gap #4 part 2: the write tools shipped
 * with structured `errors[]` but no `code` field — an LLM reading the
 * result had to parse the message string to discriminate failure
 * modes. Adding a stable `code` lets clients branch on the failure
 * mode directly. Codes are additive (new modes get new codes); the
 * `code` field is optional on `ValidationError` because the
 * validate-axis paths don't populate it today.
 *
 * Each test exercises one error site, asserts the code AND the path
 * (path is the existing API surface; codes are new). Codes must not
 * shift between releases — they're part of the public contract.
 */

import { describe, expect, it } from 'vitest';

import { insertPanel } from '../../src/assets/insert.js';
import { updatePanel } from '../../src/assets/update.js';
import { movePanel } from '../../src/assets/move.js';
import { removePanel } from '../../src/assets/remove.js';
import { renameVariable } from '../../src/assets/rename.js';

const validDashboard = {
  title: 'd',
  panels: [{ id: 1, type: 'timeseries', title: 'X' }],
};

describe('insertPanel error codes', () => {
  it('non-object dashboard → code: dashboard-not-object', () => {
    const r = insertPanel('not-an-object', { type: 'timeseries' });
    expect(r.errors[0]?.code).toBe('dashboard-not-object');
    expect(r.errors[0]?.path).toBe('$');
  });

  it('non-object panel → code: panel-not-object', () => {
    const r = insertPanel({ title: 'd' }, 'not-an-object');
    expect(r.errors[0]?.code).toBe('panel-not-object');
    expect(r.errors[0]?.path).toBe('panel');
  });

  it('after: unknown panelId → code: panel-not-found', () => {
    const r = insertPanel(
      validDashboard,
      { type: 'timeseries' },
      { mode: 'after', panelId: 999 },
    );
    expect(r.errors[0]?.code).toBe('panel-not-found');
    expect(r.errors[0]?.path).toBe('position.panelId');
  });

  it('inRow: unknown rowId → code: panel-not-found', () => {
    const r = insertPanel(
      validDashboard,
      { type: 'timeseries' },
      { mode: 'inRow', rowId: 999 },
    );
    expect(r.errors[0]?.code).toBe('panel-not-found');
    expect(r.errors[0]?.path).toBe('position.rowId');
  });

  it('inRow: target is not a row → code: row-not-row', () => {
    // panel id 1 is a timeseries, not a row.
    const r = insertPanel(
      validDashboard,
      { type: 'timeseries' },
      { mode: 'inRow', rowId: 1 },
    );
    expect(r.errors[0]?.code).toBe('row-not-row');
    expect(r.errors[0]?.path).toBe('position.rowId');
  });
});

describe('updatePanel error codes', () => {
  it('non-object dashboard → code: dashboard-not-object', () => {
    const r = updatePanel('x', 1, { title: 'new' });
    expect(r.errors[0]?.code).toBe('dashboard-not-object');
  });

  it('non-object patch → code: patch-not-object', () => {
    const r = updatePanel(validDashboard, 1, 'not-an-object');
    expect(r.errors[0]?.code).toBe('patch-not-object');
    expect(r.errors[0]?.path).toBe('patch');
  });

  it('unknown panelId → code: panel-not-found', () => {
    const r = updatePanel(validDashboard, 999, { title: 'new' });
    expect(r.errors[0]?.code).toBe('panel-not-found');
    expect(r.errors[0]?.path).toBe('panelId');
  });
});

describe('movePanel error codes', () => {
  it('non-object dashboard → code: dashboard-not-object', () => {
    const r = movePanel('x', 1, { mode: 'append' });
    expect(r.errors[0]?.code).toBe('dashboard-not-object');
  });

  it('unknown panelId → code: panel-not-found', () => {
    const r = movePanel(validDashboard, 999, { mode: 'append' });
    expect(r.errors[0]?.code).toBe('panel-not-found');
    expect(r.errors[0]?.path).toBe('panelId');
  });

  it('row into row → code: row-in-row', () => {
    const dashWithRow = {
      title: 'd',
      panels: [
        { id: 1, type: 'row', title: 'A' },
        { id: 2, type: 'row', title: 'B' },
      ],
    };
    const r = movePanel(dashWithRow, 1, { mode: 'inRow', rowId: 2 });
    expect(r.errors[0]?.code).toBe('row-in-row');
  });
});

describe('removePanel error codes', () => {
  it('non-object dashboard → code: dashboard-not-object', () => {
    const r = removePanel('x', 1);
    expect(r.errors[0]?.code).toBe('dashboard-not-object');
  });

  it('unknown panelId → code: panel-not-found', () => {
    const r = removePanel(validDashboard, 999);
    expect(r.errors[0]?.code).toBe('panel-not-found');
    expect(r.errors[0]?.path).toBe('panelId');
  });
});

describe('renameVariable error codes', () => {
  const dashWithVar = {
    title: 'd',
    templating: { list: [{ name: 'env', type: 'query' }] },
    panels: [],
  };

  it('non-object dashboard → code: dashboard-not-object', () => {
    const r = renameVariable('x', 'env', 'environment');
    expect(r.errors[0]?.code).toBe('dashboard-not-object');
  });

  it('unknown oldName → code: variable-not-found', () => {
    const r = renameVariable(dashWithVar, 'nope', 'new');
    expect(r.errors[0]?.code).toBe('variable-not-found');
    expect(r.errors[0]?.path).toBe('templating.list');
  });

  it('newName collides with existing → code: variable-name-collision', () => {
    const dash = {
      title: 'd',
      templating: { list: [{ name: 'a', type: 'query' }, { name: 'b', type: 'query' }] },
      panels: [],
    };
    const r = renameVariable(dash, 'a', 'b');
    expect(r.errors[0]?.code).toBe('variable-name-collision');
  });

  it('newName invalid per Grafana regex → code: variable-name-invalid', () => {
    const r = renameVariable(dashWithVar, 'env', '1bad');
    expect(r.errors[0]?.code).toBe('variable-name-invalid');
  });
});

describe('code field shape', () => {
  it('successful results have errors: [] (no codes to surface)', () => {
    const r = insertPanel(validDashboard, { type: 'timeseries' });
    expect(r.errors).toEqual([]);
  });

  it('code is a stable string (never undefined when an error is present from a write tool)', () => {
    // Spot-check the contract across all 5 tools: every error a write
    // tool returns carries a code. Validates the team-retrospective
    // "every write-tool failure should be machine-discriminable"
    // requirement.
    const samples = [
      insertPanel('x', { type: 'timeseries' }),
      updatePanel('x', 1, {}),
      movePanel('x', 1, { mode: 'append' }),
      removePanel('x', 1),
      renameVariable('x', 'a', 'b'),
    ];
    for (const result of samples) {
      expect(result.errors.length).toBeGreaterThan(0);
      for (const err of result.errors) {
        expect(err.code).toBeTypeOf('string');
        expect((err.code as string).length).toBeGreaterThan(0);
      }
    }
  });
});
