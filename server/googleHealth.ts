import { getAccessToken, ReauthRequiredError } from "./oauth.js";
import { loadTokens, saveTokens } from "./tokenStore.js";
import type { DataTypeInfo } from "../shared/dataTypes.js";

/**
 * Thin client for the Google Health API (v4). Every Google call goes through
 * `healthFetch` so token refresh and error mapping live in one place.
 * Phase 2 adds dataPoints list / dailyRollUp / create / patch / delete here.
 */
const BASE_URL = "https://health.googleapis.com/v4";

export class AccountNotLinkedError extends Error {
  constructor() {
    super("This Google account isn't linked to Google Health yet. Open the Google Health app on your phone, sign in, then retry.");
  }
}

export class HealthApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

/** Force the next getAccessToken() to refresh (used after an unexpected 401). */
function expireAccessToken(): void {
  const t = loadTokens();
  if (t) saveTokens({ ...t, accessTokenExpiresAt: 0 });
}

export async function healthFetch<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (res.status === 401) {
    if (!retried) {
      expireAccessToken();
      return healthFetch<T>(path, init, true);
    }
    throw new ReauthRequiredError("Google rejected the access token");
  }

  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (!res.ok) {
    // Google errors: { error: { code, message, status, details: [{ reason }] } }
    if (text.includes("ACCOUNT_NOT_LINKED")) throw new AccountNotLinkedError();
    const msg = (body as { error?: { message?: string } } | undefined)?.error?.message ?? text.slice(0, 300);
    throw new HealthApiError(res.status, body, `Google Health API ${res.status}: ${msg}`);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface Identity {
  name: string;
  legacyUserId?: string;
  healthUserId?: string;
}

export const getIdentity = () => healthFetch<Identity>("/users/me/identity");

// ── dataPoints ───────────────────────────────────────────────────────────────
// Value payloads are kept as loose JSON here: the reference is still changing,
// and the dashboards (Phase 3) map the fields they need from recorded fixtures.

export type DataPoint = { name?: string; dataSource?: Record<string, unknown> } & Record<string, unknown>;

export interface DailyRollupPoint {
  civilStartTime: CivilDateTime;
  civilEndTime: CivilDateTime;
  [valueField: string]: unknown;
}

export interface CivilDateTime {
  date: { year: number; month: number; day: number };
  time?: { hours?: number; minutes?: number; seconds?: number; nanos?: number };
}

/** google.longrunning.Operation, returned by create / patch / batchDelete. */
export interface Operation {
  name?: string;
  done?: boolean;
  response?: unknown;
  error?: { code?: number; message?: string };
  metadata?: unknown;
}

export const SOURCE_FAMILIES = {
  all: "users/me/dataSourceFamilies/all-sources",
  googleWearables: "users/me/dataSourceFamilies/google-wearables",
  googleSources: "users/me/dataSourceFamilies/google-sources",
  self: "users/me/dataSourceFamilies/self-sources",
} as const;

export function civilDate(isoDate: string): CivilDateTime {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return { date: { year, month, day } };
}

/** Add days to a YYYY-MM-DD date (calendar arithmetic, no time zones involved). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const collection = (dataTypeId: string) => `/users/me/dataTypes/${encodeURIComponent(dataTypeId)}/dataPoints`;

/** AIP-160 filter for a civil-date range [start, end), shaped per data type kind. */
export function rangeFilter(info: DataTypeInfo, start: string, end: string): string {
  // Verified live 2026-11-07: the filter prefix is the snake_case data type id
  // (nutrition_log, daily_resting_heart_rate), not the camelCase union field.
  const f = info.id.replace(/-/g, "_");
  const path = {
    interval: `${f}.interval.civil_start_time`,
    session: `${f}.interval.civil_start_time`,
    sample: `${f}.sample_time.civil_time`,
    sleep: `sleep.interval.civil_end_time`,
    daily: `${f}.date`,
  }[info.kind];
  return `${path} >= "${start}" AND ${path} < "${end}"`;
}

export interface ListOptions {
  start: string;
  end: string;
  dataSourceFamily?: string;
  /** Stop after this many points across pages (protects against runaway paging on dense types). */
  maxPoints?: number;
}

export async function listDataPoints(info: DataTypeInfo, opts: ListOptions): Promise<{ dataPoints: DataPoint[]; truncated: boolean }> {
  const maxPoints = opts.maxPoints ?? 20_000;
  const out: DataPoint[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      filter: rangeFilter(info, opts.start, opts.end),
      pageSize: String(info.listMaxPageSize ?? 10_000),
    });
    if (opts.dataSourceFamily && !info.noSourceFamily) params.set("dataSourceFamily", opts.dataSourceFamily);
    if (pageToken) params.set("pageToken", pageToken);
    const res = await healthFetch<{ dataPoints?: DataPoint[]; nextPageToken?: string }>(`${collection(info.id)}?${params}`);
    out.push(...(res.dataPoints ?? []));
    pageToken = res.nextPageToken || undefined;
  } while (pageToken && out.length < maxPoints);
  return { dataPoints: out, truncated: Boolean(pageToken) };
}

/**
 * Daily rollups over [start, end). The API caps each request's range (14 or 90
 * days), so long ranges are split into consecutive chunks.
 */
export async function dailyRollUp(info: DataTypeInfo, start: string, end: string, dataSourceFamily?: string): Promise<DailyRollupPoint[]> {
  if (!info.rollup) throw new Error(`${info.id} does not support dailyRollUp`);
  const maxDays = info.rollupMaxDays ?? 90;
  const out: DailyRollupPoint[] = [];
  for (let chunkStart = start; chunkStart < end; chunkStart = addDays(chunkStart, maxDays)) {
    const chunkEndCandidate = addDays(chunkStart, maxDays);
    const chunkEnd = chunkEndCandidate < end ? chunkEndCandidate : end;
    let pageToken: string | undefined;
    do {
      const body: Record<string, unknown> = {
        range: { start: civilDate(chunkStart), end: civilDate(chunkEnd) },
        windowSizeDays: 1,
        pageSize: maxDays,
      };
      if (dataSourceFamily) body.dataSourceFamily = dataSourceFamily;
      if (pageToken) body.pageToken = pageToken;
      const res = await healthFetch<{ rollupDataPoints?: DailyRollupPoint[]; nextPageToken?: string }>(
        `${collection(info.id)}:dailyRollUp`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      out.push(...(res.rollupDataPoints ?? []));
      pageToken = res.nextPageToken || undefined;
    } while (pageToken);
  }
  return out;
}

export async function createDataPoint(dataTypeId: string, dataPoint: DataPoint): Promise<Operation> {
  return healthFetch<Operation>(collection(dataTypeId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dataPoint),
  });
}

/** `name` is the full resource name: users/me/dataTypes/{type}/dataPoints/{id}. */
export async function patchDataPoint(name: string, dataPoint: DataPoint): Promise<Operation> {
  assertDataPointName(name);
  return healthFetch<Operation>(`/${name}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...dataPoint, name }),
  });
}

/**
 * Delete data points by resource name. The API rejects mixing data types in one
 * request ("Multiple data types are not supported at the moment", verified live),
 * so names are grouped by type and sent per collection.
 */
export async function batchDeleteDataPoints(names: string[]): Promise<Operation[]> {
  names.forEach(assertDataPointName);
  const byType = new Map<string, string[]>();
  for (const n of names) {
    const type = n.split("/")[3]!;
    byType.set(type, [...(byType.get(type) ?? []), n]);
  }
  const ops: Operation[] = [];
  for (const [type, group] of byType) {
    ops.push(
      await healthFetch<Operation>(`${collection(type)}:batchDelete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: group }),
      }),
    );
  }
  return ops;
}

const DATA_POINT_NAME = /^users\/me\/dataTypes\/[a-z0-9-]+\/dataPoints\/[^/?#]+$/;
export const isDataPointName = (name: string) => DATA_POINT_NAME.test(name);
function assertDataPointName(name: string): void {
  if (!isDataPointName(name)) throw new Error(`Invalid data point name: ${name}`);
}
