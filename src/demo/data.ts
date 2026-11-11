import { addDays } from "../../core/healthClient";

/**
 * Synthetic health data for the demo (S6). Every value is generated: nothing
 * comes from a real account. Values are seeded by date, so a day looks the same
 * on every load and every chart agrees with every other.
 */

export const DEMO_EMAIL = "demo@example.com";
export const DEMO_CLIENT_ID = "000000000000-demo.apps.googleusercontent.com";
export const DEMO_USER_ID = "0000000000";
/** How far back data exists (the 3M view plus its 30-day baseline, and some history to page back through). */
export const DEMO_DAYS = 365;

// ── Seeded randomness ───────────────────────────────────────────────────────
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** mulberry32: a small deterministic PRNG. */
export function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Dates ───────────────────────────────────────────────────────────────────
export const localDate = (d = new Date()) => d.toLocaleDateString("en-CA");
/** A local wall-clock time on a date, as a Date. */
export const at = (date: string, minutes: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setMinutes(minutes);
  return d;
};
export const offsetOf = (d: Date) => `${-d.getTimezoneOffset() * 60}s`;
export const daysAgo = (date: string) => Math.round((Date.parse(`${localDate()}T12:00:00`) - Date.parse(`${date}T12:00:00`)) / 86_400_000);
const minutesNow = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};
/** Share of the day that has passed (1 for past days), so today's totals grow through the day. */
const dayFrac = (date: string) => (date === localDate() ? Math.max(0.05, minutesNow() / 1440) : 1);
export const inRange = (date: string) => daysAgo(date) >= 0 && daysAgo(date) < DEMO_DAYS;

// ── Daily activity, heart and body ───────────────────────────────────────────
export interface DemoDay {
  steps: number;
  distanceMm: number;
  floors: number;
  azm: { fatBurn: number; cardio: number; peak: number };
  active: { light: number; moderate: number; vigorous: number };
  kcalOut: number;
  hr: { avg: number; min: number; max: number };
  restingHr: number;
  weightG?: number;
  bodyFatPct?: number;
  waterMl: number;
}

export function day(date: string): DemoDay {
  const r = rng(`day:${date}`);
  const f = dayFrac(date);
  const weekend = [0, 6].includes(new Date(`${date}T12:00:00`).getDay());
  const workout = exercise(date);
  const steps = Math.round((weekend ? between(r, 4500, 12000) : between(r, 6500, 11500)) * f + (workout?.steps ?? 0));
  const ago = daysAgo(date);
  const fatBurn = Math.round(between(r, 6, 24) * f) + (workout ? Math.round(workout.minutes * 0.4) : 0);
  const cardio = Math.round(between(r, 0, 10) * f) + (workout ? Math.round(workout.minutes * 0.45) : 0);
  const peak = workout?.type === "RUNNING" ? Math.round(between(r, 2, 9)) : 0;
  const moderate = Math.round(between(r, 8, 30) * f) + (workout ? Math.round(workout.minutes * 0.5) : 0);
  const vigorous = Math.round(between(r, 0, 8) * f) + (workout ? Math.round(workout.minutes * 0.4) : 0);
  const weighed = date !== localDate() || minutesNow() > 7 * 60 + 30;
  return {
    steps,
    distanceMm: Math.round(steps * between(r, 720, 790)),
    floors: Math.round(between(r, 4, 16) * f),
    azm: { fatBurn, cardio, peak },
    active: { light: Math.round(between(r, 150, 260) * f), moderate, vigorous },
    kcalOut: Math.round(1680 * f + steps * 0.042 + (moderate + vigorous) * 5),
    hr: { avg: Math.round(between(r, 66, 76)), min: Math.round(between(r, 49, 56)), max: Math.round(workout ? between(r, 145, 172) : between(r, 112, 135)) },
    // A slow improvement over the year, plus day-to-day noise.
    restingHr: Math.round(55 + ago * 0.006 + Math.sin(ago / 9) * 1.2 + between(r, -1.5, 1.5)),
    ...(weighed && r() < 0.7
      ? { weightG: Math.round((71.8 + ago * 0.004 + Math.sin(ago / 6) * 0.25 + between(r, -0.35, 0.35)) * 1000), bodyFatPct: round1(21.5 + ago * 0.006 + between(r, -0.3, 0.3)) }
      : {}),
    waterMl: Math.round(between(r, 1400, 2600) * f / 50) * 50,
  };
}

// ── Recovery vitals (S1): one overnight record per day ───────────────────────
export interface DemoVitals { hrvMs: number; spo2: { avg: number; lo: number; hi: number }; breathing: number; skinC: number; skinBaseC: number; vo2Max: number; fitness: string }

/** Vitals for the night ending on `date` (null before that morning, like the sleep they come from). */
export function vitals(date: string): DemoVitals | null {
  if (!night(date)) return null;
  const r = rng(`vitals:${date}`);
  const ago = daysAgo(date);
  const avg = round1(between(r, 95.4, 97.8));
  const vo2Max = round1(44.5 - ago * 0.006 + between(r, -0.4, 0.4));
  return {
    hrvMs: Math.round(42 - ago * 0.01 + Math.sin(ago / 7) * 4 + between(r, -6, 6)),
    spo2: { avg, lo: round1(avg - between(r, 2, 4)), hi: round1(Math.min(100, avg + between(r, 1, 2))) },
    breathing: round1(between(r, 13.6, 15.4)),
    skinC: Math.round((33.8 + between(r, -0.35, 0.35)) * 100) / 100,
    skinBaseC: 33.8,
    vo2Max,
    fitness: vo2Max >= 46 ? "VERY_GOOD" : vo2Max >= 42 ? "GOOD" : "AVERAGE",
  };
}

// ── Exercise (about three sessions a week) ────────────────────────────────────
export interface DemoExercise {
  type: "RUNNING" | "WALKING" | "BIKING" | "WEIGHTLIFTING";
  name: string;
  startMin: number;
  minutes: number;
  steps: number;
  distanceMm?: number;
  kcal: number;
  avgHr: number;
}

export function exercise(date: string): DemoExercise | null {
  const r = rng(`ex:${date}`);
  const dow = new Date(`${date}T12:00:00`).getDay();
  const planned = [1, 3, 6].includes(dow) ? r() < 0.85 : r() < 0.15;
  if (!planned) return null;
  const pick = r();
  const type = pick < 0.45 ? "RUNNING" : pick < 0.7 ? "BIKING" : pick < 0.85 ? "WALKING" : "WEIGHTLIFTING";
  const startMin = Math.round(dow === 6 ? between(r, 8 * 60, 10 * 60) : between(r, 17 * 60 + 30, 19 * 60));
  const minutes = Math.round(type === "WALKING" ? between(r, 35, 60) : type === "WEIGHTLIFTING" ? between(r, 40, 55) : between(r, 25, 50));
  if (date === localDate() && minutesNow() < startMin + minutes) return null;
  const pace = { RUNNING: 0.17, BIKING: 0.4, WALKING: 0.09, WEIGHTLIFTING: 0 }[type]; // km per minute
  const km = minutes * pace * between(r, 0.9, 1.1);
  return {
    type,
    name: { RUNNING: "Run", BIKING: "Bike", WALKING: "Walk", WEIGHTLIFTING: "Weights" }[type],
    startMin,
    minutes,
    steps: type === "RUNNING" ? Math.round(minutes * 160) : type === "WALKING" ? Math.round(minutes * 110) : 0,
    distanceMm: km ? Math.round(km * 1e6) : undefined,
    kcal: Math.round(minutes * { RUNNING: 11, BIKING: 8.5, WALKING: 5, WEIGHTLIFTING: 6 }[type]),
    avgHr: Math.round({ RUNNING: 152, BIKING: 138, WALKING: 108, WEIGHTLIFTING: 118 }[type] + between(r, -6, 6)),
  };
}

// ── Sleep: one main night ending on each date ─────────────────────────────────
export type Stage = "AWAKE" | "LIGHT" | "DEEP" | "REM";

/** The night that ends on the morning of `wakeDate`, or null if that morning hasn't come yet. */
export function night(wakeDate: string): { bed: Date; spans: [Stage, number][] } | null {
  const r = rng(`sleep:${wakeDate}`);
  const weekendMorning = [0, 6].includes(new Date(`${wakeDate}T12:00:00`).getDay());
  const bed = at(addDays(wakeDate, -1), Math.round(between(r, 22 * 60 + 10, 23 * 60 + 50) + (weekendMorning ? 25 : 0)));
  const spans: [Stage, number][] = [["AWAKE", Math.round(between(r, 4, 18))]];
  const cycles = r() < 0.25 ? 4 : 5;
  for (let c = 0; c < cycles; c++) {
    const early = c < 2;
    spans.push(["LIGHT", Math.round(between(r, 18, 38))]);
    spans.push(["DEEP", Math.round(early ? between(r, 22, 50) : between(r, 0, 14))]);
    spans.push(["LIGHT", Math.round(between(r, 8, 20))]);
    spans.push(["REM", Math.round(early ? between(r, 8, 20) : between(r, 22, 42))]);
    if (c < cycles - 1) spans.push(["AWAKE", r() < 0.2 ? Math.round(between(r, 6, 16)) : Math.round(between(r, 0, 4))]);
  }
  spans.push(["AWAKE", Math.round(between(r, 2, 7))]);
  const kept = spans.filter(([, m]) => m > 0);
  const end = bed.getTime() + kept.reduce((a, [, m]) => a + m, 0) * 60_000;
  if (end > Date.now()) return null;
  return { bed, spans: kept };
}

// ── Food ─────────────────────────────────────────────────────────────────────
/** Generic dishes with rounded reference values (not anyone's log). */
interface Dish { name: string; kcal: number; p: number; c: number; f: number }
const MENU: Record<"BREAKFAST" | "LUNCH" | "DINNER" | "SNACK", Dish[]> = {
  BREAKFAST: [
    { name: "Oatmeal with berries", kcal: 320, p: 10, c: 56, f: 7 },
    { name: "Yogurt and granola", kcal: 290, p: 18, c: 38, f: 8 },
    { name: "Scrambled eggs and toast", kcal: 380, p: 22, c: 28, f: 20 },
    { name: "Peanut butter toast", kcal: 340, p: 12, c: 34, f: 17 },
  ],
  LUNCH: [
    { name: "Turkey sandwich", kcal: 450, p: 30, c: 45, f: 15 },
    { name: "Chicken salad", kcal: 420, p: 35, c: 18, f: 22 },
    { name: "Lentil soup", kcal: 310, p: 18, c: 48, f: 5 },
    { name: "Burrito bowl", kcal: 620, p: 32, c: 75, f: 20 },
  ],
  DINNER: [
    { name: "Salmon, rice and broccoli", kcal: 640, p: 40, c: 60, f: 24 },
    { name: "Pasta with tomato sauce", kcal: 580, p: 20, c: 92, f: 14 },
    { name: "Tofu and vegetable stir-fry", kcal: 480, p: 24, c: 50, f: 20 },
    { name: "Bean chili", kcal: 520, p: 30, c: 62, f: 15 },
  ],
  SNACK: [
    { name: "Apple", kcal: 95, p: 0.5, c: 25, f: 0.3 },
    { name: "Almonds", kcal: 165, p: 6, c: 6, f: 14 },
    { name: "Protein bar", kcal: 200, p: 20, c: 22, f: 7 },
    { name: "Cheese and crackers", kcal: 230, p: 9, c: 18, f: 13 },
  ],
};

export interface DemoMeal { id: string; mealType: keyof typeof MENU | "ANYTIME"; time: Date; dish: Dish; scale: number; fromOtherApp: boolean }

/** The day's logged meals (only those already eaten, for today). */
export function meals(date: string): DemoMeal[] {
  const r = rng(`food:${date}`);
  const plan: [keyof typeof MENU, number, number][] = [["BREAKFAST", 7 * 60, 9 * 60], ["LUNCH", 12 * 60, 13 * 60 + 30], ["SNACK", 15 * 60, 16 * 60 + 30], ["DINNER", 18 * 60, 20 * 60]];
  const out: DemoMeal[] = [];
  plan.forEach(([meal, lo, hi], i) => {
    const skip = meal === "SNACK" ? r() < 0.35 : r() < 0.04;
    const options = MENU[meal];
    const dish = options[Math.floor(r() * options.length)]!;
    const time = at(date, Math.round(between(r, lo, hi)));
    const scale = round1(between(r, 0.85, 1.25));
    const fromOtherApp = r() < 0.12;
    if (skip || time.getTime() > Date.now()) return;
    // An entry logged in another app has no meal type ("ANYTIME"); the app places it by time.
    out.push({ id: `d${date.replace(/-/g, "")}m${i}`, mealType: fromOtherApp ? "ANYTIME" : meal, time, dish, scale, fromOtherApp });
  });
  return out;
}

export const scaled = (m: DemoMeal) => ({
  kcal: Math.round(m.dish.kcal * m.scale),
  p: round1(m.dish.p * m.scale),
  c: round1(m.dish.c * m.scale),
  f: round1(m.dish.f * m.scale),
});

// ── "My foods" (private foods in Google Health) and units ─────────────────────
export const UNITS: Record<string, { displayName: string; pluralDisplayName: string }> = {
  "1": { displayName: "cup", pluralDisplayName: "cups" },
  "2": { displayName: "gram", pluralDisplayName: "grams" },
  "3": { displayName: "slice", pluralDisplayName: "slices" },
  "4": { displayName: "container", pluralDisplayName: "containers" },
  "5": { displayName: "medium", pluralDisplayName: "medium" },
};
export const unitName = (id: string) => `users/me/dataTypes/food-measurement-unit/dataPoints/${id}`;

/** Nutrition per default serving; `servings` = unit id → default servings per one unit. */
export interface DemoFood { id: string; name: string; unit: string; kcal: number; p: number; c: number; f: number; servings: Record<string, number> }
export const FOODS: DemoFood[] = [
  { id: "101", name: "Rolled oats, cooked", unit: "1", kcal: 166, p: 6, c: 28, f: 3.6, servings: { "1": 1, "2": 1 / 234 } },
  { id: "102", name: "Plain yogurt", unit: "4", kcal: 150, p: 15, c: 10, f: 5, servings: { "4": 1, "2": 1 / 170 } },
  { id: "103", name: "Whole wheat bread", unit: "3", kcal: 80, p: 4, c: 14, f: 1, servings: { "3": 1, "2": 1 / 32 } },
  { id: "104", name: "Banana", unit: "5", kcal: 105, p: 1.3, c: 27, f: 0.4, servings: { "5": 1, "2": 1 / 118 } },
];
export const foodName = (id: string) => `users/me/dataTypes/food/dataPoints/${id}`;

// ── Open Food Facts (synthetic products; barcodes in the 200 in-store range, so never a real product) ─
export interface DemoProduct { code: string; name: string; brand: string; servingG: number; per100: { kcal: number; p: number; c: number; f: number } }
export const PRODUCTS: DemoProduct[] = [
  { code: "2000000000015", name: "Greek-style yogurt", brand: "Demo Dairy", servingG: 150, per100: { kcal: 73, p: 8, c: 10.7, f: 0 } },
  { code: "2000000000022", name: "Granola", brand: "Demo Pantry", servingG: 45, per100: { kcal: 450, p: 10, c: 64, f: 17 } },
  { code: "2000000000039", name: "Oat drink", brand: "Demo Dairy", servingG: 250, per100: { kcal: 46, p: 1, c: 6.6, f: 1.5 } },
  { code: "2000000000046", name: "Peanut butter", brand: "Demo Pantry", servingG: 32, per100: { kcal: 590, p: 25, c: 20, f: 50 } },
  { code: "2000000000053", name: "Whole wheat pasta", brand: "Demo Pantry", servingG: 85, per100: { kcal: 350, p: 14, c: 68, f: 2.5 } },
  { code: "2000000000060", name: "Dark chocolate", brand: "Demo Sweets", servingG: 25, per100: { kcal: 560, p: 8, c: 45, f: 40 } },
];
