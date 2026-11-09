import { typicalRange, type TypicalRange } from "./baseline";
import { usualStatus } from "./sleepStages";
import type { Status } from "../ui/Pill";
import type { SleepSession } from "../../shared/summary";

/**
 * "Sleep quality" metrics, after the Google Health app's card (owner's reference
 * screenshot). Google doesn't publish its definitions or expose these values, so
 * the app computes them from the night's stage timeline and says so on the card:
 *
 * - Time to sound sleep: minutes from the start of the sleep session to the first
 *   deep-sleep stage.
 * - Sound sleep: minutes of deep sleep.
 * - Restlessness: minutes awake (or restless) in spells shorter than 5 minutes,
 *   between first falling asleep and the final wake-up.
 * - Interruptions: awake spells of 5 minutes or more in that same stretch (minutes
 *   and count).
 *
 * "Usual" is the owner's own last 30 nights (mean ± 1 SD), never population norms
 * (the sample says "people your age and gender"; the API has no such data).
 */

export const INTERRUPTION_MIN = 5;

export interface QualityMetrics {
  toSoundSleep?: number;
  soundSleep?: number;
  restless?: number;
  interruptions?: { minutes: number; count: number };
}

const SLEEPING = new Set(["deep", "light", "rem", "asleep"]);
const WAKING = new Set(["awake", "restless"]);

export function sleepQuality(s: SleepSession | undefined): QualityMetrics {
  if (!s) return {};
  const segs = [...s.segments].sort((a, b) => a.from - b.from);
  const hasStages = segs.some((x) => x.stage === "deep" || x.stage === "rem" || x.stage === "light");
  if (!segs.length) {
    // No timeline: only the classic restless total is meaningful.
    return s.stages.restless > 0 ? { restless: s.stages.restless } : {};
  }
  const firstDeep = segs.find((x) => x.stage === "deep");
  const sleeping = segs.filter((x) => SLEEPING.has(x.stage));
  const out: QualityMetrics = {};
  if (hasStages) {
    out.soundSleep = s.stages.deep;
    if (firstDeep) out.toSoundSleep = firstDeep.from;
  }
  if (!sleeping.length) return out;
  const onset = sleeping[0]!.from;
  const lastAsleep = Math.max(...sleeping.map((x) => x.to));

  // Waking spells inside [onset, lastAsleep]; back-to-back awake/restless segments count as one spell.
  const spells: number[] = [];
  let open: { end: number; len: number } | null = null;
  for (const x of segs) {
    const from = Math.max(x.from, onset);
    const to = Math.min(x.to, lastAsleep);
    if (to <= from) continue;
    if (WAKING.has(x.stage)) {
      if (open && open.end === from) {
        open.len += to - from;
        open.end = to;
      } else {
        if (open) spells.push(open.len);
        open = { end: to, len: to - from };
      }
    } else if (open) {
      spells.push(open.len);
      open = null;
    }
  }
  if (open) spells.push(open.len);
  out.restless = spells.filter((m) => m < INTERRUPTION_MIN).reduce((a, b) => a + b, 0);
  const long = spells.filter((m) => m >= INTERRUPTION_MIN);
  out.interruptions = { minutes: long.reduce((a, b) => a + b, 0), count: long.length };
  return out;
}

export interface QualityRow {
  key: "toSoundSleep" | "soundSleep" | "restless" | "interruptions";
  label: string;
  value?: number;
  /** Interruptions only: how many. */
  count?: number;
  usual?: TypicalRange;
  status: Status;
}

const LABELS: Record<QualityRow["key"], string> = {
  toSoundSleep: "Time to sound sleep",
  soundSleep: "Sound sleep",
  restless: "Restlessness",
  interruptions: "Interruptions",
};

const valueOf = (m: QualityMetrics, key: QualityRow["key"]) => (key === "interruptions" ? m.interruptions?.minutes : m[key]);
const mean = (v: (number | undefined)[]) => {
  const x = v.filter((n): n is number => n !== undefined);
  return x.length ? x.reduce((a, b) => a + b, 0) / x.length : undefined;
};

/**
 * One row per metric: the value for one night (or the average of several nights) against the usual range of the
 * baseline nights. Rows with no value and no history are dropped.
 */
export function qualityRows(nights: (SleepSession | undefined)[], baseline: (SleepSession | undefined)[]): QualityRow[] {
  const now = nights.map(sleepQuality);
  const base = baseline.map(sleepQuality);
  return (Object.keys(LABELS) as QualityRow["key"][]).map((key) => {
    const value = mean(now.map((m) => valueOf(m, key)));
    const usual = typicalRange(base.map((m) => valueOf(m, key)));
    const count = key === "interruptions" ? mean(now.map((m) => m.interruptions?.count)) : undefined;
    return { key, label: LABELS[key], value, count, usual, status: usualStatus(value, usual) };
  }).filter((r) => r.value !== undefined || r.usual !== undefined);
}
