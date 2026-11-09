import { useState } from "react";
import { EmptyState, Tooltip } from "./ChartCard";
import { fmtLongDate, fmtShortDate, labelIndices, linear, useWidth } from "./scale";

export interface ScheduleRow {
  date: string;
  /** Minutes relative to midnight that starts `date` (bedtime is usually negative: 23:30 → -30). */
  start?: number;
  end?: number;
}

const M = { top: 12, right: 8, bottom: 22, left: 52 };
const MAX_BAR = 24;

export const fmtClock = (mins: number) => {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  const ampm = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${ampm}`;
};

export interface ScheduleGoal {
  /** Goal bedtime / wake time on the chart's scale (minutes from the wake date's midnight). */
  start?: number;
  end?: number;
  /** ± minutes around each goal that count as on schedule (drawn as a band). */
  tolerance: number;
}

/**
 * Sleep schedule: one floating bar per night from bedtime to wake time,
 * time of day on the y-axis (earlier at top). Consistency reads as how level
 * the bar ends are. Bars are fully rounded (no baseline). With a goal, a band
 * marks each target time ± the tolerance, nights on schedule get a check, and
 * the tooltip says how early or late each night was.
 */
export function ScheduleChart({ rows, color, height = 200, goal, onSchedule, notes }: {
  rows: ScheduleRow[];
  color: string;
  height?: number;
  goal?: ScheduleGoal;
  /** Per row: on schedule (check badge), off, or unknown. */
  onSchedule?: (boolean | undefined)[];
  /** Per row: extra tooltip lines, e.g. ["Bedtime", "25 min late"]. */
  notes?: ([string, string][] | undefined)[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const data = rows.filter((r) => r.start !== undefined && r.end !== undefined);
  if (!data.length) return <div className="viz-plot" ref={ref}><EmptyState /></div>;

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  // Axis spans the data, but never beyond 6 PM the evening before → 3 PM, so one
  // odd evening session can't squash every normal night (bars outside are clipped).
  const goalEdges = goal ? [goal.start, goal.end].filter((g): g is number => g !== undefined).flatMap((g) => [g - goal.tolerance, g + goal.tolerance]) : [];
  const lo = Math.max(-360, Math.floor(Math.min(...data.map((r) => r.start!), ...goalEdges) / 120) * 120);
  const hi = Math.min(900, Math.ceil(Math.max(...data.map((r) => r.end!), ...goalEdges) / 120) * 120);
  const y = linear(lo, hi, 0, innerH);
  const ticks: number[] = [];
  const step = hi - lo > 12 * 60 ? 240 : 120;
  for (let t = lo; t <= hi; t += step) ticks.push(t);
  const band = innerW / rows.length;
  const barW = Math.max(2, Math.min(MAX_BAR, band * 0.6, band - 2));
  const labels = labelIndices(rows.length, Math.floor(innerW / 64));
  const a = active !== null ? rows[active] : undefined;

  return (
    <div className="viz-plot" ref={ref} onMouseLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Bedtime and wake time by night" tabIndex={0}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            setActive((cur) => Math.max(0, Math.min(rows.length - 1, (cur ?? rows.length - 1) + (e.key === "ArrowRight" ? 1 : -1))));
          }}
          onBlur={() => setActive(null)}>
          <defs><clipPath id="sched-clip"><rect x={0} y={0} width={innerW} height={innerH} /></clipPath></defs>
          <g transform={`translate(${M.left},${M.top})`}>
            <g className="viz-grid">{ticks.map((t) => <line key={t} x1={0} x2={innerW} y1={y(t)} y2={y(t)} />)}</g>
            {ticks.map((t) => <text key={t} x={-8} y={y(t)} dy="0.32em" textAnchor="end">{fmtClock(t)}</text>)}
            {active !== null && <rect className="viz-col-hover" x={active * band} y={0} width={band} height={innerH} />}
            {goal && ([["start", "Bedtime goal"], ["end", "Wake goal"]] as const).map(([k, name]) => {
              const g = goal[k];
              if (g === undefined) return null;
              const top = y(g - goal.tolerance), bottom = y(g + goal.tolerance);
              return (
                <g key={k} className="viz-target" aria-hidden>
                  <rect x={0} y={top} width={innerW} height={bottom - top} />
                  <line x1={0} x2={innerW} y1={top} y2={top} />
                  <line x1={0} x2={innerW} y1={bottom} y2={bottom} />
                  <text x={innerW - 4} y={k === "start" ? top - 4 : bottom + 12} textAnchor="end">{name} {fmtClock(g)}</text>
                </g>
              );
            })}
            <g clipPath="url(#sched-clip)">
            {rows.map((r, i) =>
              r.start !== undefined && r.end !== undefined ? (
                <rect key={r.date} x={i * band + (band - barW) / 2} y={y(r.start)} width={barW}
                  height={Math.max(2, y(r.end) - y(r.start))} rx={barW / 2} fill={color} />
              ) : null,
            )}
            </g>
            {rows.map((r, i) => onSchedule?.[i] && r.start !== undefined && barW >= 14 ? (
              <g key={`ok-${r.date}`} className="viz-check" transform={`translate(${i * band + band / 2},${y(r.start) + barW / 2})`} aria-hidden>
                <circle r={barW / 2 - 2} fill="var(--viz-surface)" opacity={0.9} />
                <path d="M-4.5 0.5l3 3 6-6.5" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ) : null)}
            {rows.map((r, i) => labels.has(i) ? <text key={r.date} x={i * band + band / 2} y={innerH + 15} textAnchor="middle">{fmtShortDate(r.date)}</text> : null)}
            {rows.map((r, i) => <rect key={r.date} className="viz-hit" x={i * band} y={0} width={band} height={innerH} onMouseMove={() => setActive(i)} />)}
          </g>
        </svg>
      )}
      {a && active !== null && (
        <Tooltip x={M.left + active * band + band / 2} y={M.top} width={width} head={`Night ending ${fmtLongDate(a.date)}`}
          rows={a.start === undefined ? [{ label: "No main sleep recorded", value: "—" }] : [
            { label: "Bedtime", value: fmtClock(a.start), color },
            { label: "Wake", value: fmtClock(a.end!) },
            ...(notes?.[active] ?? []).map(([label, value]) => ({ label, value })),
          ]} />
      )}
    </div>
  );
}
