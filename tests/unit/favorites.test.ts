import { describe, expect, it } from "vitest";
import { getFavorites, parseTemplate, removeFavorite, saveFavorite } from "../../core/favorites.js";
import { FoodInputError } from "../../core/errors.js";
import { OZ, signIn } from "../helpers/fixtures.js";

describe("parseTemplate", () => {
  it("keeps only known fields", async () => {
    expect(parseTemplate({ kind: "quick", displayName: " Soup ", kcal: 120, proteinG: 5, injected: "<script>" })).toEqual({
      kind: "quick", displayName: "Soup", kcal: 120, proteinG: 5, carbsG: undefined, fatG: undefined, fiberG: undefined, sugarG: undefined, sodiumMg: undefined,
    });
    expect(parseTemplate({ kind: "food", food: "users/me/dataTypes/food/dataPoints/1", displayName: "Rice", amount: 2, unit: OZ, label: "oz", kcal: 80 })).toEqual({
      kind: "food", food: "users/me/dataTypes/food/dataPoints/1", displayName: "Rice", amount: 2, unit: OZ, label: "oz", kcal: 80,
    });
  });
  it.each([
    [{ kind: "quick", displayName: "x" }, /kcal is required/],
    [{ kind: "quick", kcal: 1 }, /displayName/],
    [{ kind: "food", displayName: "x", food: "nope", amount: 1 }, /food must be/],
    [{ kind: "food", displayName: "x", food: "users/me/dataTypes/food/dataPoints/1", amount: 0 }, /more than 0/],
    [{ kind: "bogus", displayName: "x" }, /kind must be/],
  ])("rejects %j", (input, msg) => {
    expect(() => parseTemplate(input)).toThrowError(msg);
    expect(() => parseTemplate(input)).toThrowError(FoodInputError);
  });
});

describe("favorites storage", () => {
  it("saves, lists alphabetically and removes, scoped to the signed-in user", async () => {
    signIn(undefined, "alice@example.com");
    const b = await saveFavorite({ kind: "quick", displayName: "Banana", kcal: 105 });
    await saveFavorite({ kind: "quick", displayName: "apple", kcal: 95 });
    expect((await getFavorites()).map((f) => f.template.displayName)).toEqual(["apple", "Banana"]);

    signIn(undefined, "bob@example.com");
    expect(await getFavorites()).toEqual([]);
    expect(await removeFavorite(b.id)).toBe(false); // can't remove another user's favorite

    signIn(undefined, "alice@example.com");
    expect(await removeFavorite(b.id)).toBe(true);
    expect((await getFavorites()).map((f) => f.template.displayName)).toEqual(["apple"]);
  });
});
