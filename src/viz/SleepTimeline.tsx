import { useState } from "react";
import { Tooltip } from "./ChartCard";
import { useWidth } from "./scale";
import { fmtDuration } from "../units";
import type { SleepSession } from "../../shared/summary";

/**
 * Hypnogram: one lane per stage (awake on top, deep at the bottom) with the
 * night's segments drawn as rounded blocks, and thin links where the sleeper
 * moved between stages. Each lane is labelled with its total, so identity
 * never depends on color alone.
 */
const ORDER = ["awake", "restless", "rem", "light", "asleep", "deep"] as const;
const LABEL: Record<string, string> = { awake: "Awake", restless: "Restless", rem: "REM", light: "Light", asleep: "Asleep", deep: "Deep" };
const COLOR: Record<string, string> = {
  awake: "var(--stage-awake)", restless: "var(--stage-awake)", rem: "var(--stage-rem)",
  light: "var(--stage-light)", asleep: "var(--stage-light)", deep: "var(--stage-deep)",
};

const LANE = 22, LABEL_H = 26, GAP = 12, AXIS = 44;

const clock = (startLocal: string, plusMin: number) => {
  const [h = 0, m = 0] = startLocal.slice(11, 16).split(":").map(Number);
  const t = (((Math.round(h * 60 + m + plusMin)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export function SleepTimeline({ session }: { session: SleepSession }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const segs = session.segments;
  const lanes = ORDER.filter((s) => segs.some((x) => x.stage === s));
  if (!segs.length || !lanes.length) return <p className="muted">No stage data for this night.</p>;

  const total = Math.max(...segs.map((s) => s.to), session.minutesInBed);
  const laneTop = (i: number) => i * (LABEL_H + LANE + GAP) + LABEL_H;
  const height = laneTop(lanes.length - 1) + LANE + AXIS;
  const x = (min: number) => (min / total) * width;
  const minutesBy = (stage: string) => segs.filter((s) => s.stage === stage).reduce((t, s) => t + (s.to - s.from), 0);
  const laneOf = (stage: string) => lanes.indexOf(stage as (typeof lanes)[number]);

  return (
    <div className="viz-plot hypno" ref={ref} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img"
          aria-label={`Sleep stages: ${lanes.map((l) => `${LABEL[l]} ${fmtDuration(minutesBy(l))}`).join(", ")}`}>
          {lanes.map((l, i) => (
            <g key={l}>
              <text className="hypno-lane-label" x={0} y={laneTop(i) - 8}>
                {LABEL[l]} · <tspan className="v">{fmtDuration(minutesBy(l))}</tspan>
              </text>
              <rect className="hypno-track" x={0} y={laneTop(i)} width={width} height={LANE} rx={LANE / 2} />
            </g>
          ))}
          {/* transitions between consecutive segments */}
          {segs.slice(1).map((s, k) => {
            const prev = segs[k]!;
            const a = laneOf(prev.stage), b = laneOf(s.stage);
            if (a < 0 || b < 0 || a === b) return null;
            const y1 = laneTop(Math.min(a, b)) + LANE / 2, y2 = laneTop(Math.max(a, b)) + LANE / 2;
            return <line key={k} className="hypno-link" x1={x(s.from)} x2={x(s.from)} y1={y1} y2={y2} />;
          })}
          {segs.map((s, k) => {
            const li = laneOf(s.stage);
            if (li < 0) return null;
            const w = Math.max(3, x(s.to) - x(s.from));
            return (
              <rect key={k} x={x(s.from)} y={laneTop(li)} width={w} height={LANE} rx={Math.min(LANE / 2, w / 2)} fill={COLOR[s.stage]}
                opacity={hover === null || hover === k ? 1 : 0.5} onMouseMove={() => setHover(k)} />
            );
          })}
          <text className="hypno-axis-strong" x={0} y={height - 24}>{clock(session.startLocal, 0)}</text>
          <text className="hypno-axis" x={0} y={height - 6}>Into bed</text>
          <text className="hypno-axis-strong" x={width / 2} y={height - 24} textAnchor="middle">{clock(session.startLocal, total / 2)}</text>
          <text className="hypno-axis-strong" x={width} y={height - 24} textAnchor="end">{clock(session.startLocal, total)}</text>
          <text className="hypno-axis" x={width} y={height - 6} textAnchor="end">Out of bed</text>
        </svg>
      )}
      {hover !== null && segs[hover] && (
        <Tooltip x={x((segs[hover].from + segs[hover].to) / 2)} y={laneTop(Math.max(0, laneOf(segs[hover].stage))) + LANE + 6} width={width}
          head={`${clock(session.startLocal, segs[hover].from)} – ${clock(session.startLocal, segs[hover].to)}`}
          rows={[{ label: LABEL[segs[hover].stage]!, value: fmtDuration(segs[hover].to - segs[hover].from), color: COLOR[segs[hover].stage] }]} />
      )}
    </div>
  );
}
