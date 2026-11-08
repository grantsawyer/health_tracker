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

/**
 * Sleep schedule: one floating bar per night from bedtime to wake time,
 * time of day on the y-axis (earlier at top). Consistency reads as how level
 * the bar ends are. Bars are fully rounded (no baseline).
 */
export function ScheduleChart({ rows, color, height = 200 }: { rows: ScheduleRow[]; color: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const data = rows.filter((r) => r.start !== undefined && r.end !== undefined);
  if (!data.length) return <div className="viz-plot" ref={ref}><EmptyState /></div>;

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const lo = Math.floor(Math.min(...data.map((r) => r.start!)) / 120) * 120;
  const hi = Math.ceil(Math.max(...data.map((r) => r.end!)) / 120) * 120;
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
          <g transform={`translate(${M.left},${M.top})`}>
            <g className="viz-grid">{ticks.map((t) => <line key={t} x1={0} x2={innerW} y1={y(t)} y2={y(t)} />)}</g>
            {ticks.map((t) => <text key={t} x={-8} y={y(t)} dy="0.32em" textAnchor="end">{fmtClock(t)}</text>)}
            {active !== null && <rect className="viz-col-hover" x={active * band} y={0} width={band} height={innerH} />}
            {rows.map((r, i) =>
              r.start !== undefined && r.end !== undefined ? (
                <rect key={r.date} x={i * band + (band - barW) / 2} y={y(r.start)} width={barW}
                  height={Math.max(2, y(r.end) - y(r.start))} rx={Math.min(4, barW / 2)} fill={color} />
              ) : null,
            )}
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
          ]} />
      )}
    </div>
  );
}
