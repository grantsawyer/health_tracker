import { describe, expect, it } from "vitest";
import { canStepForward, displayDates, displayRange, fetchRange, isCurrent, periodTitle, step, weekStart } from "../../src/dashboard/period";
import { budgetStatus, goalStatus, rangeStatus, rollingAverage, typicalRange } from "../../src/dashboard/baseline";

const TODAY = "2026-11-08"; // a Sunday

describe("period ranges", () => {
  it("weeks run Monday to Sunday", () => {
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // a Sunday belongs to the week before
  });
  it("D and W show the anchor's whole week", () => {
    for (const kind of ["D", "W"] as const) expect(displayRange({ kind, anchor: "2026-11-05" })).toEqual({ start: "2026-11-02", end: "2026-11-09" });
    expect(displayDates({ kind: "W", anchor: "2026-11-05" })).toHaveLength(7);
  });
  it("M is the calendar month; 3M is that month and the two before", () => {
    expect(displayRange({ kind: "M", anchor: "2026-11-08" })).toEqual({ start: "2026-11-01", end: "2026-12-01" });
    expect(displayRange({ kind: "3M", anchor: "2026-11-08" })).toEqual({ start: "2026-09-01", end: "2026-12-01" });
    expect(displayRange({ kind: "3M", anchor: "2027-01-15" })).toEqual({ start: "2026-11-01", end: "2027-02-01" });
  });
  it("fetchRange never asks for future days", () => {
    expect(fetchRange({ kind: "M", anchor: TODAY }, TODAY)).toEqual({ start: "2026-11-01", end: "2026-11-09" });
    expect(fetchRange({ kind: "W", anchor: "2026-10-20" }, TODAY)).toEqual({ start: "2026-10-19", end: "2026-10-26" });
  });
});

describe("period stepping and titles", () => {
  it("steps by the period length, clamping month ends", () => {
    expect(step({ kind: "D", anchor: TODAY }, -1).anchor).toBe("2026-11-07");
    expect(step({ kind: "W", anchor: TODAY }, -1).anchor).toBe("2026-11-01");
    expect(step({ kind: "M", anchor: "2026-03-31" }, -1).anchor).toBe("2026-02-28");
    expect(step({ kind: "3M", anchor: TODAY }, -1).anchor).toBe("2026-08-08");
  });
  it("can't step into a period that's entirely in the future", () => {
    expect(canStepForward({ kind: "D", anchor: TODAY }, TODAY)).toBe(false);
    expect(canStepForward({ kind: "D", anchor: "2026-11-07" }, TODAY)).toBe(true);
    expect(canStepForward({ kind: "W", anchor: TODAY }, TODAY)).toBe(false);
    expect(canStepForward({ kind: "M", anchor: "2026-10-15" }, TODAY)).toBe(true);
  });
  it("titles read naturally", () => {
    expect(periodTitle({ kind: "D", anchor: TODAY }, TODAY)).toBe("Today");
    expect(periodTitle({ kind: "D", anchor: "2026-11-07" }, TODAY)).toBe("Yesterday");
    expect(periodTitle({ kind: "W", anchor: TODAY }, TODAY)).toBe("This week");
    expect(periodTitle({ kind: "W", anchor: "2026-10-28" }, TODAY)).toBe("Last week");
    expect(periodTitle({ kind: "W", anchor: "2026-10-14" }, TODAY)).toMatch(/Oct 12 – 18/);
    expect(periodTitle({ kind: "M", anchor: TODAY }, TODAY)).toMatch(/November 2026/);
    expect(periodTitle({ kind: "3M", anchor: TODAY }, TODAY)).toMatch(/Sep – Nov 2026/);
  });
  it("isCurrent", () => {
    expect(isCurrent({ kind: "W", anchor: "2026-11-03" }, TODAY)).toBe(true);
    expect(isCurrent({ kind: "D", anchor: "2026-11-03" }, TODAY)).toBe(false);
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
