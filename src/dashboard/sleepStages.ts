import { typicalRange, type TypicalRange } from "./baseline";
import type { Night } from "./sleep";
import type { Status } from "../ui/Pill";

/**
 * Per-stage share of the night, as in the reference screenshot: each stage's
 * minutes as a percentage of time in bed (e.g. 103 min REM of 353 min in bed → 29%).
 * "Usual" is the owner's own last 30 nights (mean ± 1 SD of those percentages).
 */
export type StageKey = "awake" | "rem" | "light" | "deep";
export const STAGE_ROWS: { key: StageKey; label: string; color: string }[] = [
  { key: "awake", label: "Total awake", color: "var(--stage-awake)" },
  { key: "rem", label: "REM", color: "var(--stage-rem)" },
  { key: "light", label: "Light", color: "var(--stage-light)" },
  { key: "deep", label: "Deep", color: "var(--stage-deep)" },
];

/** Minutes per row; classic (stage-less) sleep folds "asleep" into light and "restless" into awake. */
export function stageMinutes(n: Night, key: StageKey): number {
  const s = n.stages;
  switch (key) {
    case "awake": return s.awake + s.restless;
    case "rem": return s.rem;
    case "light": return s.light + s.asleep;
    case "deep": return s.deep;
  }
}

export function stagePct(n: Night, key: StageKey): number | undefined {
  const inBed = n.main?.minutesInBed;
  return inBed ? (stageMinutes(n, key) / inBed) * 100 : undefined;
}

export const efficiencyPct = (n: Night) =>
  n.main?.minutesInBed ? (n.main.minutesAsleep / n.main.minutesInBed) * 100 : undefined;

export interface StageComparison {
  key: StageKey;
  label: string;
  color: string;
  minutes: number;
  pct: number;
  usual?: TypicalRange;
  /** 30-day average share and minutes, for the "30-day average" view. */
  avgPct?: number;
  avgMinutes?: number;
  status: Status;
}

export function usualStatus(value: number | undefined, range: TypicalRange | undefined): Status {
  if (value === undefined) return { tone: "info", text: "No data" };
  if (!range) return { tone: "info", text: "Not enough history" };
  if (value < range.lo) return { tone: "info", text: "Lower than usual" };
  if (value > range.hi) return { tone: "info", text: "Higher than usual" };
  return { tone: "good", text: "Typical" };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Rows for tonight vs the baseline nights. Rows with no minutes tonight or in history are dropped. */
export function compareStages(night: Night, baseline: Night[]): StageComparison[] {
  return compareStagesOver([night], baseline);
}

/**
 * The same rows for a set of nights (W/M/3M): each stage's average share and minutes over the tracked nights, vs
 * the baseline. For one night this is exactly compareStages.
 */
export function compareStagesOver(nights: Night[], baseline: Night[]): StageComparison[] {
  const base = baseline.filter((b) => b.main);
  const tracked = nights.filter((n) => n.main);
  return STAGE_ROWS.map((r) => {
    const pct = mean(tracked.map((n) => stagePct(n, r.key)).filter((p): p is number => p !== undefined)) ?? 0;
    const pcts = base.map((b) => stagePct(b, r.key));
    const mins = base.map((b) => stageMinutes(b, r.key));
    const usual = typicalRange(pcts);
    const present = pcts.filter((p): p is number => p !== undefined);
    return {
      ...r,
      minutes: mean(tracked.map((n) => stageMinutes(n, r.key))) ?? 0,
      pct,
      usual,
      avgPct: present.length ? present.reduce((a, b) => a + b, 0) / present.length : undefined,
      avgMinutes: mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : undefined,
      status: usualStatus(pct, usual),
    };
  }).filter((r) => r.minutes > 0 || (r.avgMinutes ?? 0) > 0);
}

/** "Your sleep efficiency is typical for you" / "higher/lower than usual" (omitted without history). */
export function efficiencySentence(night: Night, baseline: Night[]): string | undefined {
  const tonight = efficiencyPct(night);
  const range = typicalRange(baseline.filter((b) => b.main).map(efficiencyPct));
  if (tonight === undefined || !range) return undefined;
  const s = usualStatus(tonight, range);
  return s.text === "Typical" ? "That's typical for you." : `That's ${s.text.toLowerCase()} for you.`;
}
