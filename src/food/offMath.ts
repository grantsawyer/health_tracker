import type { FoodTemplate, OffNutrition, OffProduct } from "../../shared/food";

/** Pure helpers for Open Food Facts drafts (kept out of the component so they're unit-testable). */

export type OffDraft = { kind: "off"; product: OffProduct; unit: "g" | "serving"; amount: string };

const r1 = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 10) / 10);

/** Nutrition for an Open Food Facts draft at its current amount, or undefined if it can't be computed. */
export function offNutrition(d: OffDraft): OffNutrition | undefined {
  const amount = Number(d.amount);
  if (!(amount > 0)) return undefined;
  const { per100g, perServing, servingGrams } = d.product;
  let base: OffNutrition, factor: number;
  if (d.unit === "serving") {
    if (perServing) [base, factor] = [perServing, amount];
    else if (servingGrams) [base, factor] = [per100g, (servingGrams * amount) / 100];
    else return undefined;
  } else {
    [base, factor] = [per100g, amount / 100];
  }
  const scale = (v: number | undefined) => r1(v === undefined ? undefined : v * factor);
  return {
    kcal: Math.round(base.kcal * factor), proteinG: scale(base.proteinG), carbsG: scale(base.carbsG), fatG: scale(base.fatG),
    fiberG: scale(base.fiberG), sugarG: scale(base.sugarG), sodiumMg: base.sodiumMg === undefined ? undefined : Math.round(base.sodiumMg * factor),
  };
}

/** "1 serving (150 g)" → "150 g"; "30 g" → "30 g". */
export const servingText = (p: OffProduct) => {
  if (!p.servingSize) return p.servingGrams ? `${p.servingGrams} g` : undefined;
  const cleaned = p.servingSize.replace(/^1\s*servings?\s*/i, "").replace(/^\((.*)\)$/, "$1").trim();
  return cleaned || p.servingSize;
};
export const offName = (p: OffProduct) => (p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.name} (${p.brand})` : p.name).slice(0, 100);
export const offLabel = (d: OffDraft) =>
  d.unit === "g" ? `${d.amount} g` : `${d.amount} serving${Number(d.amount) === 1 ? "" : "s"}${servingText(d.product) ? ` (${servingText(d.product)})` : ""}`;

/** An Open Food Facts draft becomes a quick-add with the scaled nutrition (Google can't store OFF foods). */
export function offToQuick(d: OffDraft): Extract<FoodTemplate, { kind: "quick" }> | null {
  const n = offNutrition(d);
  return n ? { kind: "quick", displayName: `${offName(d.product)}, ${offLabel(d)}`.slice(0, 100), ...n } : null;
}

