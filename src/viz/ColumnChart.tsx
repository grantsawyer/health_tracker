import { useState } from "react";
import { EmptyState, Tooltip } from "./ChartCard";
import { axisFormat, fmtLongDate, fmtShortDate, labelIndices, linear, niceTicks, useWidth } from "./scale";
import { dayLabel } from "../dashboard/period";

export interface ColumnSeries {
  label: string;
  color: string;
}

export interface ColumnRow {
  date: string;
  /** One value per series (stack order, bottom → top). undefined = no data that day. */
  values: (number | undefined)[];
}

const M = { top: 18, right: 8, bottom: 22, left: 44 };
const GAP = 2; // surface gap between touching marks
const MAX_BAR = 30;

/**
 * Rect with independently rounded top and bottom corners. Columns are pill
 * shaped (the design direction from the owner's reference screenshots): the
 * stack's top segment rounds its top, the bottom segment its bottom.
 */
function roundedRect(x: number, y: number, w: number, h: number, rTop: number, rBottom: number): string {
  const t = Math.min(rTop, w / 2, h / 2), b = Math.min(rBottom, w / 2, h / 2);
  return `M${x},${y + t}Q${x},${y} ${x + t},${y}H${x + w - t}Q${x + w},${y} ${x + w},${y + t}V${y + h - b}Q${x + w},${y + h} ${x + w - b},${y + h}H${x + b}Q${x},${y + h} ${x},${y + h - b}Z`;
}

/**
 * Daily column chart; stacked when given several series. Thin columns (≤24px),
 * 4px rounded data-end, 2px surface gaps, recessive grid. Hover/focus a column
 * for a tooltip listing every series; ←/→ move between days when focused.
 */
export function ColumnChart(props: {
  rows: ColumnRow[];
  series: ColumnSeries[];
  format: (v: number) => string;
  height?: number;
  /** Optional goal line; with `badges`, columns at or above it get a check badge. */
  reference?: { value: number; label: string; badges?: boolean };
  /** Optional target range (e.g. goal ± 10%), drawn as a band; with `badges`, columns inside it get a check badge. */
  target?: { lo: number; hi: number; label: string; badges?: boolean };
  /** Override y-axis tick labels (e.g. append a unit). */
  tickFormat?: (v: number) => string;
  /** Highlights this date's axis label. */
  today?: string;
}) {
  const { rows, series, format, height = 200, reference, target, tickFormat, today } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const totals = rows.map((r) => r.values.reduce<number>((s, v) => s + (v ?? 0), 0));
  const hasData = rows.some((r) => r.values.some((v) => v !== undefined));

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const maxV = Math.max(...totals, reference?.value ?? 0, target?.hi ?? 0, 1);
  const ticks = niceTicks(0, maxV, 4);
  const top = ticks[ticks.length - 1]!;
  const y = linear(0, top, innerH, 0);
  const fmtTick = tickFormat ?? axisFormat(ticks);

  const band = rows.length ? innerW / rows.length : 0;
  const barW = Math.max(1, Math.min(MAX_BAR, band * 0.66, band - GAP));
  const labels = rows.length <= 7 ? new Set(rows.map((_, i) => i)) : labelIndices(rows.length, Math.floor(innerW / 64));
  const label = (d: string) => (rows.length <= 7 ? dayLabel(d, rows.length) : fmtShortDate(d));

  // Label the latest column that has data (selective direct label).
  let lastIdx = -1;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.values.some((v) => v !== undefined)) { lastIdx = i; break; }

  const onKey = (e: React.KeyboardEvent) => {
    if (!rows.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const cur = active ?? rows.length - 1;
      setActive(Math.max(0, Math.min(rows.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1))));
    }
  };

  return (
    <div className="viz-plot" ref={ref} onMouseLeave={() => setActive(null)}>
      {!hasData ? (
        <EmptyState />
      ) : width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${series.map((s) => s.label).join(", ")} by day`}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setActive((a) => a ?? lastIdx)}
          onBlur={() => setActive(null)}
        >
          <g transform={`translate(${M.left},${M.top})`}>
            <g className="viz-grid">
              {ticks.slice(1).map((t) => <line key={t} x1={0} x2={innerW} y1={y(t)} y2={y(t)} />)}
            </g>
            {ticks.map((t) => (
              <text key={t} x={-8} y={y(t)} dy="0.32em" textAnchor="end">{fmtTick(t)}</text>
            ))}
            {active !== null && <rect className="viz-col-hover" x={active * band} y={0} width={band} height={innerH} />}
            {target && (
              <g className="viz-target" aria-hidden>
                <rect x={0} y={y(target.hi)} width={innerW} height={y(target.lo) - y(target.hi)} />
              </g>
            )}
            {rows.map((r, i) => {
              const x = i * band + (band - barW) / 2;
              let base = innerH;
              const topIdx = r.values.reduce((t, v, j) => (v ? j : t), -1);
              const bottomIdx = r.values.findIndex((v) => Boolean(v));
              const round = barW / 2;
              const met = (reference?.badges && totals[i]! >= reference.value)
                || (target?.badges && r.values.some((v) => v !== undefined) && totals[i]! >= target.lo && totals[i]! <= target.hi);
              return (
                <g key={r.date}>
                  {r.values.map((v, j) => {
                    if (!v) return null;
                    const h = innerH - y(v);
                    const gap = j > 0 && base < innerH ? GAP : 0;
                    const segH = Math.max(0, h - gap);
                    const yTop = base - gap - segH;
                    base = yTop;
                    if (segH <= 0) return null;
                    return <path key={j} d={roundedRect(x, yTop, barW, segH, j === topIdx ? round : 0, j === bottomIdx ? round : 0)} fill={series[j]!.color} />;
                  })}
                  {met && barW >= 16 && (
                    <g transform={`translate(${x + barW / 2},${y(totals[i]!) + barW / 2})`} aria-hidden>
                      <circle r={barW / 2 - 3} fill="var(--viz-surface)" opacity={0.9} />
                      <path d="M-4.5 0.5l3 3 6-6.5" fill="none" stroke={series[series.length - 1]!.color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                  )}
                </g>
              );
            })}
            {reference && (
              <g>
                <line className="viz-goal" x1={0} x2={innerW} y1={y(reference.value)} y2={y(reference.value)} />
                <text x={innerW} y={y(reference.value) - 5} textAnchor="end">{reference.label}</text>
              </g>
            )}
            {target && <text className="viz-target-label" x={innerW} y={y(target.hi) - 5} textAnchor="end">{target.label}</text>}
            <line className="viz-baseline" x1={0} x2={innerW} y1={innerH} y2={innerH} />
            {lastIdx >= 0 && band >= 14 && (
              <text className="viz-label" x={lastIdx * band + band / 2} y={y(totals[lastIdx]!) - 5} textAnchor="middle">
                {format(totals[lastIdx]!)}
              </text>
            )}
            {rows.map((r, i) =>
              labels.has(i) ? (
                <text key={r.date} x={i * band + band / 2} y={innerH + 16} textAnchor="middle" className={r.date === today ? "viz-day-today" : undefined}>{label(r.date)}</text>
              ) : null,
            )}
            {rows.map((r, i) => (
              <rect key={r.date} className="viz-hit" x={i * band} y={0} width={band} height={innerH} onMouseMove={() => setActive(i)} />
            ))}
          </g>
        </svg>
      ) : null}
      {active !== null && rows[active] && width > 0 && (
        <Tooltip
          x={M.left + active * band + band / 2}
          y={M.top}
          width={width}
          head={fmtLongDate(rows[active]!.date)}
          rows={[
            ...series
              .map((s, j) => ({ label: s.label, value: rows[active]!.values[j] === undefined ? "—" : format(rows[active]!.values[j]!), color: s.color }))
              .reverse(),
            ...(series.length > 1 ? [{ label: "Total", value: format(totals[active]!) }] : []),
          ]}
        />
      )}
    </div>
  );
}
