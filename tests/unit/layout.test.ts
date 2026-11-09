import { describe, expect, it } from "vitest";
import { getLayout, resetLayout, saveLayout } from "../../core/layout.js";
import { putSetting } from "../../server/appStore.js";
import { FoodInputError } from "../../core/errors.js";
import { DEFAULT_LAYOUT, LAYOUT_LIMITS, METRIC_IDS, SECTION_SUPPORT, layoutError } from "../../shared/layout.js";
import { METRICS, metricsFor } from "../../src/dashboard/cards";
import { signIn } from "../helpers/fixtures.js";

describe("layoutError", () => {
  it("accepts the default layout", () => expect(layoutError(DEFAULT_LAYOUT)).toBeNull());
  it.each([
    [null, /JSON object/],
    [{ today: ["steps"] }, /week must be a list/],
    [{ today: ["steps"], week: [], extra: [] }, /Unknown section/],
    [{ today: ["nope"], week: [] }, /Unknown card/],
    [{ today: ["steps", "steps"], week: [] }, /appears twice/],
    [{ today: [], week: ["sleepSchedule"] }, /can't be shown in week/],
    [{ today: METRIC_IDS.filter((id) => id !== "stepsRing").slice(0, 13), week: [] }, /room for 12 slots/],
    [{ today: ["stepsRing", ...METRIC_IDS.slice(1, 11)], week: [] }, /room for 12 slots/], // ring (3) + 10 = 13
    [{ today: [], week: ["stepsRing"] }, /can't be shown in week/],
  ])("rejects %j", (body, msg) => expect(layoutError(body)).toMatch(msg));
});

describe("layout storage", () => {
  it("defaults, saves, resets, and is per user", async () => {
    signIn(undefined, "layout-a@example.com");
    expect(await getLayout()).toEqual(DEFAULT_LAYOUT);
    const saved = await saveLayout({ today: ["distance", "steps"], week: ["weight"] });
    expect(saved).toEqual({ today: ["distance", "steps"], week: ["weight"] });
    signIn(undefined, "layout-b@example.com");
    expect(await getLayout()).toEqual(DEFAULT_LAYOUT);
    signIn(undefined, "layout-a@example.com");
    expect((await getLayout()).today).toEqual(["distance", "steps"]);
    expect(await resetLayout()).toEqual(DEFAULT_LAYOUT);
  });
  it("rejects invalid layouts with a readable error", async () => {
    signIn(undefined, "layout-a@example.com");
    await expect(saveLayout({ today: ["bogus"], week: [] })).rejects.toThrowError(FoodInputError);
  });
  it("counts the steps ring as three slots", async () => {
    signIn(undefined, "layout-a@example.com");
    const nine = METRIC_IDS.filter((id) => id !== "stepsRing" && id !== "sleepSchedule").slice(0, 9);
    expect((await saveLayout({ today: ["stepsRing", ...nine], week: [] })).today).toHaveLength(10); // 3 + 9 = 12 slots
  });
  it("adds the ring to layouts saved before it became a card (v1)", async () => {
    signIn(undefined, "layout-d@example.com");
    putSetting("layout-d@example.com", "todayLayout", { today: ["heartRate", "sleep"], week: ["steps"] });
    expect((await getLayout()).today).toEqual(["stepsRing", "heartRate", "sleep"]);
    // ...but not once the owner has removed it from a v2 layout
    await saveLayout({ today: ["heartRate"], week: [] });
    expect((await getLayout()).today).toEqual(["heartRate"]);
  });

  it("cleans up a stored layout that no longer validates instead of failing", async () => {
    signIn(undefined, "layout-c@example.com");
    putSetting("layout-c@example.com", "todayLayout", { v: 2, today: ["steps", "retiredCard", "steps"], week: ["sleepSchedule", "weight"] });
    expect(await getLayout()).toEqual({ today: ["steps"], week: ["weight"] });
  });
});

describe("card registry", () => {
  it("has exactly one definition per metric id", async () => {
    expect(METRICS.map((m) => m.id).sort()).toEqual([...METRIC_IDS].sort());
  });
  it("matches what the server allows in each section", async () => {
    for (const section of ["today", "week"] as const) {
      expect(new Set(metricsFor(section).map((m) => m.id))).toEqual(SECTION_SUPPORT[section]);
    }
  });
  it("default layout fits the limits", async () => {
    expect(layoutError(DEFAULT_LAYOUT)).toBeNull();
    expect(DEFAULT_LAYOUT.today[0]).toBe("stepsRing");
    expect(DEFAULT_LAYOUT.week.length).toBeLessThanOrEqual(LAYOUT_LIMITS.week);
  });
});
