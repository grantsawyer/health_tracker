/**
 * Daily (and weekly) targets. Google Health's API exposes no goals (Settings
 * covers units only), so they're stored by the app per user.
 *
 * Defaults are generic starting points from published references, never from
 * any user's data; each person sets their own on first use:
 * - calories eaten 2,000 kcal; carbs 275 g, fat 78 g, protein 50 g:
 *   the US FDA Daily Values, which assume a 2,000-calorie diet;
 * - 10,000 steps, 10 floors, 22 active zone minutes a day (150 a week):
 *   Fitbit's standard default targets;
 * - calories burned 2,000 kcal and 5 exercise days a week: round placeholders;
 * - sleep: unset.
 */
export interface Goals {
  steps: number;
  activeZoneMinutes: number;
  floors: number;
  caloriesBurned: number;
  caloriesEaten: number;
  carbsG: number;
  fatG: number;
  proteinG: number;
  exerciseDaysPerWeek: number;
  /** Minutes asleep per night; null until the user sets it. */
  sleepMinutes: number | null;
}

export const DEFAULT_GOALS: Goals = {
  steps: 10000,
  activeZoneMinutes: 22,
  floors: 10,
  caloriesBurned: 2000,
  caloriesEaten: 2000,
  carbsG: 275,
  fatG: 78,
  proteinG: 50,
  exerciseDaysPerWeek: 5,
  sleepMinutes: null,
};

/** Upper bounds for validation and form inputs. */
export const GOAL_LIMITS: Record<keyof Goals, number> = {
  steps: 100_000,
  activeZoneMinutes: 600,
  floors: 500,
  caloriesBurned: 10_000,
  caloriesEaten: 10_000,
  carbsG: 1000,
  fatG: 1000,
  proteinG: 1000,
  exerciseDaysPerWeek: 7,
  sleepMinutes: 24 * 60,
};
