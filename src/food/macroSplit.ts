/**
 * One food's macro balance as shares of its macro calories (carbs 4, fat 9, protein 4 kcal/g), the same split the
 * day summary uses. Order and colors match the macro charts. Null when the entry has no macro grams (e.g. a
 * calories-only quick add), so no bar is drawn.
 */
export const MACROS = [
  { key: "carbsG", label: "Carbs", kcalPerG: 4, color: "var(--macro-carbs)" },
  { key: "fatG", label: "Fat", kcalPerG: 9, color: "var(--macro-fat)" },
  { key: "proteinG", label: "Protein", kcalPerG: 4, color: "var(--macro-protein)" },
] as const;

export interface MacroShare {
  key: (typeof MACROS)[number]["key"];
  label: string;
  color: string;
  grams: number;
  /** Share of the food's macro calories, 0–100. */
  pct: number;
}

export function macroSplit(food: { carbsG?: number; fatG?: number; proteinG?: number }): MacroShare[] | null {
  const parts = MACROS.map((m) => {
    const grams = Math.max(0, food[m.key] ?? 0);
    return { key: m.key, label: m.label, color: m.color, grams, kcal: grams * m.kcalPerG };
  });
  const total = parts.reduce((t, p) => t + p.kcal, 0);
  if (!total) return null;
  return parts.map(({ kcal, ...p }) => ({ ...p, pct: (kcal / total) * 100 }));
}

/** "Carbs 55% · Fat 30% · Protein 15% of calories" (rounded; shares under 0.5% read as 0%). */
export const describeSplit = (split: MacroShare[]) =>
  `${split.map((s) => `${s.label} ${Math.round(s.pct)}%`).join(" · ")} of calories`;
