/**
 * The D / W / M / 3M period model shared by every dashboard tab.
 *
 * Rolling windows that END on the anchor date (owner request 2026-11-09), so the
 * latest day is always the last point on every chart:
 *   D  → the anchor day; charts show the 7 days ending on it for context
 *   W  → the 7 days ending on the anchor
 *   M  → the 30 days ending on the anchor
 *   3M → the 90 days ending on the anchor
 * ‹ › move by the window length and never past today. No "Y": a year needs ~27
 * Google requests for heart rate alone (14-day rollup cap), making cold loads
 * take close to a minute.
 */
export type PeriodKind = "D" | "W" | "M" | "3M";
export const PERIODS: PeriodKind[] = ["D", "W", "M", "3M"];

export interface Period {
  kind: PeriodKind;
  /** Local YYYY-MM-DD */
  anchor: string;
}

export const toISO = (d: Date) => d.toLocaleDateString("en-CA");
export const fromISO = (s: string) => {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};
export const todayISO = () => toISO(new Date());
export function addDaysISO(s: string, n: number): string {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
/** Days in each period's window. */
export const WINDOW_DAYS: Record<PeriodKind, number> = { D: 7, W: 7, M: 30, "3M": 90 };

/** [start, end) of the dates displayed for a period: the window ending on the anchor. */
export function displayRange(p: Period): { start: string; end: string } {
  return { start: addDaysISO(p.anchor, 1 - WINDOW_DAYS[p.kind]), end: addDaysISO(p.anchor, 1) };
}

/** The range to request from the server: the display range, clipped so it never asks for future days. */
export function fetchRange(p: Period, today = todayISO()): { start: string; end: string } {
  const r = displayRange(p);
  const tomorrow = addDaysISO(today, 1);
  return { start: r.start, end: r.end < tomorrow ? r.end : tomorrow };
}

/** Every date in the display range, oldest first; the anchor is always last. */
export function displayDates(p: Period): string[] {
  const { start, end } = displayRange(p);
  const out: string[] = [];
  for (let d = start; d < end; d = addDaysISO(d, 1)) out.push(d);
  return out;
}

/** Move one window back (-1) or forward (+1); D moves a day. Never past today. */
export function step(p: Period, dir: -1 | 1, today = todayISO()): Period {
  const n = p.kind === "D" ? 1 : WINDOW_DAYS[p.kind];
  const anchor = addDaysISO(p.anchor, n * dir);
  return { ...p, anchor: dir > 0 && anchor > today ? today : anchor };
}

/** Whether there's anything newer to step to. */
export const canStepForward = (p: Period, today = todayISO()) => p.anchor < today;

/** True when the window ends today. */
export const isCurrent = (p: Period, today = todayISO()) => p.anchor === today;

const fmt = (s: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, o).format(fromISO(s));

/** Heading: "Today", "Yesterday", "Last 7 days", "Last 30 days", or the window's dates ("Oct 11 – Nov 9"). */
export function periodTitle(p: Period, today = todayISO()): string {
  if (p.kind === "D") {
    if (p.anchor === today) return "Today";
    if (p.anchor === addDaysISO(today, -1)) return "Yesterday";
    return fmt(p.anchor, { weekday: "short", month: "short", day: "numeric" });
  }
  if (p.anchor === today) return `Last ${WINDOW_DAYS[p.kind]} days`;
  const { start } = displayRange(p);
  const year = start.slice(0, 4) !== today.slice(0, 4) || p.anchor.slice(0, 4) !== today.slice(0, 4);
  const sameMonth = start.slice(0, 7) === p.anchor.slice(0, 7);
  const from = fmt(start, { month: "short", day: "numeric", ...(year && start.slice(0, 4) !== p.anchor.slice(0, 4) ? { year: "numeric" } : {}) });
  const to = fmt(p.anchor, sameMonth ? { day: "numeric", ...(year ? { year: "numeric" } : {}) } : { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
  return `${from} – ${to}`;
}

/** Short x-axis label for a date: weekday initial for ≤7 days, else day/month. */
export function dayLabel(date: string, count: number): string {
  if (count <= 7) return fmt(date, { weekday: "narrow" });
  return fmt(date, { month: "short", day: "numeric" });
}
