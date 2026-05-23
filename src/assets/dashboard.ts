import { DashboardBuilder } from '@grafana/grafana-foundation-sdk/dashboard';
import type * as cog from '@grafana/grafana-foundation-sdk/cog';
import type * as dashboard from '@grafana/grafana-foundation-sdk/dashboard';

import { asNumber, asString, deepClone, walkPanelsDeep } from './_internal.js';

export type PanelInput =
  | cog.Builder<dashboard.Panel>
  | cog.Builder<dashboard.RowPanel>
  | dashboard.Panel
  | dashboard.RowPanel;

export interface BuildDashboardInput {
  title: string;
  panels?: PanelInput[] | undefined;
  /**
   * Dashboard tags (Grafana's native `tags[]`). Used for foldering /
   * search and as the opt-in signal some lint rules key on — e.g.
   * `dashboards.layout.firstRowCategorical` with
   * `{ overviewTag: 'overview' }` only fires on dashboards tagged
   * accordingly. Omit for no tags.
   */
  tags?: string[] | undefined;
}

function isCogBuilder<T>(input: unknown): input is cog.Builder<T> {
  return (
    input !== null &&
    typeof input === 'object' &&
    typeof (input as { build?: unknown }).build === 'function'
  );
}

/**
 * Wraps a pre-built panel (or row panel) JSON object as a
 * `cog.Builder<T>` for the SDK's `withPanel()` / `withRow()` API.
 * Deep-clones the panel so the SDK's downstream mutation of `gridPos`
 * (and our own id-assignment pass) doesn't reach back into the caller's
 * input. Mirrors the immutability discipline of `insertPanel` /
 * `updatePanel`. Pre-built builders are returned as-is — they own their
 * own internal state and the SDK mutates it intentionally.
 */
function toBuilder<T>(input: cog.Builder<T> | T): cog.Builder<T> {
  if (isCogBuilder<T>(input)) {
    return input;
  }
  const panel = deepClone(input);
  return { build: () => panel };
}

/**
 * Returns true if a panel input is row-shaped (`type === 'row'`). Used
 * to route the input through `DashboardBuilder.withRow` (full-width,
 * one-line layout) rather than `withPanel` (12×8 grid layout). The SDK's
 * `withPanel` would assign panel-shaped gridPos to a row, producing an
 * oddly-tall section header.
 */
function isRowInput(input: PanelInput): input is cog.Builder<dashboard.RowPanel> | dashboard.RowPanel {
  if (isCogBuilder<dashboard.Panel | dashboard.RowPanel>(input)) {
    // The SDK's RowBuilder pre-initialises `internal.type = 'row'`; check
    // without calling .build() (which would create a duplicate panel
    // resource that the SDK then pushes into the dashboard).
    const internal = (input as unknown as { internal?: unknown }).internal;
    return asString((internal as Record<string, unknown> | undefined)?.type) === 'row';
  }
  return asString((input as unknown as Record<string, unknown>).type) === 'row';
}

/**
 * Assigns sequential integer ids to panels missing a valid one (also
 * walks legacy row-nested children). A panel "needs an id" when its
 * existing `id` is:
 *   - `undefined` (the Foundation SDK's omitted-by-design case);
 *   - the numeric value `0` (the SDK's default-init value, which
 *     Grafana's UI treats as unassigned);
 *   - a non-numeric value (e.g. `id: "foo"`) — Grafana's schema
 *     requires integer ids, so a string id is invalid input and is
 *     overwritten with a fresh integer rather than silently passed
 *     through to fail validation later. Explicit numeric ids ≥ 1
 *     are preserved.
 *
 * Required for the build → validate round-trip: `validateDashboard`
 * rejects panels missing `id` (Grafana schema), but the Foundation SDK's
 * `PanelBuilder` intentionally omits id — ids are dashboard-scoped, not
 * panel-scoped. Without this pass every freshly-built dashboard fails
 * validation on every panel.
 *
 * Mirrors `insertPanel`'s `nextFreePanelId` so the build path and the
 * insert path agree on id-assignment semantics.
 */
function assignMissingIds(built: dashboard.Dashboard): void {
  const panels = built.panels;
  if (!Array.isArray(panels)) return;

  let max = 0;
  for (const panel of walkPanelsDeep(panels)) {
    const id = asNumber(panel.id);
    if (id !== undefined && id > max) max = id;
  }
  let next = max + 1;
  for (const panel of walkPanelsDeep(panels)) {
    const numericId = asNumber(panel.id);
    if (numericId === undefined || numericId === 0) {
      panel.id = next;
      next++;
    }
  }
}

/**
 * Builds a Grafana `Dashboard` from a title and an optional array of
 * panel inputs (pre-built JSON or SDK panel builders). Pre-built panels
 * are deep-cloned so the input is never mutated. Panels missing a
 * numeric `id` (or carrying `id: 0`) are auto-assigned sequential
 * integer ids starting at `max(existing ids) + 1`, matching
 * `insertPanel`'s `nextFreePanelId`. Output passes `validateDashboard`
 * without manual id wiring.
 */
/**
 * Ensures a row panel has a `panels[]` array. The SDK's
 * `DashboardBuilder.withRow` does `rowPanelResource.panels.forEach(...)`
 * unconditionally, so a bare `{type:'row', title:'X'}` input — entirely
 * legal Grafana JSON — would crash with `TypeError: Cannot read
 * properties of undefined`. This guard tolerates the missing field
 * (Grafana itself populates an empty array on import).
 */
function ensureRowShape(row: dashboard.RowPanel): dashboard.RowPanel {
  const asDict = row as unknown as Record<string, unknown>;
  if (!Array.isArray(asDict.panels)) {
    asDict.panels = [];
  }
  return row;
}

export function buildDashboard(input: BuildDashboardInput): dashboard.Dashboard {
  const builder = new DashboardBuilder(input.title);
  if (input.tags !== undefined) builder.tags(input.tags);
  for (const panel of input.panels ?? []) {
    if (isRowInput(panel)) {
      const rowBuilder = toBuilder<dashboard.RowPanel>(panel);
      builder.withRow({ build: () => ensureRowShape(rowBuilder.build()) });
    } else {
      builder.withPanel(toBuilder<dashboard.Panel>(panel));
    }
  }
  const built = builder.build();
  assignMissingIds(built);
  return built;
}
