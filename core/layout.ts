import { FoodInputError } from "./errors.js";
import { platform } from "./platform.js";
import {
  DEFAULT_LAYOUT, LAYOUT_LIMITS, LAYOUT_VERSION, SECTION_SUPPORT, layoutError, slotSize, type MetricId, type TodayLayout,
} from "../shared/layout.js";

interface Stored extends Partial<TodayLayout> {
  v?: number;
}

/**
 * The Today page's card layout, per user in app.db. A stored layout that no
 * longer validates (e.g. a card id was removed in an update) is cleaned up
 * rather than rejected, so the page always renders. Layouts saved before v2
 * (when the steps ring was fixed, not a card) get the ring added at the front.
 */
export async function getLayout(): Promise<TodayLayout> {
  const stored = await platform().settings.get<Stored>("todayLayout");
  if (!stored) return DEFAULT_LAYOUT;
  const valid = (section: "today" | "week") =>
    [...new Set((stored[section] ?? DEFAULT_LAYOUT[section]).filter((id): id is MetricId => SECTION_SUPPORT[section].has(id as MetricId)))];
  let today = valid("today");
  if ((stored.v ?? 1) < 2 && !today.includes("stepsRing")) today = ["stepsRing", ...today];
  // Trim to the slot budget (the ring counts as three).
  const fitted: MetricId[] = [];
  let used = 0;
  for (const id of today) {
    if (used + slotSize(id) > LAYOUT_LIMITS.today) continue;
    fitted.push(id);
    used += slotSize(id);
  }
  return { today: fitted, week: valid("week").slice(0, LAYOUT_LIMITS.week) };
}

export async function saveLayout(body: unknown): Promise<TodayLayout> {
  const err = layoutError(body);
  if (err) throw new FoodInputError(err);
  const layout = body as TodayLayout;
  await platform().settings.put("todayLayout", { v: LAYOUT_VERSION, today: layout.today, week: layout.week });
  return getLayout();
}

export async function resetLayout(): Promise<TodayLayout> {
  await platform().settings.put("todayLayout", { v: LAYOUT_VERSION, ...DEFAULT_LAYOUT });
  return DEFAULT_LAYOUT;
}
