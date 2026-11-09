import { getPoints, getRollup } from "../core/dataService";
import { AccountNotLinkedError, BadRequestError, FoodInputError, HealthApiError, NotEditableError, OffError, ReauthRequiredError } from "../core/errors";
import { deletePoints, writeTestEntry } from "../core/explorer";
import { getFavorites, removeFavorite, saveFavorite } from "../core/favorites";
import {
  createEntry, deleteEntry, discardPendingWrite, getDay, getEntries, getFood, getMyFoods, getRecents, listPendingWrites, parseEntry, retryAllPending, updateEntry,
} from "../core/food";
import { getGoals, updateGoals } from "../core/goals";
import { getIdentity } from "../core/healthClient";
import { getLayout, resetLayout, saveLayout } from "../core/layout";
import { productByBarcode, searchFoods } from "../core/openFoodFacts";
import { buildSummary } from "../core/summary";
import { requireDataType, requireDate, sourceFamily, validateRange } from "../core/validate";
import { DRIVE_SCOPES, browserScopes } from "../platform/browserPlatform";
import type { SyncStatus } from "../platform/settings";
import { DATA_TYPES } from "../shared/dataTypes";
import { CLIENT_ID_PATTERN, HEALTH_SCOPES, fullScope } from "../shared/scopes";
import type { SettingsSyncInfo, StatusResponse } from "../shared/types";
import { ApiError, testEntryFields, type Api } from "./apiTypes";
import { currentRuntime, resetRuntime, runtime, saveClientId, type Runtime } from "./browser/runtime";

/**
 * Browser mode (default): the UI's calls run core/ directly in the page, on the
 * browser platform (GIS sign-in, IndexedDB, Drive settings). No server.
 * Errors are mapped to the same ApiError status codes and `error` keys the
 * local server used (server/dataRoutes.ts), so the UI handles both alike.
 */

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const e = err as Error;
  if (err instanceof BadRequestError || err instanceof FoodInputError) return new ApiError(400, { error: "bad_request", message: e.message });
  if (err instanceof NotEditableError) return new ApiError(403, { error: "not_editable", message: e.message });
  if (err instanceof OffError) return new ApiError(err.status, { error: "food_database", message: e.message });
  if (err instanceof ReauthRequiredError) return new ApiError(401, { error: "reauth_required", message: e.message });
  if (err instanceof AccountNotLinkedError) return new ApiError(409, { error: "account_not_linked", message: e.message });
  if (err instanceof HealthApiError) return new ApiError(502, { error: "google_api_error", message: e.message, google: err.body });
  return new ApiError(500, { error: "internal", message: e?.message ?? String(err) });
}

/** A signed-in runtime, or ReauthRequiredError. */
async function signedIn(): Promise<Runtime & { auth: NonNullable<Runtime["auth"]>; bp: NonNullable<Runtime["bp"]> }> {
  const rt = await runtime();
  if (!rt.auth || !rt.bp) throw new ApiError(400, { error: "not_configured", message: "Add your Google client ID on the Account page first." });
  return rt as Runtime & { auth: NonNullable<Runtime["auth"]>; bp: NonNullable<Runtime["bp"]> };
}

/** Run core code with the platform ready, mapping its errors. */
async function call<T>(fn: (rt: Awaited<ReturnType<typeof signedIn>>) => Promise<T>): Promise<T> {
  try {
    return await fn(await signedIn());
  } catch (err) {
    throw toApiError(err);
  }
}

const grantedScopes = (rt: Runtime) => new Set(rt.auth?.session()?.scopes ?? []);

export function syncInfo(s: SyncStatus): SettingsSyncInfo {
  return s.state === "synced" ? { state: "synced", at: new Date(s.at).toISOString() } : { state: s.state, reason: s.reason };
}

async function status(): Promise<StatusResponse> {
  const rt = await runtime();
  if (!rt.clientId || !rt.auth) return { state: "not_configured", message: "Add your Google client ID to get started." };
  const session = rt.auth.session();
  if (!session) {
    const email = rt.auth.email();
    return email
      ? { state: "reauth_required", email, message: "Your Google sign-in for this session has ended." }
      : { state: "signed_out", ...(rt.gisError ? { message: rt.gisError.message } : {}) };
  }
  const granted = new Set(session.scopes);
  const base: StatusResponse = {
    state: "connected",
    email: session.email,
    scopes: HEALTH_SCOPES.map((s) => ({ ...s, granted: granted.has(fullScope(s.key)) })),
  };
  try {
    await rt.ensureSynced();
    const identity = await getIdentity();
    return { ...base, healthUserId: identity.healthUserId };
  } catch (err) {
    if (err instanceof ReauthRequiredError) return { state: "reauth_required", email: session.email, message: err.message };
    if (err instanceof AccountNotLinkedError) return { ...base, state: "account_not_linked", message: err.message };
    return { ...base, state: "error", message: (err as Error).message };
  }
}

export const browserApi: Api = {
  status,

  async logout() {
    const rt = await runtime();
    await rt.bp?.signOut();
    return { ok: true };
  },

  login() {
    // No awaits before signIn(): Google's pop-up needs this click's user activation.
    const rt = currentRuntime();
    if (!rt?.auth || !rt.bp) return Promise.reject(new ApiError(400, { error: "not_configured", message: "Google sign-in isn't ready yet. Try again in a moment." }));
    if (rt.gisError) return Promise.reject(new ApiError(503, { error: "gis_unavailable", message: rt.gisError.message }));
    const { auth } = rt;
    return auth.signIn().then(
      () => rt.ensureSynced(),
      (err: unknown) => {
        throw toApiError(err);
      },
    );
  },

  async setupInfo() {
    const rt = await runtime();
    return {
      mode: "browser",
      configured: Boolean(rt.clientId),
      clientIdHint: rt.clientId ? `…${rt.clientId.slice(-34)}` : undefined,
      clientId: rt.clientId ?? undefined,
      javascriptOrigin: window.location.origin,
      scopes: [...browserScopes(), ...DRIVE_SCOPES].filter((s) => s.startsWith("https://")),
      clientIdFromBuild: rt.clientIdFromBuild,
    };
  },

  async saveCredentials(clientId) {
    const id = clientId.trim();
    if (!CLIENT_ID_PATTERN.test(id)) {
      throw new ApiError(400, { error: "bad_request", message: "That doesn't look like a Client ID. It should end in .apps.googleusercontent.com" });
    }
    const rt = await runtime();
    if (id !== rt.clientId) {
      await rt.bp?.signOut(); // a token from another OAuth client is useless here
      saveClientId(id);
      resetRuntime();
      await runtime();
    }
    return { ok: true };
  },

  dataTypes: () => call(async (rt) => {
    const granted = grantedScopes(rt);
    return DATA_TYPES.map((t) => ({ ...t, granted: granted.has(fullScope(t.scope)) }));
  }),
  points: (type, q) => call(async () => {
    const r = await getPoints(requireDataType(type), { ...validateRange(q.start, q.end), source: sourceFamily(q.source), fresh: q.fresh });
    return { ...r.value, cached: r.cached, fetchedAt: r.fetchedAt };
  }),
  rollup: (type, q) => call(async () => {
    const info = requireDataType(type);
    if (!info.rollup) throw new BadRequestError(`${info.id} does not support daily rollups`);
    const r = await getRollup(info, { ...validateRange(q.start, q.end), source: sourceFamily(q.source), fresh: q.fresh });
    return { ...r.value, cached: r.cached, fetchedAt: r.fetchedAt };
  }),
  summary: (q) => call(async (rt) => {
    const { start, end } = validateRange(q.start, q.end);
    return buildSummary(start, end, Boolean(q.fresh), grantedScopes(rt));
  }),

  goals: () => call(() => getGoals()),
  saveGoals: (g) => call(() => updateGoals(g)),
  layout: () => call(() => getLayout()),
  saveLayout: (l) => call(() => saveLayout(l)),
  resetLayout: () => call(() => resetLayout()),

  food: {
    day: (date, fresh = false) => call(() => getDay(requireDate(date, "date"), fresh)),
    entries: (start, end) => call(() => {
      const r = validateRange(start, end);
      return getEntries(r.start, r.end);
    }),
    library: () => call(() => getMyFoods()),
    item: (name) => call(() => getFood(name)),
    recents: (today) => call(() => getRecents(requireDate(today, "today"))),
    create: (entry) => call(() => createEntry(parseEntry(entry))),
    update: (id, entry) => call(() => updateEntry(id, parseEntry(entry))),
    remove: (id) => call(async () => {
      await deleteEntry(id);
      return { ok: true as const };
    }),
    favorites: () => call(() => getFavorites()),
    addFavorite: (t) => call(() => saveFavorite(t)),
    removeFavorite: (id) => call(async () => ({ ok: await removeFavorite(id) })),
    pending: () => call(() => listPendingWrites()),
    retryPending: (includeFailed = false) => call(async () => ({ ...(await retryAllPending(includeFailed)), pending: await listPendingWrites() })),
    discardPending: (id) => call(async () => ({ ok: await discardPendingWrite(id) })),
  },
  off: {
    search: (q) => call(() => searchFoods(q)),
    product: (code) => call(async () => ({ product: await productByBarcode(code.trim()) })),
  },

  nutritionTest: (input) => call(() => writeTestEntry({ ...input, ...testEntryFields() })),
  deletePoints: (names) => call(() => deletePoints(names)),

  async settingsSync() {
    const rt = await runtime();
    return rt.bp ? syncInfo(rt.bp.settings.status()) : { state: "off" };
  },
  async syncSettingsNow() {
    const rt = await runtime();
    return rt.bp ? syncInfo(await rt.bp.settings.sync()) : { state: "off" };
  },
  connectDrive() {
    // No awaits before GIS: the Drive pop-up needs this click's user activation.
    const rt = currentRuntime();
    if (!rt?.bp) return Promise.resolve<SettingsSyncInfo>({ state: "off" });
    return rt.bp.connectDrive().then(syncInfo);
  },
  watchSettingsSync(listener) {
    let stop = () => {};
    let stopped = false;
    void runtime().then((rt) => {
      if (!stopped && rt.bp) stop = rt.bp.settings.onChange((s) => listener(syncInfo(s)));
    });
    return () => {
      stopped = true;
      stop();
    };
  },
};
