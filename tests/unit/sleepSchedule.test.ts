import { describe, expect, it } from "vitest";
import { bedtimeOffset, checkSchedule, describeDiff } from "../../src/dashboard/sleep.js";

describe("sleep schedule goals", () => {
  it("places bedtimes from noon on the evening before, earlier ones after midnight", () => {
    expect(bedtimeOffset(22 * 60 + 30)).toBe(-90);
    expect(bedtimeOffset(12 * 60)).toBe(-720);
    expect(bedtimeOffset(30)).toBe(30);
  });

  it("is on schedule when each set goal is within the tolerance", () => {
    const goals = { bedtime: 22 * 60 + 30, wakeTime: 6 * 60 + 30 };
    // Bed 22:50 (-70 → 20 min late), wake 6:10 (20 min early): on schedule.
    expect(checkSchedule({ start: -70, end: 370 }, goals, 30)).toEqual({ bedDiff: 20, wakeDiff: -20, onSchedule: true });
    // Bed 23:45: 75 min late.
    expect(checkSchedule({ start: -15, end: 390 }, goals, 30)).toEqual({ bedDiff: 75, wakeDiff: 0, onSchedule: false });
    // Exactly 30 min counts as on schedule.
    expect(checkSchedule({ start: -60, end: 420 }, goals, 30).onSchedule).toBe(true);
  });

  it("judges only the goals that are set, and nothing without goals or without a night", () => {
    expect(checkSchedule({ start: -15, end: 390 }, { bedtime: null, wakeTime: 390 }, 30)).toEqual({ wakeDiff: 0, onSchedule: true });
    expect(checkSchedule({ start: -15, end: 390 }, { bedtime: null, wakeTime: null }, 30)).toEqual({});
    expect(checkSchedule({}, { bedtime: 1350, wakeTime: 390 }, 30)).toEqual({});
  });

  it("describes the difference in words", () => {
    expect(describeDiff(0, 30)).toBe("on time");
    expect(describeDiff(20, 30)).toBe("on time (20 min late)");
    expect(describeDiff(-45, 30)).toBe("45 min early");
    expect(describeDiff(75, 30)).toBe("1h 15m late");
  });
});
