import { describeSplit, macroSplit } from "./macroSplit";

/** A thin proportion bar of one food's carbs / fat / protein (share of macro calories). Nothing without macros. */
export function MacroSplitBar({ food }: { food: { carbsG?: number; fatG?: number; proteinG?: number } }) {
  const split = macroSplit(food);
  if (!split) return null;
  const label = describeSplit(split);
  return (
    <span className="macro-split" role="img" aria-label={label} title={label}>
      {split.filter((s) => s.pct > 0).map((s) => (
        <span key={s.key} className="macro-split-seg" style={{ flexGrow: s.pct, background: s.color }} />
      ))}
    </span>
  );
}
