/**
 * Today page layout: which cards appear, in what order, in each section.
 * Shared by the server (validation, app.db storage) and the UI (card registry).
 *
 * The "today" grid has 12 slots: 4 columns × 3 rows on wide screens, 2 × 6 on
 * narrow ones. Most cards fill one slot; the steps ring fills three stacked
 * vertically (so a narrow column holds the ring plus three cards). The "week"
 * grid holds up to 12 cards.
 */
export const METRIC_IDS = [
  "stepsRing",
  "steps", "distance", "floors", "activeZoneMinutes", "activeMinutes", "caloriesBurned", "workouts",
  "caloriesEaten", "carbs", "fat", "protein", "fiber", "water",
  "heartRate", "restingHeartRate",
  "hrv", "spo2", "breathingRate", "skinTemp", "vo2Max",
  "sleep", "sleepSchedule", "deepSleep", "remSleep",
  "weight", "bodyFat",
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export type LayoutSection = "today" | "week";
export interface TodayLayout {
  today: MetricId[];
  week: MetricId[];
}

/** Slots per section (today counts slots, so the ring uses 3; week counts cards). */
export const LAYOUT_LIMITS: Record<LayoutSection, number> = { today: 12, week: 12 };

/** Slots a card occupies in the "today" grid. */
export const slotSize = (id: MetricId): number => (id === "stepsRing" ? 3 : 1);
export const slotsUsed = (section: LayoutSection, ids: MetricId[]) =>
  section === "today" ? ids.reduce((t, id) => t + slotSize(id), 0) : ids.length;

/** What each section can show (the ring is a single-day view; bedtime has no useful week trend). */
export const SECTION_SUPPORT: Record<LayoutSection, ReadonlySet<MetricId>> = {
  today: new Set(METRIC_IDS),
  week: new Set(METRIC_IDS.filter((id) => id !== "sleepSchedule" && id !== "stepsRing")),
};

/** Layout schema version: v2 made the steps ring a movable card. */
export const LAYOUT_VERSION = 2;

/** The layout before any customization (the ring plus the original eight tiles). */
export const DEFAULT_LAYOUT: TodayLayout = {
  today: ["stepsRing", "heartRate", "sleep", "caloriesEaten", "caloriesBurned", "carbs", "protein", "activeZoneMinutes", "weight"],
  week: ["steps", "sleep", "restingHeartRate", "caloriesBurned", "caloriesEaten", "activeZoneMinutes", "protein", "floors", "weight", "workouts"],
};

const isMetric = (v: unknown): v is MetricId => typeof v === "string" && (METRIC_IDS as readonly string[]).includes(v);

/** Validate an untrusted layout. Returns an error message, or null if valid. */
export function layoutError(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Send the layout as a JSON object";
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (k !== "today" && k !== "week") return `Unknown section: ${k}`;
  for (const section of ["today", "week"] as const) {
    const list = b[section];
    if (!Array.isArray(list)) return `${section} must be a list of card ids`;
    const seen = new Set<string>();
    for (const id of list) {
      if (!isMetric(id)) return `Unknown card: ${String(id)}`;
      if (!SECTION_SUPPORT[section].has(id)) return `${id} can't be shown in ${section}`;
      if (seen.has(id)) return `${id} appears twice in ${section}`;
      seen.add(id);
    }
    if (slotsUsed(section, list as MetricId[]) > LAYOUT_LIMITS[section]) return `${section} has room for ${LAYOUT_LIMITS[section]} ${section === "today" ? "slots" : "cards"}`;
  }
  return null;
}
