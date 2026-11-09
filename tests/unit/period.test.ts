import { describe, expect, it } from "vitest";
import { WINDOW_DAYS, canStepForward, displayDates, displayRange, fetchRange, isCurrent, periodTitle, step } from "../../src/dashboard/period";
import { budgetStatus, goalStatus, rangeStatus, rollingAverage, typicalRange } from "../../src/dashboard/baseline";

const TODAY = "2026-11-08";

describe("period ranges: rolling windows ending on the anchor", () => {
  it("D and W show the 7 days ending on the anchor; M 30; 3M 90; the anchor is always last", () => {
    expect(displayRange({ kind: "W", anchor: "2026-11-05" })).toEqual({ start: "2026-10-30", end: "2026-11-06" });
    expect(displayRange({ kind: "D", anchor: "2026-11-05" })).toEqual({ start: "2026-10-30", end: "2026-11-06" });
    expect(displayRange({ kind: "M", anchor: TODAY })).toEqual({ start: "2026-10-10", end: "2026-11-09" });
    expect(displayRange({ kind: "3M", anchor: TODAY })).toEqual({ start: "2026-08-11", end: "2026-11-09" });
    for (const kind of ["D", "W", "M", "3M"] as const) {
      const dates = displayDates({ kind, anchor: TODAY });
      expect(dates).toHaveLength(WINDOW_DAYS[kind]);
      expect(dates.at(-1)).toBe(TODAY);
    }
  });
  it("crosses month and year boundaries without snapping to calendar starts", () => {
    expect(displayRange({ kind: "W", anchor: "2027-01-02" })).toEqual({ start: "2026-12-27", end: "2027-01-03" });
  });
  it("fetchRange never asks for future days", () => {
    expect(fetchRange({ kind: "M", anchor: TODAY }, TODAY)).toEqual({ start: "2026-10-10", end: "2026-11-09" });
    expect(fetchRange({ kind: "W", anchor: "2026-10-20" }, TODAY)).toEqual({ start: "2026-10-14", end: "2026-10-21" });
  });
});

describe("period stepping and titles", () => {
  it("steps by the window length (a day for D), never past today", () => {
    expect(step({ kind: "D", anchor: TODAY }, -1, TODAY).anchor).toBe("2026-11-07");
    expect(step({ kind: "W", anchor: TODAY }, -1, TODAY).anchor).toBe("2026-11-01");
    expect(step({ kind: "M", anchor: TODAY }, -1, TODAY).anchor).toBe("2026-10-09");
    expect(step({ kind: "3M", anchor: TODAY }, -1, TODAY).anchor).toBe("2026-08-10");
    expect(step({ kind: "W", anchor: "2026-11-05" }, 1, TODAY).anchor).toBe(TODAY); // clamped
  });
  it("can step forward only while the window ends before today", () => {
    expect(canStepForward({ kind: "D", anchor: TODAY }, TODAY)).toBe(false);
    expect(canStepForward({ kind: "D", anchor: "2026-11-07" }, TODAY)).toBe(true);
    expect(canStepForward({ kind: "W", anchor: TODAY }, TODAY)).toBe(false);
    expect(canStepForward({ kind: "M", anchor: "2026-11-01" }, TODAY)).toBe(true);
  });
  it("titles read naturally", () => {
    expect(periodTitle({ kind: "D", anchor: TODAY }, TODAY)).toBe("Today");
    expect(periodTitle({ kind: "D", anchor: "2026-11-07" }, TODAY)).toBe("Yesterday");
    expect(periodTitle({ kind: "W", anchor: TODAY }, TODAY)).toBe("Last 7 days");
    expect(periodTitle({ kind: "M", anchor: TODAY }, TODAY)).toBe("Last 30 days");
    expect(periodTitle({ kind: "3M", anchor: TODAY }, TODAY)).toBe("Last 90 days");
    expect(periodTitle({ kind: "W", anchor: "2026-10-18" }, TODAY)).toMatch(/Oct 12 – 18/);
    expect(periodTitle({ kind: "M", anchor: "2026-11-01" }, TODAY)).toMatch(/Oct 3 – Nov 1/);
    expect(periodTitle({ kind: "W", anchor: "2026-01-03" }, TODAY)).toMatch(/Dec 28, 2025 – Jan 3, 2026/);
  });
  it("isCurrent means the window ends today", () => {
    expect(isCurrent({ kind: "W", anchor: TODAY }, TODAY)).toBe(true);
    expect(isCurrent({ kind: "W", anchor: "2026-11-03" }, TODAY)).toBe(false);
  });
});

describe("baselines and statuses", () => {
  it("typicalRange is mean ± 1 SD and needs 7 values", () => {
    expect(typicalRange([1, 2, 3])).toBeUndefined();
    const r = typicalRange([60, 62, 64, 66, 68, 70, 72, undefined])!;
    expect(r.mean).toBe(66);
    expect(r.lo).toBeCloseTo(62, 0);
    expect(r.hi).toBeCloseTo(70, 0);
    expect(r.n).toBe(7);
  });
  it("rangeStatus", () => {
    const r = { lo: 62, hi: 70, mean: 66, n: 10 };
    expect(rangeStatus(66, r)).toEqual({ tone: "good", text: "In your range" });
    expect(rangeStatus(75, r).text).toBe("Above your range");
    expect(rangeStatus(55, r).text).toBe("Below your range");
    expect(rangeStatus(undefined, r).text).toBe("No data");
    expect(rangeStatus(66, undefined).text).toBe("Not enough history");
  });
  it("goalStatus and budgetStatus", () => {
    expect(goalStatus(1000, 10000)).toEqual({ tone: "info", text: "9,000 left" });
    expect(goalStatus(12000, 10000)).toEqual({ tone: "good", text: "Goal met" });
    expect(goalStatus(5, null).text).toBe("No goal set");
    expect(budgetStatus(500, 2000, " kcal")).toEqual({ tone: "good", text: "1,500 kcal remaining" });
    expect(budgetStatus(2300, 2000, " kcal")).toEqual({ tone: "warn", text: "300 kcal over" });
  });
  it("rollingAverage skips gaps and needs 3 readings", () => {
    const r = rollingAverage([160, undefined, 162, 164, undefined, 166], 7);
    expect(r[0]).toBeUndefined();
    expect(r[3]).toBeCloseTo(162);
    expect(r[4]).toBeUndefined(); // no reading that day
    expect(r[5]).toBeCloseTo(163);
  });
});
