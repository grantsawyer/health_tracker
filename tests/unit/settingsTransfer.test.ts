import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT, buildExport, exportFileName, newFavorites, parseImport } from "../../src/settingsTransfer.js";
import { DEFAULT_GOALS } from "../../shared/goals.js";
import { DEFAULT_LAYOUT } from "../../shared/layout.js";

const soup = { kind: "quick" as const, displayName: "Soup", kcal: 120 };
const rice = { kind: "food" as const, food: "users/me/dataTypes/food/dataPoints/42", displayName: "Rice", amount: 1, unit: "users/me/dataTypes/food-measurement-unit/dataPoints/226", label: "oz" };

describe("settings export / import", () => {
  it("round-trips goals, layout and favorite templates", () => {
    const file = buildExport({ ...DEFAULT_GOALS, steps: 9000 }, DEFAULT_LAYOUT, [{ id: "f1", template: soup }], new Date("2026-11-08T12:00:00Z"));
    expect(file).toMatchObject({ format: EXPORT_FORMAT, version: 1, exportedAt: "2026-11-08T12:00:00.000Z", favorites: [soup] });
    const parsed = parseImport(JSON.stringify(file));
    expect(parsed.goals).toMatchObject({ steps: 9000 });
    expect(parsed.layout).toEqual(DEFAULT_LAYOUT);
    expect(parsed.favorites).toEqual([soup]);
  });

  it("rejects other files with a readable message", () => {
    expect(() => parseImport("not json")).toThrow(/isn't JSON/);
    expect(() => parseImport(JSON.stringify({ goals: {} }))).toThrow(/wasn't made with/);
    expect(() => parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 2 }))).toThrow(/newer version/);
    expect(() => parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, layout: { today: ["nope"], week: [] } }))).toThrow(/Unknown card: nope/);
  });

  it("drops unknown goal keys so files from newer versions still import", () => {
    const parsed = parseImport(JSON.stringify({ format: EXPORT_FORMAT, version: 1, goals: { steps: 8000, futureGoal: 3 } }));
    expect(parsed.goals).toEqual({ steps: 8000 });
  });

  it("re-importing the same favorites adds nothing; key order doesn't matter", () => {
    const existing = [{ id: "f1", template: soup }];
    const reordered = { kcal: 120, displayName: "Soup", kind: "quick" as const };
    expect(newFavorites(existing, [reordered, rice, rice])).toEqual([rice]);
  });

  it("names the file by date", () => {
    expect(exportFileName(new Date(2026, 10, 8, 9))).toBe("health-tracker-settings-2026-11-08.json");
  });
});
