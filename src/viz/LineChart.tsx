import { useState } from "react";
import { EmptyState, Tooltip } from "./ChartCard";
import { dayLabel } from "../dashboard/period";
import { axisFormat, fmtLongDate, fmtShortDate, labelIndices, linear, niceTicks, useWidth } from "./scale";

export interface LineRow {
  date: string;
  value?: number;
  /** Optional range shown as a ~10% wash around the line (e.g. daily min–max). */
  min?: number;
  max?: number;
}

const M = { top: 16, right: 52, bottom: 22, left: 44 };

/**
 * Single-series daily line: 2px line, ≥8px markers with a 2px surface ring,
 * end label, crosshair that snaps to the nearest day with data.
 * `connectGaps` joins across days without a reading (sparse measurements like weight).
 */
export function LineChart(props: {
  rows: LineRow[];
  label: string;
  color: string;
  format: (v: number) => string;
  height?: number;
  connectGaps?: boolean;
  bandLabel?: string;
  /** The owner's typical range, drawn as a tinted horizontal band. */
  typical?: { lo: number; hi: number };
  /** A second series on the same axis (e.g. 7-day average), aligned with rows. */
  secondary?: { label: string; values: (number | undefined)[]; color: string };
  /** Highlights this date's axis label. */
  today?: string;
}) {
  const { rows, label, color, format, height = 200, connectGaps = false, bandLabel, typical, secondary, today } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const withValue = rows.map((r, i) => ({ ...r, i })).filter((r) => r.value !== undefined);
  if (!withValue.length) return <div className="viz-plot" ref={ref}><EmptyState /></div>;

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const extra = [...(typical ? [typical.lo, typical.hi] : []), ...(secondary?.values.filter((v): v is number => v !== undefined) ?? [])];
  const lo = Math.min(...withValue.map((r) => r.min ?? r.value!), ...extra);
  const hi = Math.max(...withValue.map((r) => r.max ?? r.value!), ...extra);
  const pad = (hi - lo) * 0.1 || Math.max(1, Math.abs(hi) * 0.02);
  const ticks = niceTicks(lo - pad, hi + pad, 4);
  const y = linear(ticks[0]!, ticks[ticks.length - 1]!, innerH, 0);
  const band = rows.length ? innerW / rows.length : 0;
  const x = (i: number) => i * band + band / 2;
  const fmtTick = axisFormat(ticks);
  const labels = rows.length <= 7 ? new Set(rows.map((_, i) => i)) : labelIndices(rows.length, Math.floor(innerW / 64));
  const dateLabel = (d: string) => (rows.length <= 7 ? dayLabel(d, rows.length) : fmtShortDate(d));
  const secPts = secondary?.values.map((v, i) => (v === undefined ? null : `${x(i)},${y(v)}`)).filter((q): q is string => q !== null) ?? [];

  // Build path segments (break on gaps unless connectGaps).
  const segments: { i: number; v: number }[][] = [];
  let cur: { i: number; v: number }[] = [];
  rows.forEach((r, i) => {
    if (r.value === undefined) {
      if (!connectGaps && cur.length) { segments.push(cur); cur = []; }
      return;
    }
    cur.push({ i, v: r.value });
  });
  if (cur.length) segments.push(cur);
  const linePath = (pts: { i: number; v: number }[]) => pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join("");

  const bandRows = withValue.filter((r) => r.min !== undefined && r.max !== undefined);
  const bandPath = bandRows.length > 1
    ? bandRows.map((r, k) => `${k ? "L" : "M"}${x(r.i)},${y(r.max!)}`).join("") +
      [...bandRows].reverse().map((r) => `L${x(r.i)},${y(r.min!)}`).join("") + "Z"
    : null;

  const last = withValue[withValue.length - 1]!;
  const showDots = withValue.length <= 31;

  const nearest = (px: number) => {
    let best = withValue[0]!, dist = Infinity;
    for (const r of withValue) { const d = Math.abs(x(r.i) - px); if (d < dist) { dist = d; best = r; } }
    return best.i;
  };
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    setActive(nearest(e.clientX - box.left));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = withValue.findIndex((r) => r.i === (active ?? last.i));
    const next = withValue[Math.max(0, Math.min(withValue.length - 1, idx + (e.key === "ArrowRight" ? 1 : -1)))]!;
    setActive(next.i);
  };

  const a = active !== null ? rows[active] : undefined;

  return (
    <div className="viz-plot" ref={ref} onMouseLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${label} by day`} tabIndex={0} onKeyDown={onKey}
          onFocus={() => setActive((v) => v ?? last.i)} onBlur={() => setActive(null)}>
          <g transform={`translate(${M.left},${M.top})`}>
            <g className="viz-grid">
              {ticks.map((t) => <line key={t} x1={0} x2={innerW} y1={y(t)} y2={y(t)} />)}
            </g>
            {ticks.map((t) => <text key={t} x={-8} y={y(t)} dy="0.32em" textAnchor="end">{fmtTick(t)}</text>)}
            {typical && <rect x={0} y={y(typical.hi)} width={innerW} height={Math.max(2, y(typical.lo) - y(typical.hi))} rx={6} fill="var(--viz-band)" />}
            {bandPath && <path d={bandPath} fill={color} opacity={0.1} />}
            {secPts.length > 1 && <path d={`M${secPts.join("L")}`} fill="none" stroke={secondary!.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {segments.map((s, k) =>
              s.length > 1 ? (
                <path key={k} d={linePath(s)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ) : null,
            )}
            {active !== null && <line className="viz-cross" x1={x(active)} x2={x(active)} y1={0} y2={innerH} />}
            {withValue.map((r) =>
              showDots || r.i === last.i || r.i === active || segments.some((s) => s.length === 1 && s[0]!.i === r.i) ? (
                <circle key={r.i} cx={x(r.i)} cy={y(r.value!)} r={4} fill={color} stroke="var(--viz-surface)" strokeWidth={2} />
              ) : null,
            )}
            <text className="viz-label" x={x(last.i) + 8} y={y(last.value!)} dy="0.32em">{format(last.value!)}</text>
            {rows.map((r, i) =>
              labels.has(i) ? <text key={r.date} x={x(i)} y={innerH + 16} textAnchor="middle" className={r.date === today ? "viz-day-today" : undefined}>{dateLabel(r.date)}</text> : null,
            )}
            <rect className="viz-hit" x={0} y={0} width={innerW} height={innerH} onMouseMove={onMove} />
          </g>
        </svg>
      )}
      {a && active !== null && width > 0 && (
        <Tooltip
          x={M.left + x(active)}
          y={M.top}
          width={width}
          head={fmtLongDate(a.date)}
          rows={[
            { label, value: a.value === undefined ? "—" : format(a.value), color },
            ...(a.min !== undefined && a.max !== undefined ? [{ label: bandLabel ?? "Range", value: `${format(a.min)} – ${format(a.max)}` }] : []),
            ...(secondary && secondary.values[active] !== undefined ? [{ label: secondary.label, value: format(secondary.values[active]!), color: secondary.color }] : []),
          ]}
        />
      )}
    </div>
  );
}
