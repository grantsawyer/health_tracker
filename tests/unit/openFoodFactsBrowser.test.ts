import { beforeEach, describe, expect, it } from "vitest";
import { configurePlatform } from "../../core/platform.js";
import { offRetry, productByBarcode, searchFoods } from "../../core/openFoodFacts.js";
import { fakeFetch, json } from "../helpers/fakeGoogle.js";
import { memoryPlatform } from "../helpers/memoryPlatform.js";

/**
 * Open Food Facts from a browser: search.openfoodfacts.org sends no CORS
 * header, so the browser platform uses the legacy cgi/search.pl endpoint.
 * That endpoint answers ~half of requests with 503 *without* CORS headers, so
 * the browser sees "Failed to fetch". Requests must stay preflight-free (no
 * custom headers; identification in the query) and network errors are retried.
 * Separate file: the search rate-limit window is per module.
 */
const LEGACY = /world\.openfoodfacts\.org\/cgi\/search\.pl$/;
const PRODUCT = /world\.openfoodfacts\.org\/api\/v2\/product\/\d+\.json$/;
const product = { code: "1", product_name: "Oat Drink", brands: "Example Brand", nutriments: { "energy-kcal_100g": 46, proteins_100g: 1, carbohydrates_100g: 6.7, fat_100g: 1.5 } };
/** What a browser reports for a 503 that has no CORS header. */
const corsHidden503 = () => { throw new TypeError("Failed to fetch"); };

beforeEach(() => {
  const mem = memoryPlatform();
  mem.platform.off = { query: { app_name: "HealthTracker", app_version: "0.2.0" } };
  configurePlatform(mem.platform);
  offRetry.delayMs = 0;
});

describe("browser search (legacy endpoint)", () => {
  it("is a simple GET (no custom headers, so no CORS preflight) that identifies the app in the query", async () => {
    const g = fakeFetch().on("GET", LEGACY, () => json({ count: 1, page: 1, page_size: 25, products: [product] }));
    const r = await searchFoods("oat drink");
    expect(r).toEqual([expect.objectContaining({ code: "1", name: "Oat Drink", brand: "Example Brand", per100g: expect.objectContaining({ kcal: 46 }) })]);
    const call = g.calls[0]!;
    expect(Object.fromEntries(call.url.searchParams)).toMatchObject({
      search_terms: "oat drink", json: "1", search_simple: "1", action: "process", page_size: "25", app_name: "HealthTracker", app_version: "0.2.0",
    });
    expect(call.url.searchParams.get("fields")).toContain("nutriments");
    // Only CORS-safelisted headers: anything else (X-User-Agent, User-Agent) triggers a preflight.
    expect(Object.keys(call.headers)).toEqual(["accept"]);
  });

  it("retries a busy answer the browser hid as a network error, and a plain 503", async () => {
    const g = fakeFetch()
      .on("GET", LEGACY, corsHidden503, 1)
      .on("GET", LEGACY, () => json({}, 503), 1)
      .on("GET", LEGACY, () => json({ products: [product] }));
    expect(await searchFoods("busy then ok")).toHaveLength(1);
    expect(g.calls).toHaveLength(3);
  });

  it("gives up after four attempts with a message that suggests the barcode", async () => {
    const g = fakeFetch().on("GET", LEGACY, corsHidden503);
    await expect(searchFoods("always busy")).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/overloaded.*barcode/) });
    expect(g.calls).toHaveLength(4);
  });

  it("barcode lookups retry once and use the same query identification", async () => {
    const g = fakeFetch()
      .on("GET", PRODUCT, corsHidden503, 1)
      .on("GET", PRODUCT, () => json({ status: 1, product: { ...product, code: "12345678" } }));
    expect(await productByBarcode("12345678")).toMatchObject({ name: "Oat Drink" });
    expect(g.calls).toHaveLength(2);
    expect(g.calls[1]!.url.searchParams.get("app_name")).toBe("HealthTracker");
    expect(g.calls[1]!.url.searchParams.get("fields")).toContain("nutriments");
  });
});
