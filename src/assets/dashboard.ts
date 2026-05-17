import { DashboardBuilder } from '@grafana/grafana-foundation-sdk/dashboard';
import type * as cog from '@grafana/grafana-foundation-sdk/cog';
import type * as dashboard from '@grafana/grafana-foundation-sdk/dashboard';

import { asNumber, deepClone, walkPanelsDeep } from './_internal.js';

export type PanelInput = cog.Builder<dashboard.Panel> | dashboard.Panel;

export interface BuildDashboardInput {
  title: string;
  panels?: PanelInput[] | undefined;
}

/**
 * Wraps a pre-built panel JSON object as a `cog.Builder<Panel>` for the
 * SDK's `withPanel()` API. Deep-clones the panel so the SDK's downstream
 * mutation of `gridPos` (and our own id-assignment pass) doesn't reach
 * back into the caller's input. Mirrors the immutability discipline of
 * `insertPanel` / `updatePanel`.
 */
function toPanelBuilder(input: PanelInput): cog.Builder<dashboard.Panel> {
  if (typeof (input as cog.Builder<dashboard.Panel>).build === 'function') {
    return input as cog.Builder<dashboard.Panel>;
  }
  const panel = deepClone(input as dashboard.Panel);
  return { build: () => panel };
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
export function buildDashboard(input: BuildDashboardInput): dashboard.Dashboard {
  const builder = new DashboardBuilder(input.title);
  for (const panel of input.panels ?? []) {
    builder.withPanel(toPanelBuilder(panel));
  }
  const built = builder.build();
  assignMissingIds(built);
  return built;
}
