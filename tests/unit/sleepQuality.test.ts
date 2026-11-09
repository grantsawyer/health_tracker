import { describe, expect, it } from "vitest";
import { qualityRows, sleepQuality } from "../../src/dashboard/sleepQuality.js";
import type { SleepSession } from "../../shared/summary.js";

type Seg = SleepSession["segments"][number];
/** A synthetic night from a list of [stage, minutes] spans, back to back from minute 0. */
function night(spans: [Seg["stage"], number][], date = "2026-11-07"): SleepSession {
  let t = 0;
  const segments: Seg[] = spans.map(([stage, m]) => ({ stage, from: t, to: (t += m) }));
  const stages = { deep: 0, light: 0, rem: 0, awake: 0, asleep: 0, restless: 0 };
  for (const s of segments) stages[s.stage] += s.to - s.from;
  const awake = stages.awake + stages.restless;
  return { id: date, date, startLocal: `${date}T23:00`, endLocal: `${date}T07:00`, isNap: false, minutesAsleep: t - awake, minutesAwake: awake, minutesInBed: t, stages, segments };
}

describe("sleep quality metrics", () => {
  it("measures time to the first deep stage, deep minutes, and splits waking into short (restless) and long (interruptions)", () => {
    const n = night([["awake", 10], ["light", 15], ["deep", 40], ["awake", 3], ["light", 30], ["awake", 12], ["rem", 20], ["awake", 2], ["deep", 30], ["light", 10], ["awake", 8]]);
    expect(sleepQuality(n)).toEqual({
      toSoundSleep: 25, // 10 awake in bed + 15 light
      soundSleep: 70,
      restless: 5, // 3 + 2 (the 10 before falling asleep and the 8 after the last sleep don't count)
      interruptions: { minutes: 12, count: 1 },
    });
  });

  it("merges back-to-back waking segments into one spell", () => {
    const n = night([["light", 20], ["awake", 3], ["restless", 3], ["light", 20]]);
    expect(sleepQuality(n)).toMatchObject({ restless: 0, interruptions: { minutes: 6, count: 1 } });
  });

  it("leaves out time to sound sleep on a night without deep sleep, but reports 0 sound sleep", () => {
    const m = sleepQuality(night([["light", 60], ["rem", 30]]));
    expect(m.toSoundSleep).toBeUndefined();
    expect(m.soundSleep).toBe(0);
    expect(m.interruptions).toEqual({ minutes: 0, count: 0 });
  });

  it("classic nights without a timeline only report restlessness", () => {
    const classic = { ...night([["asleep", 400]]), segments: [], stages: { deep: 0, light: 0, rem: 0, awake: 20, asleep: 400, restless: 15 } };
    expect(sleepQuality(classic)).toEqual({ restless: 15 });
    expect(sleepQuality(undefined)).toEqual({});
  });
});

describe("quality rows against the usual range", () => {
  // 10 baseline nights: deep onset 20–29 min, so the usual range is about 22–27.
  const baseline = Array.from({ length: 10 }, (_, i) => night([["light", 20 + i], ["deep", 60], ["awake", 2], ["light", 100]], `2026-10-${10 + i}`));

  it("calls a night inside the range typical and outside it higher or lower, without judging", () => {
    const rows = qualityRows([night([["light", 24], ["deep", 60], ["light", 100]])], baseline);
    const toSound = rows.find((r) => r.key === "toSoundSleep")!;
    expect(toSound.value).toBe(24);
    expect(toSound.status).toEqual({ tone: "good", text: "Typical" });
    const late = qualityRows([night([["light", 50], ["deep", 60], ["light", 100]])], baseline).find((r) => r.key === "toSoundSleep")!;
    expect(late.status.text).toBe("Higher than usual");
    expect(late.status.tone).toBe("info"); // neutral: more isn't automatically bad
  });

  it("averages several nights for week and month views, including the interruption count", () => {
    const rows = qualityRows([night([["light", 20], ["awake", 10], ["light", 20]]), night([["light", 20], ["light", 20]])], []);
    expect(rows.find((r) => r.key === "interruptions")).toMatchObject({ value: 5, count: 0.5, status: { text: "Not enough history" } });
  });

  it("drops metrics with neither a value nor history", () => {
    const keys = qualityRows([night([["light", 60]])], []).map((r) => r.key);
    expect(keys).not.toContain("toSoundSleep");
  });
});
