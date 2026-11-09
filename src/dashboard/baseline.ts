import type { Status } from "../ui/Pill";

/**
 * "Typical range" = the owner's own recent history, not population norms:
 * mean ± 1 standard deviation of the last 30 days with data. Needs at least
 * 7 values, otherwise there's no range to compare against.
 */
export interface TypicalRange {
  lo: number;
  hi: number;
  mean: number;
  n: number;
}

export function typicalRange(values: (number | undefined)[], minN = 7): TypicalRange | undefined {
  const v = values.filter((x): x is number => x !== undefined && Number.isFinite(x));
  if (v.length < minN) return undefined;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { lo: mean - sd, hi: mean + sd, mean, n: v.length };
}

export function rangeStatus(value: number | undefined, range: TypicalRange | undefined): Status {
  if (value === undefined) return { tone: "info", text: "No data" };
  if (!range) return { tone: "info", text: "Not enough history" };
  if (value < range.lo) return { tone: "warn", text: "Below your range" };
  if (value > range.hi) return { tone: "warn", text: "Above your range" };
  return { tone: "good", text: "In your range" };
}

/** Progress toward a daily goal: "Goal met" or "N left". */
export function goalStatus(value: number | undefined, goal: number | null | undefined, unit = "", fmt: (n: number) => string = (n) => Math.round(n).toLocaleString()): Status {
  if (value === undefined) return { tone: "info", text: "No data" };
  if (!goal) return { tone: "info", text: "No goal set" };
  if (value >= goal) return { tone: "good", text: "Goal met" };
  return { tone: "info", text: `${fmt(goal - value)}${unit} left` };
}

/** For "stay under" goals like calories eaten: "N remaining" / "N over". */
export function budgetStatus(value: number | undefined, budget: number | undefined, unit = ""): Status {
  if (value === undefined) return { tone: "info", text: "No data" };
  if (!budget) return { tone: "info", text: "No goal set" };
  const left = budget - value;
  return left >= 0
    ? { tone: "good", text: `${Math.round(left).toLocaleString()}${unit} remaining` }
    : { tone: "warn", text: `${Math.round(-left).toLocaleString()}${unit} over` };
}

/** Trailing N-day rolling average over a daily series (gaps are skipped, not zero). */
export function rollingAverage(values: (number | undefined)[], window = 7): (number | undefined)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((x): x is number => x !== undefined);
    return slice.length >= Math.min(3, window) && values[i] !== undefined ? slice.reduce((a, b) => a + b, 0) / slice.length : undefined;
  });
}
