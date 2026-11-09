import { useState } from "react";
import { Pill, type Status } from "../ui/Pill";
import { Icon } from "../ui/icons";
import { Tooltip } from "./ChartCard";
import { fmtLongDate, labelIndices, linear, useWidth } from "./scale";
import { dayLabel } from "../dashboard/period";

/**
 * Overview card: title · headline value · compact trend · status pill.
 * Bars are pill-shaped; with a goal, bars that meet it are drawn solid with a
 * check badge and the rest lighter, plus a goal line. Lines can show the
 * owner's typical range as a tinted band. Hover/focus a day for its value.
 */
export interface MiniTrendProps {
  title: string;
  value: string;
  unit?: string;
  dates: string[];
  values: (number | undefined)[];
  kind: "bars" | "line";
  color: string;
  format: (v: number) => string;
  goal?: number | null;
  band?: { lo: number; hi: number };
  today?: string;
  status?: Status;
  onOpen?: () => void;
  /** Accessible summary of the whole card, e.g. "Steps, last 7 days". */
  label: string;
}

const H = 124;
const LABEL_H = 22;

export function MiniTrend(p: MiniTrendProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = p.dates.length;
  const present = p.values.filter((v): v is number => v !== undefined);
  const plotH = H - LABEL_H;
  const top = 12;

  let lo = 0, hi = 1;
  if (p.kind === "bars") {
    hi = Math.max(1, ...present, p.goal ?? 0) * 1.05;
  } else {
    const all = [...present, ...(p.band ? [p.band.lo, p.band.hi] : [])];
    lo = all.length ? Math.min(...all) : 0;
    hi = all.length ? Math.max(...all) : 1;
    const pad = (hi - lo) * 0.25 || Math.max(1, Math.abs(hi) * 0.05);
    lo -= pad;
    hi += pad;
  }
  const y = linear(lo, hi, plotH, top);
  const band = n ? width / n : 0;
  const cx = (i: number) => i * band + band / 2;
  const barW = Math.max(3, Math.min(26, band * 0.62, band - 3));
  const labels = n <= 7 ? new Set(p.dates.map((_, i) => i)) : labelIndices(n, Math.max(2, Math.floor(width / 56)));
  const showBadges = barW >= 18;

  const body = (
    <>
      <div className="mini-title">{p.title}</div>
      <div className="mini-value">{p.value}{p.unit && <small>{p.unit}</small>}</div>
      <div className="mini-chart" ref={ref} onMouseLeave={() => setActive(null)} style={{ position: "relative" }}>
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label={p.label}>
            {p.kind === "line" && p.band && (
              <rect x={0} y={y(p.band.hi)} width={width} height={Math.max(2, y(p.band.lo) - y(p.band.hi))} rx={6} fill="var(--viz-band)" />
            )}
            {p.goal ? <line className="viz-goal" x1={0} x2={width} y1={y(p.goal)} y2={y(p.goal)} /> : null}
            {p.kind === "bars"
              ? p.values.map((v, i) => {
                  if (v === undefined || v <= 0) {
                    // Empty day: a faint stub so the week reads as seven slots.
                    return <rect key={i} x={cx(i) - barW / 2} y={plotH - barW} width={barW} height={barW} rx={barW / 2} fill="var(--viz-track)" />;
                  }
                  const h = Math.max(barW, plotH - y(v));
                  const met = p.goal ? v >= p.goal : true;
                  return (
                    <g key={i}>
                      <rect x={cx(i) - barW / 2} y={plotH - h} width={barW} height={h} rx={barW / 2} fill={p.color} opacity={met ? 1 : 0.55} />
                      {met && p.goal && showBadges && (
                        <g transform={`translate(${cx(i)},${plotH - h + barW / 2})`}>
                          <circle r={barW / 2 - 2} fill="var(--viz-surface)" opacity={0.92} />
                          <path d="M-4.5 0.5l3 3 6-6.5" fill="none" stroke={p.color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                        </g>
                      )}
                    </g>
                  );
                })
              : (() => {
                  const pts = p.values.map((v, i) => (v === undefined ? null : ([cx(i), y(v)] as const))).filter((q): q is readonly [number, number] => q !== null);
                  return (
                    <>
                      {pts.length > 1 && <path d={pts.map(([x, yy], k) => `${k ? "L" : "M"}${x},${yy}`).join("")} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
                      {pts.length <= 31 && pts.map(([x, yy], k) => <circle key={k} cx={x} cy={yy} r={4.5} fill={p.color} stroke="var(--viz-surface)" strokeWidth={2} />)}
                    </>
                  );
                })()}
            {active !== null && <rect className="viz-col-hover" x={active * band} y={0} width={band} height={plotH} rx={8} />}
            {p.dates.map((d, i) => {
              if (!labels.has(i)) return null;
              const isToday = d === p.today;
              return (
                <g key={d}>
                  {isToday && n <= 7 && <circle cx={cx(i)} cy={H - 8} r={10} fill="var(--surface-3)" />}
                  <text x={cx(i)} y={H - 4} textAnchor="middle" className={isToday ? "viz-day-today" : undefined}>{dayLabel(d, n)}</text>
                </g>
              );
            })}
            {p.dates.map((d, i) => <rect key={d} className="viz-hit" x={i * band} y={0} width={band} height={H} onMouseMove={() => setActive(i)} />)}
          </svg>
        )}
        {active !== null && width > 0 && (
          <Tooltip x={cx(active)} y={0} width={width} head={fmtLongDate(p.dates[active]!)}
            rows={[{ label: p.title, value: p.values[active] === undefined ? "No data" : p.format(p.values[active]!), color: p.color }]} />
        )}
      </div>
      {p.status && <div className="mini-foot"><Pill tone={p.status.tone}>{p.status.tone === "good" && p.status.text.startsWith("Goal") ? <><Icon.check /> </> : null}{p.status.text}</Pill></div>}
    </>
  );

  return p.onOpen ? (
    <button className="mini-card" onClick={p.onOpen} aria-label={`${p.label}: ${p.value}${p.unit ?? ""}. Open details`}>{body}</button>
  ) : (
    <div className="mini-card">{body}</div>
  );
}
