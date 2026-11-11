import { describeSplit, macroSplit } from "./macroSplit";

/**
 * One food's carbs / fat / protein as three small vertical bars (owner request 2026-11-11), each filled to that
 * macro's share of the food's macro calories. All three tracks are always drawn so heights compare at a glance;
 * exact shares are in the label/tooltip. Nothing for calories-only entries.
 */
export function MacroSplitBar({ food }: { food: { carbsG?: number; fatG?: number; proteinG?: number } }) {
  const split = macroSplit(food);
  if (!split) return null;
  const label = describeSplit(split);
  return (
    <span className="macro-bars" role="img" aria-label={label} title={label}>
      {split.map((s) => (
        <span key={s.key} className="macro-bar">
          <span className="macro-bar-fill" style={{ height: `${s.pct}%`, background: s.color }} />
        </span>
      ))}
    </span>
  );
}
