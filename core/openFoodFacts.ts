import { OffError } from "./errors.js";
import { platform } from "./platform.js";
import type { OffNutrition, OffProduct } from "../shared/food.js";

export { OffError } from "./errors.js";

/**
 * Open Food Facts (free, public product database) for food search and barcode
 * lookup. Results are logged to Google Health as quick-add entries.
 *
 * Usage policy (openfoodfacts.github.io/openfoodfacts-server/api, checked 2026-11-08):
 * - identify the app; the host supplies how (platform().off): a User-Agent header on the server;
 *   app_name/app_version query parameters in browsers, which can't set User-Agent (and an
 *   X-User-Agent header would force a CORS preflight that fails whenever OFF is busy);
 * - ≤10 searches/min and ≤15 product reads/min per IP; no search-as-you-type.
 *   Enforced here with sliding windows, plus caching (search 1 day, products 30 days).
 */
const SEARCH_URL = "https://search.openfoodfacts.org/search";
/** Legacy full-text search: the only search endpoint that sends CORS headers (verified 2026-11-08). */
const LEGACY_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";
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

/** Base pause between attempts (grows linearly); tests set it to 0. */
export const offRetry = { delayMs: 1200 };

/**
 * GET with retries. Open Food Facts answers about half of legacy-search requests with 503 under load, and those
 * 503s carry no CORS header, so in a browser they surface as a network error ("Failed to fetch"), not a status
 * (measured 2026-11-09). Both are retried; the query adds the host's identification (browser: app_name/app_version,
 * since an X-User-Agent header would force a CORS preflight that fails the same way).
 */
async function getJson(url: string, attempts: number, busyMessage: string): Promise<any> {
  const { headers, query } = platform().off;
  const full = query && Object.keys(query).length ? `${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams(query)}` : url;
  for (let attempt = 1; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await platform().fetch(full, { headers: { ...headers, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    } catch {
      res = null; // network error, or a 503 the browser hid because it had no CORS header
    }
    if (res && res.status === 404) return null;
    if (res?.ok) return res.json();
    const busy = !res || res.status === 503 || res.status === 502 || res.status === 504;
    if (busy && attempt < attempts) {
      await new Promise((r) => setTimeout(r, offRetry.delayMs * attempt));
      continue;
    }
    if (busy) throw new OffError(503, busyMessage);
    throw new OffError(res!.status === 429 ? 429 : 502, `Open Food Facts returned ${res!.status}. Try again shortly.`);
  }
}

const SEARCH_BUSY = "Open Food Facts search didn't respond (it's often overloaded). Try again in a minute, or scan the barcode instead.";
const PRODUCT_BUSY = "Couldn't reach Open Food Facts. Check your connection and try again.";

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
  let hits: unknown[];
  if (platform().off.search === "legacy") {
    const params = new URLSearchParams({ search_terms: q, search_simple: "1", action: "process", json: "1", page_size: "25", fields: FIELDS });
    // ~50% of single requests fail when OFF is busy (measured from Chrome 2026-11-09): 4 attempts ≈ 94% success.
    hits = ((await getJson(`${LEGACY_SEARCH_URL}?${params}`, 4, SEARCH_BUSY))?.products ?? []) as unknown[];
  } else {
    const params = new URLSearchParams({ q, page_size: "25", fields: FIELDS, langs: "en" });
    hits = ((await getJson(`${SEARCH_URL}?${params}`, 2, SEARCH_BUSY))?.hits ?? []) as unknown[];
  }
  const products = hits.map(toProduct).filter((p): p is OffProduct => p !== null);
  await platform().cache.put(key, "off", products, 24 * 3600_000);
  return products;
}

export async function productByBarcode(code: string): Promise<OffProduct | null> {
  if (!/^\d{6,14}$/.test(code)) throw new OffError(400, "A barcode is 6–14 digits");
  const key = `off:product:${code}`;
  const hit = await platform().cache.get<OffProduct | null>(key);
  if (hit) return hit.value;
  take("product");
  const data = await getJson(`${PRODUCT_URL}/${code}.json?fields=${FIELDS}`, 2, PRODUCT_BUSY);
  const product = data?.status === 1 ? toProduct({ ...data.product, code: data.product?.code ?? code }) : null;
  await platform().cache.put(key, "off", product, (product ? 30 : 1) * 24 * 3600_000);
  return product;
}
