import { FoodInputError } from "./errors.js";
import { platform } from "./platform.js";
import { DEFAULT_GOALS, GOAL_LIMITS, type Goals } from "../shared/goals.js";

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
    if (key === "sleepMinutes" && v === null) {
      next.sleepMinutes = null;
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
