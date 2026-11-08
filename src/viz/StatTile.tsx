import { linear } from "./scale";

/**
 * Stat tile: label · value (+unit) · optional delta vs a named period · optional
 * sparkline (muted line, latest point in the accent). `hero` renders the one
 * ≥48px headline number a view leads with.
 */
export function StatTile(props: {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  trend?: (number | undefined)[];
  hero?: boolean;
  accent?: string;
}) {
  return (
    <div className={`viz-tile ${props.hero ? "viz-hero" : ""}`}>
      <div className="viz-tile-label">{props.label}</div>
      <div className="viz-tile-value">
        {props.value}
        {props.unit && <span className="viz-tile-unit">{props.unit}</span>}
      </div>
      {props.delta && <div className="viz-tile-delta">{props.delta}</div>}
      {props.trend && <Sparkline values={props.trend} accent={props.accent ?? "var(--series-1)"} />}
    </div>
  );
}

function Sparkline({ values, accent }: { values: (number | undefined)[]; accent: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== undefined);
  if (pts.length < 2) return null;
  const w = 160, h = 32;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const x = linear(0, values.length - 1, 4, w - 4);
  const y = linear(lo, hi === lo ? lo + 1 : hi, h - 4, 4);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join("");
  const last = pts[pts.length - 1]!;
  return (
    <svg className="viz-tile-spark" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden>
      <path d={d} fill="none" stroke="var(--viz-muted)" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.7} />
      <circle cx={x(last.i)} cy={y(last.v)} r={3} fill={accent} />
    </svg>
  );
}
