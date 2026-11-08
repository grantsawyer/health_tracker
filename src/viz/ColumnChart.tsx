import { useState } from "react";
import { EmptyState, Tooltip } from "./ChartCard";
import { axisFormat, fmtLongDate, fmtShortDate, labelIndices, linear, niceTicks, useWidth } from "./scale";

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
const MAX_BAR = 24;
const RADIUS = 4;

/** Rect with only the top corners rounded (data-end rounded, square at the baseline). */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
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
  /** Optional reference line (e.g. a goal), drawn as a hairline with a label. */
  reference?: { value: number; label: string };
  /** Override y-axis tick labels (e.g. append a unit). */
  tickFormat?: (v: number) => string;
}) {
  const { rows, series, format, height = 180, reference, tickFormat } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const totals = rows.map((r) => r.values.reduce<number>((s, v) => s + (v ?? 0), 0));
  const hasData = rows.some((r) => r.values.some((v) => v !== undefined));

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const maxV = Math.max(...totals, reference?.value ?? 0, 1);
  const ticks = niceTicks(0, maxV, 4);
  const top = ticks[ticks.length - 1]!;
  const y = linear(0, top, innerH, 0);
  const fmtTick = tickFormat ?? axisFormat(ticks);

  const band = rows.length ? innerW / rows.length : 0;
  const barW = Math.max(1, Math.min(MAX_BAR, band * 0.66, band - GAP));
  const labels = labelIndices(rows.length, Math.floor(innerW / 64));

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
            {rows.map((r, i) => {
              const x = i * band + (band - barW) / 2;
              let base = innerH;
              const topIdx = r.values.reduce((t, v, j) => (v ? j : t), -1);
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
                    return j === topIdx ? (
                      <path key={j} d={topRoundedRect(x, yTop, barW, segH, RADIUS)} fill={series[j]!.color} />
                    ) : (
                      <rect key={j} x={x} y={yTop} width={barW} height={segH} fill={series[j]!.color} />
                    );
                  })}
                </g>
              );
            })}
            {reference && (
              <g>
                <line className="viz-baseline" x1={0} x2={innerW} y1={y(reference.value)} y2={y(reference.value)} />
                <text x={innerW} y={y(reference.value) - 4} textAnchor="end">{reference.label}</text>
              </g>
            )}
            <line className="viz-baseline" x1={0} x2={innerW} y1={innerH} y2={innerH} />
            {lastIdx >= 0 && band >= 14 && (
              <text className="viz-label" x={lastIdx * band + band / 2} y={y(totals[lastIdx]!) - 5} textAnchor="middle">
                {format(totals[lastIdx]!)}
              </text>
            )}
            {rows.map((r, i) =>
              labels.has(i) ? (
                <text key={r.date} x={i * band + band / 2} y={innerH + 15} textAnchor="middle">{fmtShortDate(r.date)}</text>
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
