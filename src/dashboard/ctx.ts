import type { DailySummary, SummaryResponse } from "../../shared/summary";
import type { Goals } from "../../shared/goals";
import { fmtShortDate } from "../viz/scale";
import { typicalRange } from "./baseline";
import type { Period } from "./period";
import type { UnitSystem } from "../units";

/** Shared view context and helpers for the dashboard views and the Today card registry. */
export type Tab = "today" | "fitness" | "sleep" | "food" | "body";

/** Everything a view needs, computed once by the shell. */
export interface ViewCtx {
  period: Period;
  today: string;
  /** Dates on screen: the 7 / 30 / 90 days ending on the anchor (D shows 7 for context); the anchor is last. */
  dates: string[];
  data: SummaryResponse;
  /** The 30 days ending at the anchor: source of "your typical range". */
  baseline: SummaryResponse | null;
  goals: Goals;
  units: UnitSystem;
  loading: boolean;
  open: (tab: Tab) => void;
  /** Go to the Account page (goals form, settings). */
  openAccount: () => void;
  logFood: () => void;
}

export const dash = "—";
export const S = { activity: "var(--activity)", heart: "var(--heart)", food: "var(--food)", body: "var(--body)" };
export const ORD = ["var(--ord-1)", "var(--ord-2)", "var(--ord-3)"];

// ── Helpers ──────────────────────────────────────────────────────────────────
export const byDate = (data: SummaryResponse) => new Map(data.days.map((d) => [d.date, d]));
export function series(ctx: ViewCtx, pick: (d: DailySummary) => number | undefined) {
  const m = byDate(ctx.data);
  return ctx.dates.map((date) => {
    const d = m.get(date);
    return d ? pick(d) : undefined;
  });
}
export const avg = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};
export const sum = (xs: (number | undefined)[]) => xs.reduce<number>((t, x) => t + (x ?? 0), 0);
export const azmTotal = (d: DailySummary) => (d.azm ? d.azm.fatBurn + d.azm.cardio + d.azm.peak : undefined);
export const lastWith = <T,>(days: DailySummary[], pick: (d: DailySummary) => T | undefined) => {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = pick(days[i]!);
    if (v !== undefined) return { value: v, date: days[i]!.date };
  }
  return undefined;
};
export const typical = (ctx: ViewCtx, pick: (d: DailySummary) => number | undefined) =>
  ctx.baseline ? typicalRange(ctx.baseline.days.map(pick)) : undefined;
export const focusDay = (ctx: ViewCtx) => ctx.data.days.find((d) => d.date === ctx.period.anchor);
export const upToAnchor = (ctx: ViewCtx) => ctx.data.days.filter((d) => d.date <= ctx.period.anchor);
export const periodWord = (ctx: ViewCtx) => (ctx.period.kind === "D" || ctx.period.kind === "W" ? "in the last 7 days" : "in this period");
export const elapsedDays = (ctx: ViewCtx) => ctx.dates.filter((d) => d <= ctx.today).length;
export function table(ctx: ViewCtx, cols: string[], row: (date: string, d: DailySummary | undefined) => (string | number)[]) {
  const m = byDate(ctx.data);
  return { columns: ["Date", ...cols], rows: ctx.dates.filter((d) => d <= ctx.today).map((date) => [fmtShortDate(date), ...row(date, m.get(date))]) };
}
export const pctFill = (v: number | undefined, g: number | null | undefined) => (v !== undefined && g ? `${Math.min(100, (v / g) * 100)}%` : "0%");

