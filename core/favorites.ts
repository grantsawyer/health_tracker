import { FoodInputError } from "./errors.js";
import { platform } from "./platform.js";
import type { FavoriteFood, FoodTemplate } from "../shared/food.js";

const FOOD_NAME = /^users\/me\/dataTypes\/food\/dataPoints\/[^/]+$/;
const UNIT_NAME = /^users\/me\/dataTypes\/food-measurement-unit\/dataPoints\/[^/]+$/;
const MAX_FAVORITES = 200;

const optNum = (v: unknown, label: string, max: number): number | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) throw new FoodInputError(`${label} must be between 0 and ${max}`);
  return v;
};

/** Validate an untrusted template (only known fields are kept). */
export function parseTemplate(body: unknown): FoodTemplate {
  const b = (body ?? {}) as Record<string, unknown>;
  const displayName = typeof b.displayName === "string" ? b.displayName.trim().slice(0, 100) : "";
  if (!displayName) throw new FoodInputError("displayName is required");
  if (b.kind === "food") {
    if (typeof b.food !== "string" || !FOOD_NAME.test(b.food)) throw new FoodInputError("food must be a food resource name");
    if (b.unit !== undefined && (typeof b.unit !== "string" || !UNIT_NAME.test(b.unit))) throw new FoodInputError("unit must be a unit resource name");
    const amount = optNum(b.amount, "amount", 10_000);
    if (!amount) throw new FoodInputError("amount must be more than 0");
    return {
      kind: "food", food: b.food, displayName, amount,
      unit: b.unit as string | undefined,
      label: typeof b.label === "string" ? b.label.slice(0, 40) : undefined,
      kcal: optNum(b.kcal, "kcal", 10_000),
    };
  }
  if (b.kind === "quick") {
    const kcal = optNum(b.kcal, "kcal", 10_000);
    if (kcal === undefined) throw new FoodInputError("kcal is required");
    return {
      kind: "quick", displayName, kcal,
      proteinG: optNum(b.proteinG, "proteinG", 1000), carbsG: optNum(b.carbsG, "carbsG", 1000), fatG: optNum(b.fatG, "fatG", 1000),
      fiberG: optNum(b.fiberG, "fiberG", 1000), sugarG: optNum(b.sugarG, "sugarG", 1000), sodiumMg: optNum(b.sodiumMg, "sodiumMg", 50_000),
    };
  }
  throw new FoodInputError('kind must be "food" or "quick"');
}

/** Stored per user as one settings entry (the browser build keeps it in the same shape). */
interface StoredFavorite {
  id: string;
  label: string;
  template: FoodTemplate;
  createdAt: number;
}
const load = async () => (await platform().settings.get<StoredFavorite[]>("favorites")) ?? [];
const byLabel = (a: StoredFavorite, b: StoredFavorite) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" });

export async function getFavorites(): Promise<FavoriteFood[]> {
  return (await load()).sort(byLabel).map((f) => ({ id: f.id, template: f.template }));
}

export async function saveFavorite(body: unknown): Promise<FavoriteFood> {
  const template = parseTemplate(body);
  const existing = await load();
  if (existing.length >= MAX_FAVORITES) throw new FoodInputError(`You can keep up to ${MAX_FAVORITES} favorites`);
  const label = template.kind === "food" ? `${template.displayName} · ${template.amount} ${template.label ?? ""}`.trim() : template.displayName;
  const fav: StoredFavorite = { id: globalThis.crypto.randomUUID(), label, template, createdAt: Date.now() };
  await platform().settings.put("favorites", [...existing, fav]);
  return { id: fav.id, template };
}

export async function removeFavorite(id: string): Promise<boolean> {
  if (typeof id !== "string" || id.length > 64) throw new FoodInputError("Invalid favorite id");
  const existing = await load();
  const next = existing.filter((f) => f.id !== id);
  if (next.length === existing.length) return false;
  await platform().settings.put("favorites", next);
  return true;
}
