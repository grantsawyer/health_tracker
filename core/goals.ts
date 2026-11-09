import { FoodInputError } from "./errors.js";
import { platform } from "./platform.js";
import { CLOCK_GOALS, DEFAULT_GOALS, GOAL_LIMITS, OPTIONAL_GOALS, type Goals } from "../shared/goals.js";

/** Goals for the signed-in user: stored values over defaults (new goal keys pick up defaults). */
export async function getGoals(): Promise<Goals> {
  return { ...DEFAULT_GOALS, ...((await platform().settings.get<Partial<Goals>>("goals")) ?? {}) };
}

/** Validate a partial update (unknown keys rejected) and merge it into the stored goals. */
export async function updateGoals(body: unknown): Promise<Goals> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new FoodInputError("Send goals as a JSON object");
  const next: Goals = { ...(await getGoals()) };
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!(k in GOAL_LIMITS)) throw new FoodInputError(`Unknown goal: ${k}`);
    const key = k as keyof Goals;
    if (OPTIONAL_GOALS.has(key) && v === null) {
      (next[key] as number | null) = null;
      continue;
    }
    if (CLOCK_GOALS.has(key)) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > GOAL_LIMITS[key]) {
        throw new FoodInputError(`${k} must be a time of day (whole minutes after midnight, 0–${GOAL_LIMITS[key]})`);
      }
      (next[key] as number) = v;
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > GOAL_LIMITS[key]) {
      throw new FoodInputError(`${k} must be a number between 1 and ${GOAL_LIMITS[key]}`);
    }
    (next[key] as number) = key === "exerciseDaysPerWeek" ? Math.round(v) : v;
  }
  await platform().settings.put("goals", next);
  return next;
}
