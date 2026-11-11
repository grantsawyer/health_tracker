import type { SettingsSyncInfo, SetupInfo, StatusResponse } from "../shared/types";
import type { DataTypeInfo } from "../shared/dataTypes";
import type { SummaryResponse } from "../shared/summary";
import type { Goals } from "../shared/goals";
import type { TodayLayout } from "../shared/layout";
import type { CreateResult, FavoriteFood, FoodLogDay, FoodLogEntry, FoodTemplate, LibraryFood, NewFoodLogEntry, OffProduct, PendingFoodWrite, RecentFood } from "../shared/food";

/** Errors from either backend, with the same status codes and `error` keys. */
export class ApiError extends Error {
  constructor(public status: number, public body: { error?: string; message?: string; google?: unknown } | undefined) {
    super(body?.message ?? `Request failed (${status})`);
  }
}

export type DataTypeWithGrant = DataTypeInfo & { granted: boolean };
export type Source = "all" | "self" | "googleSources" | "googleWearables";

export interface CachedMeta {
  cached: boolean;
  fetchedAt: string;
}
export type PointsResponse = CachedMeta & { dataPoints: Array<Record<string, unknown> & { name?: string }>; truncated: boolean };
export type RollupResponse = CachedMeta & { days: Array<Record<string, unknown>> };

export interface RangeQuery {
  start: string;
  end: string;
  source?: Source;
  fresh?: boolean;
}

/** Everything the UI asks of the backend. Implemented by api.browser.ts (core/ + platform/ in the page). */
export interface Api {
  status(): Promise<StatusResponse>;
  /** `forgetDevice` also removes this browser's settings copy and unsent food entries. */
  logout(opts?: { forgetDevice?: boolean }): Promise<{ ok: true }>;
  /** Opens Google's sign-in pop-up and resolves once signed in. It must be called directly from a click handler. */
  login(): Promise<void>;
  setupInfo(): Promise<SetupInfo>;
  saveCredentials(clientId: string): Promise<{ ok: true }>;

  dataTypes(): Promise<DataTypeWithGrant[]>;
  points(type: string, q: RangeQuery): Promise<PointsResponse>;
  rollup(type: string, q: RangeQuery): Promise<RollupResponse>;
  summary(q: { start: string; end: string; fresh?: boolean }): Promise<SummaryResponse>;

  goals(): Promise<Goals>;
  /** False until the user saves goals (the app then shows a "Set your goals" card). */
  goalsSaved(): Promise<boolean>;
  saveGoals(g: Partial<Goals>): Promise<Goals>;
  layout(): Promise<TodayLayout>;
  saveLayout(l: TodayLayout): Promise<TodayLayout>;
  resetLayout(): Promise<TodayLayout>;

  food: {
    day(date: string, fresh?: boolean): Promise<FoodLogDay>;
    /** Every entry with a local date in [start, end), for by-meal charts. */
    entries(start: string, end: string): Promise<FoodLogEntry[]>;
    library(): Promise<LibraryFood[]>;
    item(name: string): Promise<LibraryFood>;
    recents(today: string): Promise<RecentFood[]>;
    create(entry: NewFoodLogEntry): Promise<CreateResult>;
    update(id: string, entry: NewFoodLogEntry): Promise<FoodLogEntry>;
    remove(id: string): Promise<{ ok: true }>;
    favorites(): Promise<FavoriteFood[]>;
    addFavorite(t: FoodTemplate): Promise<FavoriteFood>;
    removeFavorite(id: string): Promise<{ ok: boolean }>;
    pending(): Promise<PendingFoodWrite[]>;
    retryPending(includeFailed?: boolean): Promise<{ sent: number; remaining: number; pending: PendingFoodWrite[] }>;
    discardPending(id: string): Promise<{ ok: boolean }>;
  };
  off: {
    search(q: string): Promise<OffProduct[]>;
    product(code: string): Promise<{ product: OffProduct | null }>;
  };

  nutritionTest(input: { kcal: number; foodDisplayName: string }): Promise<{ operation: unknown }>;
  deletePoints(names: string[]): Promise<{ operation: unknown }>;

  /** Settings sync with Google Drive; `off` before a client ID is set up. */
  settingsSync(): Promise<SettingsSyncInfo>;
  syncSettingsNow(): Promise<SettingsSyncInfo>;
  /** Browser mode: get the Drive token (its own Google pop-up; call it directly from a click), then sync. */
  connectDrive(): Promise<SettingsSyncInfo>;
  /** Be told when the sync state changes (e.g. an automatic sync after a save). Returns an unsubscribe function. */
  watchSettingsSync(listener: (s: SettingsSyncInfo) => void): () => void;
}

/** Fields for the Data explorer's test entry, stamped with the current time and offset. */
export const testEntryFields = () => ({
  mealType: "SNACK",
  startTime: new Date().toISOString(),
  // getTimezoneOffset is minutes *behind* UTC; the API wants seconds ahead.
  utcOffsetSeconds: -new Date().getTimezoneOffset() * 60,
});
