import { Pill, type Status } from "../ui/Pill";

/**
 * A value on a horizontal track, compared with either a target point (dashed
 * circle, e.g. a macro goal) or a range (dashed box, e.g. your typical deep
 * sleep). The status pill states the comparison in words.
 */
export function RangeBar(props: {
  label: string;
  detail?: string;
  value: number | undefined;
  /** Track maximum (value 0 → max maps to the full width). */
  max: number;
  color: string;
  target?: number;
  range?: { lo: number; hi: number };
  /** Tint the range box with this color (stage bars); otherwise it's neutral. */
  rangeTint?: string;
  /** Omit for plain bars without a comparison pill. */
  status?: Status;
  /** Extra control in the label row, e.g. an inline goal editor. */
  action?: React.ReactNode;
  /** Show a knob at the value (quality bars) rather than only a fill. */
  knob?: boolean;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / props.max) * 100))}%`;
  const v = props.value;
  return (
    <div className="range-row">
      <div className="range-head">
        <span><b>{props.label}</b>{props.detail ? ` · ${props.detail}` : ""}</span>
        <span className="range-actions">
          {props.status && <Pill tone={props.status.tone}>{props.status.text}</Pill>}
          {props.action}
        </span>
      </div>
      <div className="range-track" role="img"
        aria-label={`${props.label}: ${props.detail ?? ""}${props.status ? `. ${props.status.text}` : ""}${props.range ? `. Usual range ${Math.round(props.range.lo)}–${Math.round(props.range.hi)}` : ""}`}>
        {v !== undefined && v > 0 && <div className="range-fill" style={{ width: pct(v), background: props.color }} />}
        {/* drawn over the fill, like the reference: the dashed box stays visible where the bar reaches it */}
        {props.range && (
          <div className="range-target" style={{
            left: pct(props.range.lo), width: `max(34px, calc(${pct(props.range.hi)} - ${pct(props.range.lo)}))`,
            ...(props.rangeTint ? { background: `color-mix(in srgb, ${props.rangeTint} 28%, transparent)` } : {}),
          }} />
        )}
        {props.target !== undefined && (
          <div className="range-target" style={{ left: `calc(${pct(props.target)} - 17px)`, width: 34, borderRadius: "50%" }} />
        )}
        {props.knob && v !== undefined && <div className="range-knob" style={{ left: pct(v) }} />}
      </div>
    </div>
  );
}
