import { OffError } from "./errors.js";
import { platform } from "./platform.js";
import type { OffNutrition, OffProduct } from "../shared/food.js";

export { OffError } from "./errors.js";

/**
 * Open Food Facts (free, public product database) for food search and barcode
 * lookup. Results are logged to Google Health as quick-add entries.
 *
 * Usage policy (openfoodfacts.github.io/openfoodfacts-server/api, checked 2026-11-08):
 * - identify the app with a User-Agent; the host supplies it (platform().offUserAgent);
 * - ≤10 searches/min and ≤15 product reads/min per IP; no search-as-you-type.
 *   Enforced here with sliding windows, plus caching (search 1 day, products 30 days).
 */
const SEARCH_URL = "https://search.openfoodfacts.org/search";
const PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
const FIELDS = "code,product_name,brands,serving_size,serving_quantity,nutriments";


// ── Rate limiting (sliding one-minute windows) ───────────────────────────────
const windows = { search: [] as number[], product: [] as number[] };
const LIMITS = { search: 10, product: 15 };
function take(kind: keyof typeof windows) {
  const now = Date.now();
  const w = windows[kind].filter((t) => now - t < 60_000);
  windows[kind] = w;
  if (w.length >= LIMITS[kind]) {
    const wait = Math.ceil((60_000 - (now - w[0]!)) / 1000);
    throw new OffError(429, `Open Food Facts allows ${LIMITS[kind]} ${kind === "search" ? "searches" : "barcode lookups"} a minute. Try again in ${wait}s.`);
  }
  w.push(now);
}

async function getJson(url: string): Promise<any> {
  let res: Response;
  try {
    res = await platform().fetch(url, { headers: { "User-Agent": platform().offUserAgent, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new OffError(503, `Couldn't reach Open Food Facts (${(err as Error).message}).`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new OffError(res.status === 429 ? 429 : 502, `Open Food Facts returned ${res.status}. Try again shortly.`);
  return res.json();
}

// ── Normalization ────────────────────────────────────────────────────────────
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const r1 = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 10) / 10);

function nutrition(n: Record<string, unknown>, suffix: "_100g" | "_serving"): OffNutrition | undefined {
  const kcal = num(n[`energy-kcal${suffix}`]) ?? (num(n[`energy-kj${suffix}`]) !== undefined ? num(n[`energy-kj${suffix}`])! / 4.184 : undefined);
  if (kcal === undefined) return undefined;
  const sodiumG = num(n[`sodium${suffix}`]) ?? (num(n[`salt${suffix}`]) !== undefined ? num(n[`salt${suffix}`])! / 2.5 : undefined);
  return {
    kcal: Math.round(kcal),
    proteinG: r1(num(n[`proteins${suffix}`])),
    carbsG: r1(num(n[`carbohydrates${suffix}`])),
    fatG: r1(num(n[`fat${suffix}`])),
    fiberG: r1(num(n[`fiber${suffix}`])),
    sugarG: r1(num(n[`sugars${suffix}`])),
    sodiumMg: sodiumG !== undefined ? Math.round(sodiumG * 1000) : undefined,
  };
}

function toProduct(p: any): OffProduct | null {
  if (!p?.code) return null;
  const name = String(p.product_name ?? "").trim();
  const n = (p.nutriments ?? {}) as Record<string, unknown>;
  const per100g = nutrition(n, "_100g");
  if (!name || !per100g) return null; // nothing useful to log
  const brand = (Array.isArray(p.brands) ? p.brands : String(p.brands ?? "").split(","))
    .map((b: unknown) => String(b).trim()).filter(Boolean)[0];
  return {
    code: String(p.code),
    name,
    brand,
    servingSize: p.serving_size ? String(p.serving_size).trim() : undefined,
    servingGrams: num(p.serving_quantity) || undefined,
    per100g,
    perServing: nutrition(n, "_serving"),
  };
}

// ── API ──────────────────────────────────────────────────────────────────────
export async function searchFoods(query: string): Promise<OffProduct[]> {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2 || q.length > 100) throw new OffError(400, "Search for 2–100 characters");
  const key = `off:search:${q.toLowerCase()}`;
  const hit = await platform().cache.get<OffProduct[]>(key);
  if (hit) return hit.value;
  take("search");
  const params = new URLSearchParams({ q, page_size: "25", fields: FIELDS, langs: "en" });
  const data = await getJson(`${SEARCH_URL}?${params}`);
  const products = ((data?.hits ?? []) as unknown[]).map(toProduct).filter((p): p is OffProduct => p !== null);
  await platform().cache.put(key, "off", products, 24 * 3600_000);
  return products;
}

export async function productByBarcode(code: string): Promise<OffProduct | null> {
  if (!/^\d{6,14}$/.test(code)) throw new OffError(400, "A barcode is 6–14 digits");
  const key = `off:product:${code}`;
  const hit = await platform().cache.get<OffProduct | null>(key);
  if (hit) return hit.value;
  take("product");
  const data = await getJson(`${PRODUCT_URL}/${code}.json?fields=${FIELDS}`);
  const product = data?.status === 1 ? toProduct({ ...data.product, code: data.product?.code ?? code }) : null;
  await platform().cache.put(key, "off", product, (product ? 30 : 1) * 24 * 3600_000);
  return product;
}
