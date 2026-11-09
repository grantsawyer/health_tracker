import { GOAL_LIMITS, type Goals } from "../shared/goals";
import { layoutError, type TodayLayout } from "../shared/layout";
import type { FavoriteFood, FoodTemplate } from "../shared/food";

/**
 * "Export my settings" / "Import settings" (docs/browser-migration-plan.md §5):
 * goals, Today layout and favorites as one JSON file, so settings kept by the
 * local server can move to the browser version (and between any two copies).
 * Contains no health data. Values are validated again by core on import.
 */

export const EXPORT_FORMAT = "health-tracker-settings-export";

export interface SettingsExport {
  format: typeof EXPORT_FORMAT;
  version: 1;
  exportedAt: string;
  goals: Goals;
  layout: TodayLayout;
  favorites: FoodTemplate[];
}

export function buildExport(goals: Goals, layout: TodayLayout, favorites: FavoriteFood[], now = new Date()): SettingsExport {
  return { format: EXPORT_FORMAT, version: 1, exportedAt: now.toISOString(), goals, layout, favorites: favorites.map((f) => f.template) };
}

export interface ParsedImport {
  goals?: Partial<Goals>;
  layout?: TodayLayout;
  favorites: FoodTemplate[];
}

/** Check the file's shape; throws an Error with a message for the user. */
export function parseImport(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't JSON. Choose a file made with “Export settings”.");
  }
  const d = data as Partial<SettingsExport> | null;
  if (!d || typeof d !== "object" || d.format !== EXPORT_FORMAT) throw new Error("That file wasn't made with “Export settings”.");
  if (d.version !== 1) throw new Error("That settings file is from a newer version of the app.");

  const out: ParsedImport = { favorites: [] };
  if (d.goals !== undefined) {
    if (!d.goals || typeof d.goals !== "object" || Array.isArray(d.goals)) throw new Error("The goals in that file are malformed.");
    // Keep only known goal keys, so a file from a newer version still imports.
    out.goals = Object.fromEntries(Object.entries(d.goals).filter(([k]) => k in GOAL_LIMITS)) as Partial<Goals>;
  }
  if (d.layout !== undefined) {
    const err = layoutError(d.layout);
    if (err) throw new Error(`The Today layout in that file is invalid: ${err}`);
    out.layout = d.layout;
  }
  if (d.favorites !== undefined) {
    if (!Array.isArray(d.favorites)) throw new Error("The favorites in that file are malformed.");
    out.favorites = d.favorites;
  }
  return out;
}

const key = (t: FoodTemplate) => JSON.stringify(t, Object.keys(t).sort());

/** Favorites from the file that aren't saved already (re-importing the same file adds nothing). */
export function newFavorites(existing: FavoriteFood[], incoming: FoodTemplate[]): FoodTemplate[] {
  const seen = new Set(existing.map((f) => key(f.template)));
  return incoming.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const exportFileName = (now = new Date()) => `health-tracker-settings-${now.toLocaleDateString("en-CA")}.json`;
