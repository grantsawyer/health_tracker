import { useState, type ReactNode } from "react";
import { Pill, type Status } from "../ui/Pill";

export interface LegendItem {
  label: string;
  color: string;
  shape: "rect" | "line" | "band";
}

export interface TableSpec {
  columns: string[];
  rows: (string | number)[][];
}

/**
 * Card chrome shared by every chart: title, subtitle, legend (only for ≥2
 * series), and a Chart/Table toggle. The table view is required: some light-mode
 * series colors are below 3:1 contrast, and it makes values reachable without hovering.
 */
export function ChartCard(props: {
  title: string;
  subtitle?: string;
  /** Headline value under the title, e.g. "6h 06m" (with optional small unit). */
  value?: string;
  unit?: string;
  status?: Status;
  /** Inline goal editor (or any small control) shown in the header. */
  goal?: ReactNode;
  legend?: LegendItem[];
  table: TableSpec;
  loading?: boolean;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={`viz-card ${props.loading ? "viz-loading" : ""}`}>
      <div className="viz-card-head">
        <div>
          <h3 className="viz-card-title">{props.title}</h3>
          {props.value && <p className="viz-card-value">{props.value}{props.unit && <small>{props.unit}</small>}</p>}
          {props.subtitle && <p className="viz-card-sub">{props.subtitle}</p>}
        </div>
        <div className="viz-card-actions">
          {props.status && <Pill tone={props.status.tone}>{props.status.text}</Pill>}
          {props.goal}
        </div>
        <button className="viz-toggle" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
          {showTable ? "Chart" : "Table"}
        </button>
      </div>
      {props.legend && (props.legend.length >= 2 || props.legend.some((l) => l.shape === "band")) && !showTable && (
        <div className="viz-legend">
          {props.legend.map((l) => (
            <span key={l.label}>
              <i className={l.shape === "rect" ? "viz-key-rect" : l.shape === "band" ? "viz-key-band" : "viz-key-line"} style={l.shape === "band" ? undefined : { background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {showTable ? <DataTable spec={props.table} /> : props.children}
    </section>
  );
}

function DataTable({ spec }: { spec: TableSpec }) {
  return (
    <div className="viz-table-wrap">
      <table className="viz-table">
        <thead>
          <tr>{spec.columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {[...spec.rows].reverse().map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface TipRow {
  label: string;
  value: string;
  color?: string;
}

/** One tooltip, every series. Values lead (strong); series names follow. Keys are short line strokes. */
export function Tooltip({ x, y, width, head, rows }: { x: number; y: number; width: number; head: string; rows: TipRow[] }) {
  const flip = x > width * 0.6;
  return (
    <div className="viz-tip" style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y) }}>
      <div className="viz-tip-head">{head}</div>
      {rows.map((r) => (
        <div className="viz-tip-row" key={r.label}>
          {r.color && <i className="viz-key-line" style={{ background: r.color }} />}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export const EmptyState = ({ children = "No data in this range" }: { children?: ReactNode }) => (
  <div className="viz-empty">{children}</div>
);
