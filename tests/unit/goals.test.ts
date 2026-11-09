import { describe, expect, it } from "vitest";
import { getGoals, goalsSaved, updateGoals } from "../../core/goals.js";
import { FoodInputError } from "../../core/errors.js";
import { DEFAULT_GOALS } from "../../shared/goals.js";
import { signIn } from "../helpers/fixtures.js";

describe("goals", () => {
  it("start from the defaults and merge partial updates", async () => {
    signIn(undefined, "goals@example.com");
    expect(await getGoals()).toEqual(DEFAULT_GOALS);
    const g = await updateGoals({ steps: 10000, sleepMinutes: 450 });
    expect(g).toEqual({ ...DEFAULT_GOALS, steps: 10000, sleepMinutes: 450 });
    expect((await getGoals()).steps).toBe(10000);
    expect((await updateGoals({ sleepMinutes: null })).sleepMinutes).toBeNull();
    expect((await updateGoals({ exerciseDaysPerWeek: 4.6 })).exerciseDaysPerWeek).toBe(5);
  });
  it("reports whether goals were ever saved (first run runs on the defaults)", async () => {
    signIn(undefined, "first-run@example.com");
    expect(await goalsSaved()).toBe(false);
    await getGoals(); // reading doesn't save
    expect(await goalsSaved()).toBe(false);
    await updateGoals({ steps: 10000 });
    expect(await goalsSaved()).toBe(true);
  });
  it("bedtime and wake time are optional clock times (midnight allowed, clearable)", async () => {
    signIn(undefined, "clock@example.com");
    expect(await getGoals()).toMatchObject({ bedtime: null, wakeTime: null });
    expect(await updateGoals({ bedtime: 1350, wakeTime: 0 })).toMatchObject({ bedtime: 1350, wakeTime: 0 });
    expect(await updateGoals({ bedtime: null })).toMatchObject({ bedtime: null, wakeTime: 0 });
  });
  it.each([
    [{ bedtime: 1440 }, /bedtime must be a time of day/],
    [{ wakeTime: -1 }, /wakeTime must be a time of day/],
    [{ wakeTime: 390.5 }, /wakeTime must be a time of day/],
    [{ bedtime: "22:30" }, /bedtime must be a time of day/],
    [{ steps: 0 }, /steps must be/],
    [{ steps: "8000" }, /steps must be/],
    [{ carbsG: 5000 }, /carbsG must be/],
    [{ bogus: 1 }, /Unknown goal/],
    [[1, 2], /JSON object/],
  ])("rejects %j", async (body, msg) => {
    signIn(undefined, "goals@example.com");
    await expect(updateGoals(body)).rejects.toThrowError(msg);
    await expect(updateGoals(body)).rejects.toThrowError(FoodInputError);
  });
  it("are stored per user", async () => {
    signIn(undefined, "a@example.com");
    await updateGoals({ floors: 25 });
    signIn(undefined, "b@example.com");
    expect((await getGoals()).floors).toBe(DEFAULT_GOALS.floors);
  });
});
