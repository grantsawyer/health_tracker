import { useState, type ReactNode } from "react";
import { slotSize, slotsUsed, type LayoutSection, type MetricId } from "../../shared/layout";
import { Icon } from "../ui/icons";
import { metricsFor, type MetricDef } from "./cards";
import type { ViewCtx } from "./ctx";

/**
 * A section of cards that can be rearranged while customizing: drag a card onto
 * another to move it there, or use the ‹ › buttons (keyboard accessible);
 * × removes it. An "Add a card" slot opens the picker while spaces remain.
 */
export function CardBoard(props: {
  section: LayoutSection;
  ids: MetricId[];
  limit: number;
  editing: boolean;
  className: string;
  ctx: ViewCtx;
  render: (def: MetricDef) => ReactNode;
  onChange: (ids: MetricId[]) => void;
  defs: Map<MetricId, MetricDef>;
}) {
  const { ids, editing, onChange, defs } = props;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const sectionName = props.section === "today" ? "Today" : "Last 7 days";
  const used = slotsUsed(props.section, ids);
  const free = props.limit - used;
  const sizeOf = (id: MetricId) => (props.section === "today" ? slotSize(id) : 1);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length || from === to) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };

  return (
    <>
      <div className={`${props.className} ${editing ? "board-editing" : ""}`}>
        {ids.map((id, i) => {
          const def = defs.get(id);
          if (!def) return null;
          const span = sizeOf(id) > 1 ? ` span-${sizeOf(id)}` : "";
          if (!editing) return <div key={id} className={`board-item${span}`}>{props.render(def)}</div>;
          return (
            <div key={id}
              className={`board-item${span} editing ${dragIndex === i ? "dragging" : ""} ${overIndex === i && dragIndex !== i ? "drop-target" : ""}`}
              draggable
              onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); }}
              onDragOver={(e) => { e.preventDefault(); setOverIndex(i); }}
              onDragLeave={() => setOverIndex((o) => (o === i ? null : o))}
              onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) move(dragIndex, i); setDragIndex(null); setOverIndex(null); }}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}>
              <div className="board-card" aria-hidden="true" inert>{props.render(def)}</div>
              <div className="board-tools" role="group" aria-label={`${def.label} card in ${sectionName}`}>
                <span className="board-handle" title="Drag to move" aria-hidden="true">⠿</span>
                <button className="board-btn" aria-label={`Move ${def.label} earlier in ${sectionName}`} disabled={i === 0} onClick={() => move(i, i - 1)}><Icon.chevronLeft /></button>
                <button className="board-btn" aria-label={`Move ${def.label} later in ${sectionName}`} disabled={i === ids.length - 1} onClick={() => move(i, i + 1)}><Icon.chevronRight /></button>
                <button className="board-btn board-remove" aria-label={`Remove ${def.label} from ${sectionName}`} onClick={() => onChange(ids.filter((x) => x !== id))}>×</button>
              </div>
            </div>
          );
        })}
        {editing && free > 0 && (
          <button className="board-add" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
            <Icon.plus /> Add a card
            <span className="board-add-count">{used} of {props.limit} spaces used</span>
          </button>
        )}
      </div>
      {editing && picking && free > 0 && (
        <CardPicker section={props.section} sectionName={sectionName} used={ids} ctx={props.ctx} free={free} sizeOf={sizeOf}
          onPick={(id) => { onChange([...ids, id]); if (free - sizeOf(id) <= 0) setPicking(false); }}
          onClose={() => setPicking(false)} />
      )}
      {editing && free <= 0 && <p className="muted small">{sectionName} is full ({props.limit} {props.section === "today" ? "spaces" : "cards"}). Remove a card to add another.</p>}
    </>
  );
}

function CardPicker({ section, sectionName, used, ctx, free, sizeOf, onPick, onClose }: {
  section: LayoutSection; sectionName: string; used: MetricId[]; ctx: ViewCtx; free: number; sizeOf: (id: MetricId) => number;
  onPick: (id: MetricId) => void; onClose: () => void;
}) {
  const options = metricsFor(section).filter((m) => !used.includes(m.id));
  const groups = [...new Set(options.map((m) => m.group))];
  return (
    <section className="card card-wide picker" aria-label={`Add a card to ${sectionName}`}>
      <div className="food-panel-head">
        <h2>Add to {sectionName}</h2>
        <button onClick={onClose}>Close</button>
      </div>
      {!options.length && <p className="muted">Every available card is already in this section.</p>}
      {groups.map((group) => (
        <div key={group} className="picker-group">
          <h3>{group}</h3>
          <div className="picker-options">
            {options.filter((m) => m.group === group).map((m) => {
              const has = m.available(ctx);
              const fits = sizeOf(m.id) <= free;
              return (
                <button key={m.id} className={`picker-option tone-${m.tone}`} onClick={() => onPick(m.id)} disabled={!fits}>
                  <span className="tile-icon"><m.icon /></span>
                  <span className="picker-text">
                    <span>{m.label}{sizeOf(m.id) > 1 ? ` (${sizeOf(m.id)} spaces)` : ""}</span>
                    {!fits && <span className="picker-note">Needs {sizeOf(m.id)} free spaces</span>}
                    {fits && !has && <span className="picker-note">No data in the last 30 days</span>}
                  </span>
                  <Icon.plus />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
