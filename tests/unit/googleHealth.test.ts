import { beforeEach, describe, expect, it } from "vitest";
import {
  AccountNotLinkedError, HealthApiError, addDays, batchDeleteDataPoints, civilDate, dailyRollUp, healthFetch,
  isDataPointName, listDataPoints, rangeFilter,
} from "../../core/healthClient.js";
import { ReauthRequiredError } from "../../core/errors.js";
import { dataTypeById } from "../../shared/dataTypes.js";
import { done, fakeFetch, json } from "../helpers/fakeGoogle.js";
import { signIn } from "../helpers/fixtures.js";
import { testPlatform } from "../helpers/testPlatform.js";

const t = (id: string) => dataTypeById(id)!;

describe("rangeFilter", () => {
  // Live API (2026-11-07) rejects camelCase prefixes; the snake_case data type id is required.
  it.each([
    ["steps", 'steps.interval.civil_start_time >= "2026-11-01" AND steps.interval.civil_start_time < "2026-11-08"'],
    ["active-zone-minutes", 'active_zone_minutes.interval.civil_start_time >= "2026-11-01" AND active_zone_minutes.interval.civil_start_time < "2026-11-08"'],
    ["weight", 'weight.sample_time.civil_time >= "2026-11-01" AND weight.sample_time.civil_time < "2026-11-08"'],
    ["nutrition-log", 'nutrition_log.interval.civil_start_time >= "2026-11-01" AND nutrition_log.interval.civil_start_time < "2026-11-08"'],
    ["daily-resting-heart-rate", 'daily_resting_heart_rate.date >= "2026-11-01" AND daily_resting_heart_rate.date < "2026-11-08"'],
    ["sleep", 'sleep.interval.civil_end_time >= "2026-11-01" AND sleep.interval.civil_end_time < "2026-11-08"'],
  ])("%s", (id, expected) => {
    expect(rangeFilter(t(id), "2026-11-01", "2026-11-08")).toBe(expected);
  });
});

describe("date helpers", () => {
  it("addDays crosses month, year and DST boundaries by calendar day", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31"); // US DST ended 2026-11-01
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
  it("civilDate builds a CivilDateTime", () => {
    expect(civilDate("2026-03-09")).toEqual({ date: { year: 2026, month: 3, day: 9 } });
  });
  it("isDataPointName only accepts users/me resource names without traversal", () => {
    expect(isDataPointName("users/me/dataTypes/nutrition-log/dataPoints/123")).toBe(true);
    expect(isDataPointName("users/me/dataTypes/nutrition-log/dataPoints/../../x")).toBe(false);
    expect(isDataPointName("users/123/dataTypes/steps/dataPoints/1")).toBe(false);
    expect(isDataPointName("users/me/dataTypes/steps/dataPoints/1?x=1")).toBe(false);
  });
});

describe("with a signed-in session", () => {
  beforeEach(() => signIn());

  it("listDataPoints follows nextPageToken and caps sleep pages at 25", async () => {
    const g = fakeFetch()
      .on("GET", /\/sleep\/dataPoints$/, () => json({ dataPoints: [{ a: 1 }], nextPageToken: "p2" }), 1)
      .on("GET", /\/sleep\/dataPoints$/, () => json({ dataPoints: [{ a: 2 }] }));
    const r = await listDataPoints(t("sleep"), { start: "2026-11-01", end: "2026-11-08", dataSourceFamily: "users/me/dataSourceFamilies/self-sources" });
    expect(r).toEqual({ dataPoints: [{ a: 1 }, { a: 2 }], truncated: false });
    expect(g.calls).toHaveLength(2);
    expect(g.calls[0]!.url.searchParams.get("pageSize")).toBe("25");
    // sleep rejects dataSourceFamily (INVALID_ARGUMENT), so it must not be sent
    expect(g.calls[0]!.url.searchParams.has("dataSourceFamily")).toBe(false);
    expect(g.calls[1]!.url.searchParams.get("pageToken")).toBe("p2");
    expect(g.calls[0]!.headers.authorization).toBe("Bearer test-access-token");
  });

  it("listDataPoints sends dataSourceFamily for types that support it", async () => {
    const g = fakeFetch().on("GET", /\/nutrition-log\/dataPoints$/, () => json({ dataPoints: [] }));
    await listDataPoints(t("nutrition-log"), { start: "2026-11-01", end: "2026-11-02", dataSourceFamily: "users/me/dataSourceFamilies/self-sources" });
    expect(g.calls[0]!.url.searchParams.get("dataSourceFamily")).toBe("users/me/dataSourceFamilies/self-sources");
  });

  it("dailyRollUp splits ranges into the type's max window (14 days for heart-rate)", async () => {
    const g = fakeFetch().on("POST", /\/heart-rate\/dataPoints:dailyRollUp$/, () => json({ rollupDataPoints: [{ x: 1 }] }));
    const days = await dailyRollUp(t("heart-rate"), "2026-10-01", "2026-11-08");
    expect(days).toHaveLength(3);
    const ranges = g.calls.map((c) => [c.body.range.start.date, c.body.range.end.date]);
    expect(ranges).toEqual([
      [{ year: 2026, month: 10, day: 1 }, { year: 2026, month: 10, day: 15 }],
      [{ year: 2026, month: 10, day: 15 }, { year: 2026, month: 10, day: 29 }],
      [{ year: 2026, month: 10, day: 29 }, { year: 2026, month: 11, day: 8 }],
    ]);
    expect(g.calls.every((c) => c.body.windowSizeDays === 1 && c.body.pageSize === 14)).toBe(true);
  });

  it("dailyRollUp refuses types without rollup support", async () => {
    await expect(dailyRollUp(t("daily-resting-heart-rate"), "2026-11-01", "2026-11-08")).rejects.toThrow(/does not support dailyRollUp/);
  });

  it("batchDeleteDataPoints sends one request per data type (mixed types are rejected by the API)", async () => {
    const g = fakeFetch().on("POST", /:batchDelete$/, () => done({}));
    await batchDeleteDataPoints([
      "users/me/dataTypes/nutrition-log/dataPoints/1",
      "users/me/dataTypes/hydration-log/dataPoints/2",
      "users/me/dataTypes/nutrition-log/dataPoints/3",
    ]);
    expect(g.calls.map((c) => [c.url.pathname, c.body.names])).toEqual([
      ["/v4/users/me/dataTypes/nutrition-log/dataPoints:batchDelete", ["users/me/dataTypes/nutrition-log/dataPoints/1", "users/me/dataTypes/nutrition-log/dataPoints/3"]],
      ["/v4/users/me/dataTypes/hydration-log/dataPoints:batchDelete", ["users/me/dataTypes/hydration-log/dataPoints/2"]],
    ]);
  });

  it("batchDeleteDataPoints rejects malformed names before calling Google", async () => {
    const g = fakeFetch();
    await expect(batchDeleteDataPoints(["users/me/dataTypes/x/dataPoints/../../evil"])).rejects.toThrow(/Invalid data point name/);
    expect(g.calls).toHaveLength(0);
  });

  it("maps ACCOUNT_NOT_LINKED to AccountNotLinkedError", async () => {
    fakeFetch().on("GET", /\/identity$/, () => json({ error: { code: 400, details: [{ reason: "ACCOUNT_NOT_LINKED" }] } }, 400));
    await expect(healthFetch("/users/me/identity")).rejects.toBeInstanceOf(AccountNotLinkedError);
  });

  it("wraps other API errors with status and Google's message", async () => {
    fakeFetch().on("GET", /\/identity$/, () => json({ error: { code: 503, message: "backend unavailable" } }, 503));
    const err = (await healthFetch("/users/me/identity").catch((e) => e)) as HealthApiError;
    expect(err).toBeInstanceOf(HealthApiError);
    expect(err.status).toBe(503);
    expect(err.message).toContain("backend unavailable");
  });

  it("on 401 asks the platform for a fresh token once and retries; a second 401 means sign in again", async () => {
    const g = fakeFetch()
      .on("GET", /\/identity$/, () => new Response("", { status: 401 }), 1)
      .on("GET", /\/identity$/, () => json({ healthUserId: "42" }), 1)
      .on("GET", /\/identity$/, () => new Response("", { status: 401 }));
    const before = testPlatform.invalidations;
    expect((await healthFetch<{ healthUserId: string }>("/users/me/identity")).healthUserId).toBe("42");
    expect(testPlatform.invalidations).toBe(before + 1);
    await expect(healthFetch("/users/me/identity")).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(g.calls).toHaveLength(4);
  });
});

describe("without a session", () => {
  it("throws ReauthRequiredError instead of calling Google", async () => {
    testPlatform.signOut();
    const g = fakeFetch();
    await expect(healthFetch("/users/me/identity")).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(g.calls).toHaveLength(0);
  });
});
