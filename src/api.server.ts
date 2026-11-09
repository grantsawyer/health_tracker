import { ApiError, testEntryFields, type Api, type RangeQuery } from "./apiTypes";

/**
 * Server mode (`VITE_BACKEND=server`): every call goes to the local Node
 * server's /api routes. Kept as a fallback until migration phase 6.
 */

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

const qs = ({ start, end, source, fresh }: RangeQuery) =>
  new URLSearchParams({ start, end, ...(source ? { source } : {}), ...(fresh ? { fresh: "1" } : {}) }).toString();
const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const serverApi: Api = {
  status: () => request("/api/status"),
  logout: () => request("/auth/logout", post()),
  /** Full-page navigation: the server redirects to Google's consent screen. */
  login: () => {
    window.location.assign("/auth/login");
    return new Promise<void>(() => {});
  },

  setupInfo: () => request("/api/setup"),
  saveCredentials: (clientId, clientSecret = "") => request("/api/setup/credentials", post({ clientId, clientSecret })),

  dataTypes: () => request("/api/data-types"),
  points: (type, q) => request(`/api/data/${encodeURIComponent(type)}/points?${qs(q)}`),
  rollup: (type, q) => request(`/api/data/${encodeURIComponent(type)}/rollup?${qs(q)}`),
  summary: (q) => request(`/api/summary?${qs(q)}`),

  goals: () => request("/api/goals"),
  saveGoals: (g) => request("/api/goals", post(g)),
  layout: () => request("/api/layout"),
  saveLayout: (l) => request("/api/layout", post(l)),
  resetLayout: () => request("/api/layout/reset", post()),

  food: {
    day: (date, fresh = false) => request(`/api/food/day?${new URLSearchParams({ date, ...(fresh ? { fresh: "1" } : {}) })}`),
    entries: (start, end) => request(`/api/food/entries?${new URLSearchParams({ start, end })}`),
    library: () => request("/api/food/library"),
    item: (name) => request(`/api/food/item?${new URLSearchParams({ name })}`),
    recents: (today) => request(`/api/food/recents?${new URLSearchParams({ today })}`),
    create: (entry) => request("/api/food/entries", post(entry)),
    update: (id, entry) => request("/api/food/entries/update", post({ id, entry })),
    remove: (id) => request("/api/food/entries/delete", post({ id })),
    favorites: () => request("/api/food/favorites"),
    addFavorite: (t) => request("/api/food/favorites", post(t)),
    removeFavorite: (id) => request("/api/food/favorites/delete", post({ id })),
    pending: () => request("/api/food/pending"),
    retryPending: (includeFailed = false) => request("/api/food/pending/retry", post({ includeFailed })),
    discardPending: (id) => request("/api/food/pending/discard", post({ id })),
  },
  off: {
    search: (q) => request(`/api/off/search?${new URLSearchParams({ q })}`),
    product: (code) => request(`/api/off/product?${new URLSearchParams({ code })}`),
  },

  nutritionTest: (input) => request("/api/debug/nutrition-test", post({ ...input, ...testEntryFields() })),
  deletePoints: (names) => request("/api/data/delete", post({ names })),

  settingsSync: async () => ({ state: "off" }),
  syncSettingsNow: async () => ({ state: "off" }),
  connectDrive: async () => ({ state: "off" }),
  watchSettingsSync: () => () => {},
};
