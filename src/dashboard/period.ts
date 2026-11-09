/**
 * The D / W / M / 3M period model shared by every dashboard tab.
 *
 * An anchor date plus a period kind define what's shown:
 *   D  → the anchor day; charts show its Mon–Sun week for context
 *   W  → the Mon–Sun week containing the anchor
 *   M  → the calendar month containing the anchor
 *   3M → the anchor's month and the two before it
 * No "Y": a year needs ~27 Google requests for heart rate alone (14-day rollup
 * cap), making cold loads take close to a minute.
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
function addMonthsISO(s: string, n: number): string {
  const d = fromISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}
/** Monday of the week containing s. */
export function weekStart(s: string): string {
  const d = fromISO(s);
  return addDaysISO(s, -((d.getDay() + 6) % 7));
}
const monthStart = (s: string) => `${s.slice(0, 7)}-01`;

/** [start, end) of the dates displayed for a period. */
export function displayRange(p: Period): { start: string; end: string } {
  switch (p.kind) {
    case "D":
    case "W": {
      const start = weekStart(p.anchor);
      return { start, end: addDaysISO(start, 7) };
    }
    case "M": {
      const start = monthStart(p.anchor);
      return { start, end: monthStart(addMonthsISO(start, 1)) };
    }
    case "3M": {
      const end = monthStart(addMonthsISO(monthStart(p.anchor), 1));
      return { start: monthStart(addMonthsISO(monthStart(p.anchor), -2)), end };
    }
  }
}

/** The range to request from the server: the display range, clipped so it never asks for future days. */
export function fetchRange(p: Period, today = todayISO()): { start: string; end: string } {
  const r = displayRange(p);
  const tomorrow = addDaysISO(today, 1);
  return { start: r.start, end: r.end < tomorrow ? r.end : tomorrow };
}

/** Every date in the display range (future days included, so a week always shows Mon–Sun). */
export function displayDates(p: Period): string[] {
  const { start, end } = displayRange(p);
  const out: string[] = [];
  for (let d = start; d < end; d = addDaysISO(d, 1)) out.push(d);
  return out;
}

/** Move one period back (-1) or forward (+1). */
export function step(p: Period, dir: -1 | 1): Period {
  switch (p.kind) {
    case "D": return { ...p, anchor: addDaysISO(p.anchor, dir) };
    case "W": return { ...p, anchor: addDaysISO(p.anchor, 7 * dir) };
    case "M": return { ...p, anchor: addMonthsISO(p.anchor, dir) };
    case "3M": return { ...p, anchor: addMonthsISO(p.anchor, 3 * dir) };
  }
}

/** Whether stepping forward would show only the future. */
export function canStepForward(p: Period, today = todayISO()): boolean {
  return displayRange(step(p, 1)).start <= today;
}

/** True when the period already includes today. */
export const isCurrent = (p: Period, today = todayISO()) => {
  const r = displayRange(p);
  return p.kind === "D" ? p.anchor === today : r.start <= today && today < r.end;
};

const fmt = (s: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, o).format(fromISO(s));

/** Heading for the period: "Today", "This week", "Nov 2 – 8", "November 2026", "Sep – Nov 2026". */
export function periodTitle(p: Period, today = todayISO()): string {
  const r = displayRange(p);
  const last = addDaysISO(r.end, -1);
  switch (p.kind) {
    case "D":
      if (p.anchor === today) return "Today";
      if (p.anchor === addDaysISO(today, -1)) return "Yesterday";
      return fmt(p.anchor, { weekday: "short", month: "short", day: "numeric" });
    case "W": {
      if (isCurrent(p, today)) return "This week";
      if (r.start === weekStart(addDaysISO(today, -7))) return "Last week";
      const sameMonth = r.start.slice(0, 7) === last.slice(0, 7);
      return `${fmt(r.start, { month: "short", day: "numeric" })} – ${sameMonth ? fmt(last, { day: "numeric" }) : fmt(last, { month: "short", day: "numeric" })}`;
    }
    case "M":
      return fmt(r.start, { month: "long", year: "numeric" });
    case "3M":
      return `${fmt(r.start, { month: "short" })} – ${fmt(last, { month: "short", year: "numeric" })}`;
  }
}

/** Short x-axis label for a date: weekday initial for ≤7 days, else day/month. */
export function dayLabel(date: string, count: number): string {
  if (count <= 7) return fmt(date, { weekday: "narrow" });
  return fmt(date, { month: "short", day: "numeric" });
}
