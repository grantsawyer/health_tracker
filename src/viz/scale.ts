import { useLayoutEffect, useRef, useState } from "react";

/** Track an element's content width (charts render at real pixel width). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** "Nice" tick values covering [min, max] (≈ count ticks). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    max = min + 1;
    min = Math.max(0, min - 1);
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export const linear = (d0: number, d1: number, r0: number, r1: number) => (v: number) =>
  d1 === d0 ? r0 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

/** Axis tick label: full under 10,000, compact above (one style per axis). */
export function axisFormat(ticks: number[]): (v: number) => string {
  const compact = Math.max(...ticks.map(Math.abs)) >= 10_000;
  return compact
    ? (v) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v)
    : (v) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
/** Parse YYYY-MM-DD as a local calendar date (no UTC shift). */
export const parseDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, day);
};
export const fmtShortDate = (d: string) => shortDate.format(parseDate(d));
export const fmtLongDate = (d: string) => longDate.format(parseDate(d));

/** Pick ~maxLabels evenly spaced indices for x-axis date labels, always including the last. */
export function labelIndices(n: number, maxLabels: number): Set<number> {
  if (n <= 0) return new Set();
  const step = Math.max(1, Math.ceil(n / Math.max(1, maxLabels)));
  const out = new Set<number>();
  for (let i = n - 1; i >= 0; i -= step) out.add(i);
  return out;
}
