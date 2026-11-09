import type { SetupInfo, StatusResponse } from "../shared/types";
import type { DataTypeInfo } from "../shared/dataTypes";
import type { SummaryResponse } from "../shared/summary";
import type { Goals } from "../shared/goals";
import type { TodayLayout } from "../shared/layout";
import type { CreateResult, FavoriteFood, FoodLogDay, FoodLogEntry, FoodTemplate, LibraryFood, NewFoodLogEntry, OffProduct, PendingFoodWrite, RecentFood } from "../shared/food";

export class ApiError extends Error {
  constructor(public status: number, public body: { error?: string; message?: string; google?: unknown } | undefined) {
    super(body?.message ?? `Request failed (${status})`);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = { message: text };
  }
  if (!res.ok) throw new ApiError(res.status, body as ApiError["body"]);
  return body as T;
}

export type DataTypeWithGrant = DataTypeInfo & { granted: boolean };
export type Source = "all" | "self" | "googleSources" | "googleWearables";

export interface CachedMeta {
  cached: boolean;
  fetchedAt: string;
}
export type PointsResponse = CachedMeta & { dataPoints: Array<Record<string, unknown> & { name?: string }>; truncated: boolean };
export type RollupResponse = CachedMeta & { days: Array<Record<string, unknown>> };

interface RangeQuery {
  start: string;
  end: string;
  source?: Source;
  fresh?: boolean;
}

const qs = ({ start, end, source, fresh }: RangeQuery) =>
  new URLSearchParams({ start, end, ...(source ? { source } : {}), ...(fresh ? { fresh: "1" } : {}) }).toString();

export const api = {
  status: () => request<StatusResponse>("/api/status"),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  /** Full-page navigation: the server redirects to Google's consent screen. */
  login: () => window.location.assign("/auth/login"),

  setupInfo: () => request<SetupInfo>("/api/setup"),
  saveCredentials: (clientId: string, clientSecret: string) =>
    request<{ ok: true }>("/api/setup/credentials", { method: "POST", body: JSON.stringify({ clientId, clientSecret }) }),

  dataTypes: () => request<DataTypeWithGrant[]>("/api/data-types"),
  points: (type: string, q: RangeQuery) => request<PointsResponse>(`/api/data/${encodeURIComponent(type)}/points?${qs(q)}`),
  rollup: (type: string, q: RangeQuery) => request<RollupResponse>(`/api/data/${encodeURIComponent(type)}/rollup?${qs(q)}`),

  summary: (q: { start: string; end: string; fresh?: boolean }) => request<SummaryResponse>(`/api/summary?${qs(q)}`),

  goals: () => request<Goals>("/api/goals"),
  saveGoals: (g: Partial<Goals>) => request<Goals>("/api/goals", { method: "POST", body: JSON.stringify(g) }),

  layout: () => request<TodayLayout>("/api/layout"),
  saveLayout: (l: TodayLayout) => request<TodayLayout>("/api/layout", { method: "POST", body: JSON.stringify(l) }),
  resetLayout: () => request<TodayLayout>("/api/layout/reset", { method: "POST" }),

  food: {
    day: (date: string, fresh = false) => request<FoodLogDay>(`/api/food/day?${new URLSearchParams({ date, ...(fresh ? { fresh: "1" } : {}) })}`),
    library: () => request<LibraryFood[]>("/api/food/library"),
    item: (name: string) => request<LibraryFood>(`/api/food/item?${new URLSearchParams({ name })}`),
    recents: (today: string) => request<RecentFood[]>(`/api/food/recents?${new URLSearchParams({ today })}`),
    create: (entry: NewFoodLogEntry) => request<CreateResult>("/api/food/entries", { method: "POST", body: JSON.stringify(entry) }),
    update: (id: string, entry: NewFoodLogEntry) =>
      request<FoodLogEntry>("/api/food/entries/update", { method: "POST", body: JSON.stringify({ id, entry }) }),
    remove: (id: string) => request<{ ok: true }>("/api/food/entries/delete", { method: "POST", body: JSON.stringify({ id }) }),
    favorites: () => request<FavoriteFood[]>("/api/food/favorites"),
    addFavorite: (t: FoodTemplate) => request<FavoriteFood>("/api/food/favorites", { method: "POST", body: JSON.stringify(t) }),
    removeFavorite: (id: string) => request<{ ok: boolean }>("/api/food/favorites/delete", { method: "POST", body: JSON.stringify({ id }) }),
    pending: () => request<PendingFoodWrite[]>("/api/food/pending"),
    retryPending: (includeFailed = false) =>
      request<{ sent: number; remaining: number; pending: PendingFoodWrite[] }>("/api/food/pending/retry", { method: "POST", body: JSON.stringify({ includeFailed }) }),
    discardPending: (id: string) => request<{ ok: boolean }>("/api/food/pending/discard", { method: "POST", body: JSON.stringify({ id }) }),
  },
  off: {
    search: (q: string) => request<OffProduct[]>(`/api/off/search?${new URLSearchParams({ q })}`),
    product: (code: string) => request<{ product: OffProduct | null }>(`/api/off/product?${new URLSearchParams({ code })}`),
  },

  nutritionTest: (input: { kcal: number; foodDisplayName: string }) =>
    request<{ operation: unknown }>("/api/debug/nutrition-test", {
      method: "POST",
      body: JSON.stringify({
        ...input,
        mealType: "SNACK",
        startTime: new Date().toISOString(),
        // getTimezoneOffset is minutes *behind* UTC; the API wants seconds ahead.
        utcOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }),
    }),
  deletePoints: (names: string[]) =>
    request<{ operation: unknown }>("/api/data/delete", { method: "POST", body: JSON.stringify({ names }) }),
};
