import { describe, expect, it } from "vitest";
import { compareStages, efficiencyPct, efficiencySentence, stagePct, usualStatus } from "../../src/dashboard/sleepStages";
import type { Night } from "../../src/dashboard/sleep";

const night = (inBed: number, asleep: number, s: Partial<Night["stages"]>): Night => {
  const stages = { deep: 0, light: 0, rem: 0, awake: 0, asleep: 0, restless: 0, ...s };
  return {
    date: "2026-11-08", asleep, stages,
    main: { id: "x", date: "2026-11-08", startLocal: "2026-11-07T23:00", endLocal: "2026-11-08T05:40", isNap: false, minutesAsleep: asleep, minutesAwake: inBed - asleep, minutesInBed: inBed, stages, segments: [] },
  };
};

// A synthetic night: 400 min in bed, 380 asleep, REM 100, light 200, deep 80, awake 20.
const tonight = night(400, 380, { rem: 100, light: 200, deep: 80, awake: 20 });

describe("sleep stage shares", () => {
  it("are minutes ÷ time in bed", () => {
    expect(stagePct(tonight, "awake")).toBe(5);
    expect(stagePct(tonight, "rem")).toBe(25);
    expect(stagePct(tonight, "light")).toBe(50);
    expect(stagePct(tonight, "deep")).toBe(20);
    expect(efficiencyPct(tonight)).toBe(95);
  });
  it("classic (stage-less) sleep folds asleep into light and restless into awake", () => {
    const classic = night(400, 380, { asleep: 380, restless: 20 });
    expect(stagePct(classic, "light")).toBe(95);
    expect(stagePct(classic, "awake")).toBe(5);
  });
  it("usualStatus wording; higher/lower are neutral, typical is good", () => {
    const r = { lo: 20, hi: 25, mean: 22.5, n: 10 };
    expect(usualStatus(29, r)).toEqual({ tone: "info", text: "Higher than usual" });
    expect(usualStatus(10, r)).toEqual({ tone: "info", text: "Lower than usual" });
    expect(usualStatus(22, r)).toEqual({ tone: "good", text: "Typical" });
    expect(usualStatus(22, undefined).text).toBe("Not enough history");
  });
  it("compareStages: rows in display order with usual ranges and 30-day averages", () => {
    const base = Array.from({ length: 10 }, (_, i) => night(400, 370, { rem: 80 + i, light: 220, deep: 60, awake: 30 - i }));
    const rows = compareStages(tonight, base);
    expect(rows.map((r) => r.label)).toEqual(["Total awake", "REM", "Light", "Deep"]);
    const rem = rows.find((r) => r.key === "rem")!;
    expect(rem.status.text).toBe("Higher than usual"); // 25% vs ~21%
    expect(rem.avgMinutes).toBeCloseTo(84.5);
    expect(rows.find((r) => r.key === "awake")!.status.text).toBe("Lower than usual");
  });
  it("drops stages absent tonight and in history; no history means no comparison", () => {
    const rows = compareStages(night(300, 290, { light: 290, awake: 10 }), []);
    expect(rows.map((r) => r.key)).toEqual(["awake", "light"]);
    expect(rows[0]!.status.text).toBe("Not enough history");
    expect(efficiencySentence(tonight, [])).toBeUndefined();
  });
});
