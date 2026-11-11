import { addDays } from "../../core/healthClient";
import {
  DEMO_CLIENT_ID, DEMO_DAYS, DEMO_USER_ID, FOODS, PRODUCTS, UNITS, at, day, exercise, foodName, inRange, localDate, meals, night,
  offsetOf, scaled, unitName, vitals, type DemoFood, type DemoProduct,
} from "./data";

/**
 * The demo's network: answers the Google Health API and Open Food Facts in
 * the page, shaped like the live responses (see CLAUDE.md "Google Health API
 * facts"), so the app's real core/ code runs unchanged on synthetic data.
 * Food log changes are kept in memory for this visit only.
 */

type Loose = Record<string, any>;
type Point = Loose & { name: string };

const HEALTH = "https://health.googleapis.com/v4/";
const OFF = "https://world.openfoodfacts.org/";
const ours = { recordingMethod: "UNKNOWN", application: { googleWebClientId: DEMO_CLIENT_ID }, platform: "GOOGLE_WEB_API" };
const otherApp = { recordingMethod: "MANUAL", platform: "FITBIT" };
const full = (me: string) => me.replace(/^users\/me\//, `users/${DEMO_USER_ID}/`);
const asMe = (name: string) => name.replace(/^users\/[^/]+\//, "users/me/");
const civilDate = (d: string) => {
  const [year, month, dayOfMonth] = d.split("-").map(Number);
  return { year, month, day: dayOfMonth };
};
const ymd = (c: { year: number; month: number; day: number }) => `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
/** Local "YYYY-MM-DDTHH:mm" of a UTC time with its offset, as core computes it. */
const civilOf = (startTime: string, offset: string) =>
  new Date(Date.parse(startTime) + Number(offset.replace(/s$/, "")) * 1000).toISOString().slice(0, 16);
const interval = (start: Date, minutes: number) => ({
  startTime: start.toISOString(),
  startUtcOffset: offsetOf(start),
  endTime: new Date(start.getTime() + minutes * 60_000).toISOString(),
  endUtcOffset: offsetOf(start),
});

/** Dates in [from, to) that have demo data. */
function dates(from: string, to: string): string[] {
  const out: string[] = [];
  const first = from > addDays(localDate(), -DEMO_DAYS) ? from : addDays(localDate(), -DEMO_DAYS + 1);
  for (let d = first.slice(0, 10); d < to && d <= localDate(); d = addDays(d, 1)) if (inRange(d)) out.push(d);
  return out;
}

function foodPoint(f: DemoFood, access: "PRIVATE" | "PUBLIC" = "PRIVATE"): Point {
  const unit = UNITS[f.unit]!;
  return {
    name: full(foodName(f.id)),
    food: {
      displayName: f.name,
      accessLevel: `FOOD_ACCESS_LEVEL_${access}`,
      energyAvg: { kcal: f.kcal },
      totalCarbohydrate: { grams: f.c },
      totalFat: { grams: f.f },
      nutrients: [{ nutrient: "PROTEIN", quantity: { grams: f.p } }],
      defaultServing: { amount: 1, foodMeasurementUnit: full(unitName(f.unit)), foodMeasurementUnitDisplayName: unit.displayName, foodMeasurementUnitDisplayNamePlural: unit.pluralDisplayName, multiplier: 1 },
      servings: Object.entries(f.servings).map(([id, multiplier]) => ({
        amount: 1, foodMeasurementUnit: full(unitName(id)), foodMeasurementUnitDisplayName: UNITS[id]!.displayName,
        foodMeasurementUnitDisplayNamePlural: UNITS[id]!.pluralDisplayName, multiplier,
      })),
    },
  };
}

function offProduct(p: DemoProduct, withServing: boolean) {
  const k = p.servingG / 100;
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    code: p.code, product_name: p.name, brands: p.brand,
    ...(withServing ? { serving_size: `1 serving (${p.servingG} g)`, serving_quantity: p.servingG } : {}),
    nutriments: {
      "energy-kcal_100g": p.per100.kcal, proteins_100g: p.per100.p, carbohydrates_100g: p.per100.c, fat_100g: p.per100.f,
      ...(withServing ? { "energy-kcal_serving": r(p.per100.kcal * k), proteins_serving: r(p.per100.p * k), carbohydrates_serving: r(p.per100.c * k), fat_serving: r(p.per100.f * k) } : {}),
    },
  };
}

export function createDemoFetch(): typeof fetch {
  // ── Food log: generated history plus this visit's changes ───────────────
  const logs = new Map<string, Point>(); // keyed by users/me/... name
  for (let i = DEMO_DAYS - 1; i >= 0; i--) {
    for (const m of meals(addDays(localDate(), -i))) {
      const n = scaled(m);
      const name = `users/me/dataTypes/nutrition-log/dataPoints/${m.id}`;
      logs.set(name, {
        name: full(name),
        dataSource: m.fromOtherApp ? otherApp : ours,
        nutritionLog: {
          interval: interval(m.time, 1),
          mealType: m.mealType,
          foodDisplayName: m.dish.name,
          energy: { kcal: n.kcal },
          totalCarbohydrate: { grams: n.c },
          totalFat: { grams: n.f },
          nutrients: [{ nutrient: "PROTEIN", quantity: { grams: n.p } }],
        },
      });
    }
  }
  let seq = 1;

  /** Google computes nutrition for logs against a food, and labels the serving. */
  function computed(n: Loose): Loose | null {
    if (!n.food) return n;
    const f = FOODS.find((x) => foodName(x.id) === asMe(n.food));
    const unitId = String(n.serving?.foodMeasurementUnit ?? "").split("/").pop()!;
    const per = f?.servings[unitId];
    if (!f || per === undefined) return null;
    const k = Number(n.serving.amount) * per;
    const r = (x: number) => Math.round(x * k * 10) / 10;
    const unit = UNITS[unitId]!;
    return {
      ...n,
      food: full(asMe(n.food)),
      foodDisplayName: f.name,
      energy: { kcal: Math.round(f.kcal * k) },
      totalCarbohydrate: { grams: r(f.c) },
      totalFat: { grams: r(f.f) },
      nutrients: [{ nutrient: "PROTEIN", quantity: { grams: r(f.p) } }],
      serving: { ...n.serving, foodMeasurementUnitDisplayName: Number(n.serving.amount) === 1 ? unit.displayName : unit.pluralDisplayName },
    };
  }

  const nutritionDay = (date: string) => {
    const pts = [...logs.values()].filter((p) => civilOf(p.nutritionLog.interval.startTime, p.nutritionLog.interval.startUtcOffset).startsWith(date));
    if (!pts.length) return null;
    const sum = (get: (n: Loose) => number | undefined) => Math.round(pts.reduce((a, p) => a + (get(p.nutritionLog) ?? 0), 0) * 10) / 10;
    return {
      nutritionLog: {
        energy: { kcalSum: sum((n) => n.energy?.kcal) },
        totalCarbohydrate: { gramsSum: sum((n) => n.totalCarbohydrate?.grams) },
        totalFat: { gramsSum: sum((n) => n.totalFat?.grams) },
        nutrients: [{ nutrient: "PROTEIN", quantity: { gramsSum: sum((n) => n.nutrients?.find((x: Loose) => x.nutrient === "PROTEIN")?.quantity?.grams) } }],
      },
    };
  };

  // ── Daily rollups, in the live value shapes (int64s as strings) ─────────
  function rollup(type: string, date: string): Loose | null {
    const d = day(date);
    switch (type) {
      case "steps": return { steps: { countSum: String(d.steps) } };
      case "distance": return { distance: { millimetersSum: String(d.distanceMm) } };
      case "floors": return { floors: { countSum: String(d.floors) } };
      case "active-zone-minutes": return { activeZoneMinutes: { sumInFatBurnHeartZone: String(d.azm.fatBurn), sumInCardioHeartZone: String(d.azm.cardio), sumInPeakHeartZone: String(d.azm.peak) } };
      case "active-minutes": return { activeMinutes: { activeMinutesRollupByActivityLevel: [
        { activityLevel: "LIGHT", activeMinutesSum: String(d.active.light) },
        { activityLevel: "MODERATE", activeMinutesSum: String(d.active.moderate) },
        { activityLevel: "VIGOROUS", activeMinutesSum: String(d.active.vigorous) },
      ] } };
      case "total-calories": return { totalCalories: { kcalSum: d.kcalOut } };
      case "heart-rate": return { heartRate: { beatsPerMinuteAvg: d.hr.avg, beatsPerMinuteMin: d.hr.min, beatsPerMinuteMax: d.hr.max } };
      case "weight": return d.weightG ? { weight: { weightGramsAvg: d.weightG } } : null;
      case "body-fat": return d.bodyFatPct ? { bodyFat: { bodyFatPercentageAvg: d.bodyFatPct } } : null;
      case "hydration-log": return { hydrationLog: { amountConsumed: { millilitersSum: d.waterMl } } };
      case "nutrition-log": return nutritionDay(date);
      default: return null;
    }
  }

  // ── Lists ────────────────────────────────────────────────────────────────
  /** Recovery vitals: data type → [union field, value fields] in Google's DataPoint shapes. */
  const VITALS: Record<string, [string, (v: NonNullable<ReturnType<typeof vitals>>) => Loose]> = {
    "daily-heart-rate-variability": ["dailyHeartRateVariability", (v) => ({ averageHeartRateVariabilityMilliseconds: v.hrvMs })],
    "daily-oxygen-saturation": ["dailyOxygenSaturation", (v) => ({ averagePercentage: v.spo2.avg, lowerBoundPercentage: v.spo2.lo, upperBoundPercentage: v.spo2.hi })],
    "daily-respiratory-rate": ["dailyRespiratoryRate", (v) => ({ breathsPerMinute: v.breathing })],
    "daily-sleep-temperature-derivations": ["dailySleepTemperatureDerivations", (v) => ({ nightlyTemperatureCelsius: v.skinC, baselineTemperatureCelsius: v.skinBaseC })],
    "daily-vo2-max": ["dailyVo2Max", (v) => ({ vo2Max: v.vo2Max, cardioFitnessLevel: v.fitness, estimated: true })],
  };
  function list(type: string, from: string, to: string): Point[] {
    if (type === "nutrition-log") {
      return [...logs.values()].filter((p) => {
        const t = civilOf(p.nutritionLog.interval.startTime, p.nutritionLog.interval.startUtcOffset);
        return t >= from && t < to;
      });
    }
    if (type === "daily-resting-heart-rate") {
      return dates(from, to).map((d) => ({
        name: `users/${DEMO_USER_ID}/dataTypes/daily-resting-heart-rate/dataPoints/r${d}`,
        dailyRestingHeartRate: { date: civilDate(d), beatsPerMinute: String(day(d).restingHr) },
      }));
    }
    const vital = VITALS[type];
    if (vital) {
      return dates(from, to).flatMap((d) => {
        const v = vitals(d);
        return v ? [{ name: `users/${DEMO_USER_ID}/dataTypes/${type}/dataPoints/v${d}`, [vital[0]]: { date: civilDate(d), ...vital[1](v) } }] : [];
      });
    }
    if (type === "sleep") {
      return dates(from, to).flatMap((wake) => {
        const n = night(wake);
        if (!n) return [];
        let t = n.bed.getTime();
        const stages = n.spans.map(([type, min]) => ({ type, startTime: new Date(t).toISOString(), endTime: new Date((t += min * 60_000)).toISOString() }));
        const total = (s: string) => n.spans.filter(([x]) => x === s).reduce((a, [, m]) => a + m, 0);
        const inBed = n.spans.reduce((a, [, m]) => a + m, 0);
        return [{
          name: `users/${DEMO_USER_ID}/dataTypes/sleep/dataPoints/s${wake}`,
          dataSource: { device: { displayName: "Demo tracker" } },
          sleep: {
            interval: { ...interval(n.bed, inBed), endUtcOffset: offsetOf(new Date(t)) },
            type: "STAGES",
            metadata: { mainSleep: true },
            summary: {
              minutesInSleepPeriod: String(inBed), minutesAsleep: String(inBed - total("AWAKE")), minutesAwake: String(total("AWAKE")),
              stagesSummary: ["DEEP", "LIGHT", "REM", "AWAKE"].map((s) => ({ type: s, minutes: String(total(s)), count: String(n.spans.filter(([x]) => x === s).length) })),
            },
            stages,
          },
        }];
      });
    }
    if (type === "exercise") {
      return dates(from, to).flatMap((d) => {
        const e = exercise(d);
        if (!e) return [];
        return [{
          name: `users/${DEMO_USER_ID}/dataTypes/exercise/dataPoints/e${d}`,
          dataSource: { device: { displayName: "Demo tracker" } },
          exercise: {
            interval: interval(at(d, e.startMin), e.minutes),
            exerciseType: e.type,
            displayName: e.name,
            activeDuration: `${e.minutes * 60}s`,
            metricsSummary: {
              ...(e.distanceMm ? { distanceMillimeters: String(e.distanceMm) } : {}),
              ...(e.steps ? { steps: String(e.steps) } : {}),
              caloriesKcal: e.kcal,
              averageHeartRateBeatsPerMinute: String(e.avgHr),
              activeZoneMinutes: String(Math.round(e.minutes * 0.85)),
            },
          },
        }];
      });
    }
    return [];
  }

  // ── Router ───────────────────────────────────────────────────────────────
  const json = (body: unknown, status = 200) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const googleError = (status: number, message: string) =>
    json({ error: { code: status, message, status: status === 404 ? "NOT_FOUND" : "INVALID_ARGUMENT" } }, status);

  function health(method: string, url: URL, body: Loose | undefined): Response {
    const path = url.pathname.replace(/^\/v4\//, "");
    if (path === "users/me/identity") return json({ name: "users/me/identity", healthUserId: DEMO_USER_ID, legacyUserId: "DEMO00" });

    const roll = /^users\/me\/dataTypes\/([a-z0-9-]+)\/dataPoints:dailyRollUp$/.exec(path);
    if (roll && method === "POST") {
      const days = dates(ymd(body!.range.start.date), ymd(body!.range.end.date)).flatMap((d) => {
        const v = rollup(roll[1]!, d);
        return v ? [{ civilStartTime: { date: civilDate(d), time: {} }, civilEndTime: { date: civilDate(addDays(d, 1)), time: {} }, ...v }] : [];
      });
      return json({ rollupDataPoints: days });
    }

    const coll = /^users\/me\/dataTypes\/([a-z0-9-]+)\/dataPoints$/.exec(path);
    if (coll && method === "GET") {
      const type = coll[1]!;
      if (type === "food") return json({ dataPoints: [...FOODS.map((f) => foodPoint(f)), foodPoint({ ...FOODS[0]!, id: "9001", name: "Oats (public database)" }, "PUBLIC")] });
      if (type === "food-measurement-unit") {
        return json({ dataPoints: Object.entries(UNITS).map(([id, u]) => ({ name: full(unitName(id)), foodMeasurementUnit: u })) });
      }
      const filter = url.searchParams.get("filter") ?? "";
      const from = /\s>=\s"([^"]+)"/.exec(filter)?.[1] ?? "0000";
      const to = /\s<\s"([^"]+)"/.exec(filter)?.[1] ?? "9999";
      return json({ dataPoints: list(type, from, to) });
    }
    if (coll && coll[1] === "nutrition-log" && method === "POST") {
      const n = computed(body!.nutritionLog);
      if (!n) return googleError(400, "Unknown food or serving unit");
      const name = `users/me/dataTypes/nutrition-log/dataPoints/new${seq++}`;
      const point = { name: full(name), dataSource: ours, nutritionLog: n };
      logs.set(name, point);
      return json({ done: true, response: point });
    }

    const del = /^users\/me\/dataTypes\/([a-z0-9-]+)\/dataPoints:batchDelete$/.exec(path);
    if (del && method === "POST") {
      for (const n of (body!.names ?? []) as string[]) {
        const p = logs.get(asMe(n));
        if (p && p.dataSource !== ours) return googleError(403, "This data was written by another application");
        logs.delete(asMe(n));
      }
      return json({ done: true, response: {} });
    }

    const one = /^users\/me\/dataTypes\/(nutrition-log|food)\/dataPoints\/([^/]+)$/.exec(path);
    if (one && method === "GET") {
      if (one[1] === "food") {
        const f = FOODS.find((x) => x.id === one[2]);
        return f ? json(foodPoint(f)) : googleError(404, "Food not found");
      }
      const p = logs.get(asMe(path));
      return p ? json(p) : googleError(404, "Data point not found");
    }
    if (one && one[1] === "nutrition-log" && method === "PATCH") {
      const p = logs.get(asMe(path));
      if (!p) return googleError(404, "Data point not found");
      if (p.dataSource !== ours) return googleError(403, "This data was written by another application");
      if (!p.nutritionLog.food) return googleError(400, "Nutrition logs without a food can't be updated");
      const n = computed(body!.nutritionLog);
      if (!n) return googleError(400, "Unknown food or serving unit");
      p.nutritionLog = n;
      return json({ done: true, response: p });
    }
    return googleError(404, `The demo doesn't support ${method} ${path}`);
  }

  function off(url: URL): Response {
    if (url.pathname === "/cgi/search.pl") {
      const words = (url.searchParams.get("search_terms") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const hits = PRODUCTS.filter((p) => words.some((w) => `${p.name} ${p.brand}`.toLowerCase().includes(w)));
      return json({ count: hits.length, page: 1, page_size: 25, products: hits.map((p) => offProduct(p, false)) });
    }
    const code = /^\/api\/v2\/product\/(\d+)\.json$/.exec(url.pathname)?.[1];
    const p = PRODUCTS.find((x) => x.code === code);
    return p ? json({ status: 1, product: offProduct(p, true) }) : json({ status: 0, status_verbose: "product not found" }, 404);
  }

  return async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let body: Loose | undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = undefined;
      }
    }
    await new Promise((r) => setTimeout(r, 40)); // a little latency, so loading states show as they would live
    const url = new URL(href);
    if (href.startsWith(HEALTH)) return health(method, url, body);
    if (href.startsWith(OFF)) return off(url);
    // The demo never reaches the network: anything else is a bug, reported like a failed request.
    throw new TypeError(`Demo: no network access (${url.origin})`);
  };
}
