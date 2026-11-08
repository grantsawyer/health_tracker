/**
 * Food logging contract (server/food.ts ↔ src/food/*).
 *
 * Google Health constraints, verified live 2026-11-08:
 * - `food` is read-only (list/get). Apps cannot create foods, so "My foods" is
 *   the owner's existing private food library (listed first, before public foods).
 * - A log against a food ("identified") gets nutrition computed by Google from
 *   the food × serving, and can be edited with patch.
 * - A log without a food ("quick add" / anonymous) cannot be patched. Editing
 *   one = create the replacement, then delete the original.
 * - The app may only edit/delete entries it wrote (same OAuth client).
 */

export const LOG_MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export type LogMealType = (typeof LOG_MEAL_TYPES)[number];

export interface FoodServingOption {
  /** food-measurement-unit resource name */
  unit: string;
  label: string;
  plural?: string;
  /** Fraction of the food's default serving that ONE of this unit represents. */
  multiplier: number;
}

export interface LibraryFood {
  /** food resource name (users/me/dataTypes/food/dataPoints/{id}) */
  name: string;
  displayName: string;
  brand?: string;
  defaultServing: { unit: string; label: string; amount: number };
  servings: FoodServingOption[];
  /** Nutrition per default serving. */
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}

export interface FoodLogEntry {
  /** nutrition-log resource name (users/me/...) */
  id: string;
  /** Local wall-clock "YYYY-MM-DDTHH:mm" */
  timeLocal: string;
  mealType: string;
  displayName: string;
  /** food resource name if logged against a food */
  food?: string;
  serving?: { amount: number; unit?: string; label?: string };
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
  /** Written by this app's OAuth client → may be edited/deleted. */
  editable: boolean;
  source?: string;
}

export interface FoodLogDay {
  date: string;
  entries: FoodLogEntry[];
  totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };
}

/** A loggable item: a library food at an amount, or a quick-add with fixed nutrition. */
export type FoodTemplate =
  | { kind: "food"; food: string; displayName: string; amount: number; unit?: string; label?: string; kcal?: number }
  | { kind: "quick"; displayName: string; kcal: number; proteinG?: number; carbsG?: number; fatG?: number; fiberG?: number; sugarG?: number; sodiumMg?: number };

/** Recently logged items, for one-tap re-logging. */
export type RecentFood = FoodTemplate & { lastLogged: string };

/** A saved favorite (stored locally in ~/.health_tracker/app.db). */
export interface FavoriteFood {
  id: string;
  template: FoodTemplate;
}

interface NewEntryBase {
  mealType: LogMealType;
  /** Local wall-clock "YYYY-MM-DDTHH:mm" */
  timeLocal: string;
  /** Seconds east of UTC at that time (browser-provided). */
  utcOffsetSeconds: number;
}

export type NewFoodLogEntry =
  | (NewEntryBase & { kind: "food"; food: string; unit: string; amount: number })
  | (NewEntryBase & {
      kind: "quick";
      displayName: string;
      kcal: number;
      proteinG?: number;
      carbsG?: number;
      fatG?: number;
      fiberG?: number;
      sugarG?: number;
      sodiumMg?: number;
    });

/** An entry saved locally because Google was unavailable; retried in the background. */
export interface PendingFoodWrite {
  id: string;
  label: string;
  timeLocal: string;
  attempts: number;
  lastError?: string;
  /** Google rejected it permanently (e.g. invalid). It won't be retried automatically. */
  failed: boolean;
  nextAttemptAt: string;
}

export type CreateResult = { status: "saved"; entry: FoodLogEntry } | { status: "queued"; pending: PendingFoodWrite };

/** Nutrition values from Open Food Facts (per 100 g or per serving). */
export interface OffNutrition {
  kcal: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
}

/** A product from Open Food Facts (search result or barcode lookup). */
export interface OffProduct {
  code: string;
  name: string;
  brand?: string;
  /** As printed, e.g. "1 cup (227 g)" */
  servingSize?: string;
  servingGrams?: number;
  per100g: OffNutrition;
  perServing?: OffNutrition;
}
