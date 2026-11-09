import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { configurePlatform } from "../../core/platform.js";
import { createEntry, listPendingWrites, processPendingWrites } from "../../core/food.js";
import { getGoals, updateGoals } from "../../core/goals.js";
import { getLayout, saveLayout } from "../../core/layout.js";
import { getFavorites, saveFavorite } from "../../core/favorites.js";
import { buildSummary } from "../../core/summary.js";
import { healthFetch } from "../../core/healthClient.js";
import { ReauthRequiredError } from "../../core/errors.js";
import { DEFAULT_GOALS } from "../../shared/goals.js";
import { done, fakeFetch, json } from "../helpers/fakeGoogle.js";
import { ALL_SCOPES, rollupDay } from "../helpers/fixtures.js";
import { memoryPlatform } from "../helpers/memoryPlatform.js";

describe("core/ is host-independent", () => {
  it("imports nothing from server/ or Node built-ins", () => {
    const dir = join(import.meta.dirname, "../../core");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      // Comments may mention these words; only code counts.
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const imports = [
        ...[...src.matchAll(/^(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/gm)].map((m) => m[1]!),
        ...[...src.matchAll(/^import\s*["']([^"']+)["']/gm)].map((m) => m[1]!),
        ...[...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]!),
      ];
      expect(imports.length, `${f} import scan`).toBeGreaterThan(f === "errors.ts" || f === "platform.ts" ? -1 : 0);
      for (const spec of imports) {
        expect(spec, `${f} imports ${spec}`).not.toMatch(/^(node:|\.\.\/server\/)/);
        expect(spec, `${f} imports ${spec}`).toMatch(/^\.{1,2}\//); // only relative imports (core/ or shared/)
      }
      expect(src, `${f} reads process.env`).not.toMatch(/process\.env/);
    }
  });
});

describe("core/ on an in-memory platform", () => {
  let mem: ReturnType<typeof memoryPlatform>;
  beforeEach(() => {
    mem = memoryPlatform();
    configurePlatform(mem.platform);
  });

  it("goals, layout and favorites round-trip through the SettingsStore", async () => {
    expect(await getGoals()).toEqual(DEFAULT_GOALS);
    await updateGoals({ steps: 12000 });
    expect(mem.settingsMap.get("goals")).toMatchObject({ steps: 12000 });
    await saveLayout({ today: ["stepsRing", "sleep"], week: ["weight"] });
    expect((await getLayout()).today).toEqual(["stepsRing", "sleep"]);
    await saveFavorite({ kind: "quick", displayName: "Soup", kcal: 120 });
    expect((await getFavorites()).map((f) => f.template.displayName)).toEqual(["Soup"]);
  });

  it("queues a failed food write in the PendingStore and sends it on retry", async () => {
    fakeFetch().on("POST", /\/nutrition-log\/dataPoints$/, () => json({ error: { message: "down" } }, 503));
    const r = await createEntry({ kind: "quick", displayName: "Soup", kcal: 120, mealType: "LUNCH", timeLocal: "2026-11-07T12:00", utcOffsetSeconds: 0 });
    expect(r.status).toBe("queued");
    expect(await listPendingWrites()).toHaveLength(1);
    await mem.platform.pending.makeDueNow(false);
    fakeFetch()
      .on("GET", /\/nutrition-log\/dataPoints$/, () => json({ dataPoints: [] }))
      .on("POST", /\/nutrition-log\/dataPoints$/, () => done({ name: "users/1/dataTypes/nutrition-log/dataPoints/9" }));
    expect((await processPendingWrites()).sent).toBe(1);
    expect(await listPendingWrites()).toEqual([]);
  });

  it("builds a summary using the platform cache", async () => {
    const g = fakeFetch()
      .on("POST", /\/steps\/dataPoints:dailyRollUp$/, () => json({ rollupDataPoints: [rollupDay("2026-11-06", "steps", { countSum: "4321" })] }))
      .on("POST", /:dailyRollUp$/, () => json({ rollupDataPoints: [] }))
      .on("GET", /\/dataPoints$/, () => json({ dataPoints: [] }));
    const s = await buildSummary("2026-11-06", "2026-11-07", false, new Set(ALL_SCOPES));
    expect(s.days[0]!.steps).toBe(4321);
    const calls = g.calls.length;
    await buildSummary("2026-11-06", "2026-11-07", false, new Set(ALL_SCOPES));
    expect(g.calls.length).toBe(calls); // second read served from the memory cache
  });

  it("surfaces a missing sign-in as ReauthRequiredError", async () => {
    mem.signOut();
    const g = fakeFetch();
    await expect(healthFetch("/users/me/identity")).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(g.calls).toHaveLength(0);
  });
});
