import { describe, expect, it } from "vitest";
import { OffError, productByBarcode, searchFoods } from "../../core/openFoodFacts.js";
import { fakeFetch, json } from "../helpers/fakeGoogle.js";

const SEARCH = /search\.openfoodfacts\.org\/search$/;
const PRODUCT = /world\.openfoodfacts\.org\/api\/v2\/product\/\d+\.json$/;

describe("searchFoods", () => {
  it("normalizes hits: kJ fallback, salt → sodium, brand arrays, and drops unusable hits", async () => {
    const g = fakeFetch().on("GET", SEARCH, () => json({ hits: [
      { code: "1", product_name: "Nonfat Greek Yogurt", brands: ["Chobani", "Other"], nutriments: { "energy-kcal_100g": 52.9, proteins_100g: 9.41, carbohydrates_100g: 3.53, fat_100g: 0, sodium_100g: 0.0382 } },
      { code: "2", product_name: "Energy in kJ only", brands: "Acme, Sub", nutriments: { "energy-kj_100g": 418.4, salt_100g: 1 } },
      { code: "3", product_name: "", nutriments: { "energy-kcal_100g": 10 } }, // no name
      { code: "4", product_name: "No nutrition", nutriments: {} },
    ] }));
    const r = await searchFoods("  greek   yogurt ");
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ code: "1", name: "Nonfat Greek Yogurt", brand: "Chobani", servingSize: undefined, servingGrams: undefined, perServing: undefined,
      per100g: { kcal: 53, proteinG: 9.4, carbsG: 3.5, fatG: 0, fiberG: undefined, sugarG: undefined, sodiumMg: 38 } });
    expect(r[1]).toMatchObject({ brand: "Acme", per100g: { kcal: 100, sodiumMg: 400 } });
    const q = g.calls[0]!.url.searchParams;
    expect(q.get("q")).toBe("greek yogurt");
    expect(q.get("fields")).toContain("nutriments");
  });

  it("identifies itself with a User-Agent that contains no email unless OFF_CONTACT is set", async () => {
    const g = fakeFetch().on("GET", SEARCH, () => json({ hits: [] }));
    await searchFoods("ua check");
    expect(g.calls[0]!.headers["user-agent"]).toBe("HealthTracker/0.1 (personal non-commercial use)");
  });

  it("caches results, and cache hits don't count against the rate limit", async () => {
    const g = fakeFetch().on("GET", SEARCH, () => json({ hits: [] }));
    await searchFoods("cached query");
    await searchFoods("CACHED query");
    expect(g.calls).toHaveLength(1);
  });

  it("enforces 10 searches a minute", async () => {
    fakeFetch().on("GET", SEARCH, () => json({ hits: [] }));
    // Earlier tests in this file used some of the window; fill the rest with distinct queries.
    let err: unknown;
    for (let i = 0; i < 12 && !err; i++) await searchFoods(`limit test ${i}`).catch((e) => (err = e));
    expect(err).toBeInstanceOf(OffError);
    expect((err as OffError).status).toBe(429);
    expect((err as OffError).message).toMatch(/10 searches a minute/);
  });

  it("validates query length without calling the API", async () => {
    const g = fakeFetch();
    await expect(searchFoods("a")).rejects.toThrow(/2–100 characters/);
    expect(g.calls).toHaveLength(0);
  });
});

describe("productByBarcode", () => {
  it("returns serving data from the product record", async () => {
    fakeFetch().on("GET", PRODUCT, () => json({ status: 1, product: {
      code: "0894700010137", product_name: "Greek Yogurt", brands: "Chobani", serving_size: "1 serving (150 g)", serving_quantity: 150,
      nutriments: { "energy-kcal_100g": 73, "energy-kcal_serving": 110, proteins_serving: 12, carbohydrates_serving: 16, fat_serving: 0 },
    } }));
    const p = (await productByBarcode("0894700010137"))!;
    expect(p).toMatchObject({ name: "Greek Yogurt", brand: "Chobani", servingSize: "1 serving (150 g)", servingGrams: 150, perServing: { kcal: 110, proteinG: 12, carbsG: 16, fatG: 0 } });
  });

  it("returns null for unknown products (status 0 or 404)", async () => {
    fakeFetch()
      .on("GET", /product\/0000000000017\.json$/, () => json({ status: 0, status_verbose: "product not found" }))
      .on("GET", /product\/0000000000024\.json$/, () => new Response("not found", { status: 404 }));
    expect(await productByBarcode("0000000000017")).toBeNull();
    expect(await productByBarcode("0000000000024")).toBeNull();
  });

  it("rejects non-numeric barcodes", async () => {
    await expect(productByBarcode("abc123")).rejects.toThrow(/6–14 digits/);
  });

  it("reports network failures as a 503 OffError", async () => {
    fakeFetch().on("GET", PRODUCT, () => { throw new TypeError("getaddrinfo ENOTFOUND"); });
    const err = await productByBarcode("4006381333931").catch((e) => e);
    expect(err).toBeInstanceOf(OffError);
    expect(err.status).toBe(503);
  });
});
