import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { fmtInt } from "../units";
import {
  LOG_MEAL_TYPES, type FavoriteFood, type FoodLogEntry, type FoodTemplate, type LibraryFood, type LogMealType,
  type NewFoodLogEntry, type OffNutrition, type OffProduct, type RecentFood,
} from "../../shared/food";

/**
 * Add or edit a food-log entry. Sources:
 *  - Favorites: saved templates (local app.db), one tap to prefill
 *  - Recent: things logged in the last 30 days
 *  - My foods: the owner's private food library (Google computes nutrition)
 *  - Search: Open Food Facts by name or barcode (typed, or webcam scan where the
 *    browser supports BarcodeDetector); logged as a quick add with scaled nutrition
 *  - Quick add: name + calories (+ optional macros)
 * Quick-add entries can't be patched by Google, so editing one replaces it (server-side).
 */

export const MEAL_LABEL: Record<string, string> = { BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner", SNACK: "Snack", ANYTIME: "Anytime" };

const localDate = (d = new Date()) => d.toLocaleDateString("en-CA");
const localTime = (d = new Date()) => d.toTimeString().slice(0, 5);

export function defaultMeal(time: string): LogMealType {
  const [h = 12, m = 0] = time.split(":").map(Number);
  const mins = h * 60 + m;
  if (mins >= 300 && mins < 630) return "BREAKFAST";
  if (mins >= 630 && mins < 900) return "LUNCH";
  if (mins >= 1020 && mins < 1290) return "DINNER";
  return "SNACK";
}

/** Seconds east of UTC for a local wall-clock time (handles DST correctly). */
const offsetFor = (timeLocal: string) => -new Date(timeLocal).getTimezoneOffset() * 60;

type Mode = "favorites" | "recent" | "library" | "search" | "quick";
const MODE_LABEL: Record<Mode, string> = { favorites: "Favorites", recent: "Recent", library: "My foods", search: "Search", quick: "Quick add" };

type QuickDraft = { kind: "quick"; displayName: string; kcal: string; proteinG: string; carbsG: string; fatG: string; fiberG: string; sugarG: string; sodiumMg: string };
type FoodDraft = { kind: "food"; food: LibraryFood; unit: string; amount: string };
type OffDraft = { kind: "off"; product: OffProduct; unit: "g" | "serving"; amount: string };
type Draft = QuickDraft | FoodDraft | OffDraft;

const emptyQuick = (): QuickDraft => ({ kind: "quick", displayName: "", kcal: "", proteinG: "", carbsG: "", fatG: "", fiberG: "", sugarG: "", sodiumMg: "" });
const str = (v: number | undefined) => (v === undefined ? "" : String(v));
const parseOpt = (s: string) => (s.trim() === "" ? undefined : Number(s));
const r1 = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 10) / 10);
const quickFrom = (t: Omit<Extract<FoodTemplate, { kind: "quick" }>, "kind">): QuickDraft => ({
  kind: "quick", displayName: t.displayName, kcal: str(t.kcal), proteinG: str(t.proteinG), carbsG: str(t.carbsG),
  fatG: str(t.fatG), fiberG: str(t.fiberG), sugarG: str(t.sugarG), sodiumMg: str(t.sodiumMg),
});

/** Nutrition for an Open Food Facts draft at its current amount, or undefined if it can't be computed. */
function offNutrition(d: OffDraft): OffNutrition | undefined {
  const amount = Number(d.amount);
  if (!(amount > 0)) return undefined;
  const { per100g, perServing, servingGrams } = d.product;
  let base: OffNutrition, factor: number;
  if (d.unit === "serving") {
    if (perServing) [base, factor] = [perServing, amount];
    else if (servingGrams) [base, factor] = [per100g, (servingGrams * amount) / 100];
    else return undefined;
  } else {
    [base, factor] = [per100g, amount / 100];
  }
  const scale = (v: number | undefined) => r1(v === undefined ? undefined : v * factor);
  return {
    kcal: Math.round(base.kcal * factor), proteinG: scale(base.proteinG), carbsG: scale(base.carbsG), fatG: scale(base.fatG),
    fiberG: scale(base.fiberG), sugarG: scale(base.sugarG), sodiumMg: base.sodiumMg === undefined ? undefined : Math.round(base.sodiumMg * factor),
  };
}

/** "1 serving (150 g)" → "150 g"; "30 g" → "30 g". */
const servingText = (p: OffProduct) => {
  if (!p.servingSize) return p.servingGrams ? `${p.servingGrams} g` : undefined;
  const cleaned = p.servingSize.replace(/^1\s*servings?\s*/i, "").replace(/^\((.*)\)$/, "$1").trim();
  return cleaned || p.servingSize;
};
const offName = (p: OffProduct) => (p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.name} (${p.brand})` : p.name).slice(0, 100);
const offLabel = (d: OffDraft) =>
  d.unit === "g" ? `${d.amount} g` : `${d.amount} serving${Number(d.amount) === 1 ? "" : "s"}${servingText(d.product) ? ` (${servingText(d.product)})` : ""}`;

/** An Open Food Facts draft becomes a quick-add with the scaled nutrition (Google can't store OFF foods). */
function offToQuick(d: OffDraft): Extract<FoodTemplate, { kind: "quick" }> | null {
  const n = offNutrition(d);
  return n ? { kind: "quick", displayName: `${offName(d.product)}, ${offLabel(d)}`.slice(0, 100), ...n } : null;
}

export function AddFood(props: {
  /** Day being viewed; new entries default to it. */
  date: string;
  editing?: FoodLogEntry;
  onDone: (saved: boolean, notice?: string) => void;
}) {
  const { editing } = props;
  const isToday = props.date === localDate();
  const [favorites, setFavorites] = useState<FavoriteFood[] | null>(null);
  const [mode, setMode] = useState<Mode>(editing ? (editing.food ? "library" : "quick") : "recent");
  const [draft, setDraft] = useState<Draft | null>(editing && !editing.food ? quickFrom({ ...editing, kcal: editing.kcal ?? 0 }) : null);
  const [date, setDate] = useState(editing ? editing.timeLocal.slice(0, 10) : props.date);
  const initialTime = editing ? editing.timeLocal.slice(11, 16) : isToday ? localTime() : "12:00";
  const [time, setTime] = useState(initialTime);
  const [meal, setMeal] = useState<LogMealType>(
    editing && (LOG_MEAL_TYPES as readonly string[]).includes(editing.mealType) ? (editing.mealType as LogMealType) : defaultMeal(initialTime),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favState, setFavState] = useState<"idle" | "saving" | "saved">("idle");

  const loadFavorites = useCallback(() => api.food.favorites().then(setFavorites, () => setFavorites([])), []);
  useEffect(() => {
    void loadFavorites().then(() => undefined);
  }, [loadFavorites]);
  // Open on Favorites when there are any (new entries only).
  const openedOnFavorites = useRef(false);
  useEffect(() => {
    if (!editing && favorites?.length && !openedOnFavorites.current && !draft && mode === "recent") {
      openedOnFavorites.current = true;
      setMode("favorites");
    }
  }, [favorites, editing, draft, mode]);

  // Editing a food-based entry: load the food so the unit picker has its servings.
  useEffect(() => {
    if (!editing?.food) return;
    api.food.item(editing.food).then((food) => {
      const label = editing.serving?.label?.toLowerCase();
      const unit = editing.serving?.unit ?? food.servings.find((s) => s.label.toLowerCase() === label || s.plural?.toLowerCase() === label)?.unit ?? food.defaultServing.unit;
      setDraft({ kind: "food", food, unit, amount: str(editing.serving?.amount ?? food.defaultServing.amount) });
    }, (err: Error) => setError(`Couldn't load this food: ${err.message}`));
  }, [editing]);

  const changeDraft = (d: Draft | null) => {
    setDraft(d);
    setFavState("idle");
  };
  const pickFood = (food: LibraryFood, unit?: string, amount?: number) =>
    changeDraft({ kind: "food", food, unit: unit ?? food.defaultServing.unit, amount: str(amount ?? food.defaultServing.amount) });

  const pickTemplate = async (t: FoodTemplate | RecentFood) => {
    setError(null);
    if (t.kind === "quick") return changeDraft(quickFrom(t));
    try {
      pickFood(await api.food.item(t.food), t.unit, t.amount);
    } catch (err) {
      setError(`Couldn't load ${t.displayName}: ${(err as Error).message}`);
    }
  };

  const pickProduct = async (p: OffProduct) => {
    setError(null);
    // Search hits lack serving data; the product record has it (cached, rate-limited server-side).
    let full = p;
    try {
      full = (await api.off.product(p.code)).product ?? p;
    } catch {
      /* fall back to the search hit (per-100 g only) */
    }
    const hasServing = Boolean(full.perServing || full.servingGrams);
    changeDraft({ kind: "off", product: full, unit: hasServing ? "serving" : "g", amount: hasServing ? "1" : "100" });
  };

  /** The current draft as a favorite template. */
  const asTemplate = (): FoodTemplate | null => {
    if (!draft) return null;
    if (draft.kind === "food") {
      const s = draft.food.servings.find((x) => x.unit === draft.unit);
      const amount = Number(draft.amount);
      return {
        kind: "food", food: draft.food.name, displayName: draft.food.displayName, amount, unit: draft.unit,
        label: s ? (amount === 1 ? s.label : s.plural ?? s.label) : undefined,
        kcal: draft.food.kcal !== undefined && s ? Math.round(draft.food.kcal * amount * s.multiplier) : undefined,
      };
    }
    if (draft.kind === "off") return offToQuick(draft);
    if (!draft.displayName.trim() || draft.kcal.trim() === "") return null;
    return {
      kind: "quick", displayName: draft.displayName.trim(), kcal: Number(draft.kcal), proteinG: parseOpt(draft.proteinG), carbsG: parseOpt(draft.carbsG),
      fatG: parseOpt(draft.fatG), fiberG: parseOpt(draft.fiberG), sugarG: parseOpt(draft.sugarG), sodiumMg: parseOpt(draft.sodiumMg),
    };
  };

  const saveFavorite = async () => {
    const t = asTemplate();
    if (!t) return;
    setFavState("saving");
    try {
      await api.food.addFavorite(t);
      setFavState("saved");
      void loadFavorites();
    } catch (err) {
      setFavState("idle");
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const timeLocal = `${date}T${time}`;
    const base = { mealType: meal, timeLocal, utcOffsetSeconds: offsetFor(timeLocal) };
    let entry: NewFoodLogEntry;
    if (draft.kind === "food") {
      entry = { ...base, kind: "food", food: draft.food.name, unit: draft.unit, amount: Number(draft.amount) };
    } else {
      const q = draft.kind === "off" ? offToQuick(draft) : asTemplate();
      if (!q || q.kind !== "quick") {
        setSaving(false);
        return setError("Fill in a name and calories first.");
      }
      entry = { ...base, ...q };
    }
    try {
      if (editing) {
        await api.food.update(editing.id, entry);
        props.onDone(true);
      } else {
        const res = await api.food.create(entry);
        props.onDone(true, res.status === "queued" ? `Google Health is unavailable right now, so “${res.pending.label}” was saved on this computer. It will sync automatically.` : undefined);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const modes: Mode[] = favorites?.length ? ["favorites", "recent", "library", "search", "quick"] : ["recent", "library", "search", "quick"];

  return (
    <section className="card card-wide food-panel" aria-label={editing ? "Edit food entry" : "Add food"}>
      <div className="food-panel-head">
        <h2>{editing ? `Edit ${editing.displayName}` : "Add food"}</h2>
        <button onClick={() => props.onDone(false)}>Cancel</button>
      </div>

      {!editing && (
        <div className="seg seg-wrap" role="tablist" aria-label="Food source">
          {modes.map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "seg-btn active" : "seg-btn"}
              onClick={() => { setMode(m); changeDraft(m === "quick" ? emptyQuick() : null); setError(null); }}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}

      {!draft && mode === "favorites" && favorites && (
        <FavoritesPicker favorites={favorites} onPick={(f) => pickTemplate(f.template)}
          onRemove={async (f) => { await api.food.removeFavorite(f.id); void loadFavorites(); }} />
      )}
      {!draft && mode === "recent" && <RecentPicker today={localDate()} onPick={pickTemplate} />}
      {!draft && mode === "library" && !editing && <LibraryPicker onPick={(f) => pickFood(f)} />}
      {!draft && mode === "search" && <SearchPicker onPick={pickProduct} onError={setError} />}
      {!draft && editing?.food && !error && <p className="muted">Loading…</p>}

      {draft && (
        <div className="food-form">
          {draft.kind === "food" && <FoodAmount draft={draft} onChange={changeDraft} />}
          {draft.kind === "quick" && <QuickFields draft={draft} onChange={changeDraft} />}
          {draft.kind === "off" && <OffAmount draft={draft} onChange={changeDraft} />}

          <div className="form-grid form-grid-3">
            <label>
              Meal
              <select value={meal} onChange={(e) => setMeal(e.target.value as LogMealType)}>
                {LOG_MEAL_TYPES.map((m) => <option key={m} value={m}>{MEAL_LABEL[m]}</option>)}
              </select>
            </label>
            <label>
              Date
              <input type="date" value={date} max={localDate()} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Time
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>

          {editing && !editing.food && (
            <p className="muted">Google can't edit quick-add entries in place, so saving replaces this entry with a new one.</p>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="actions">
            <button className="primary" onClick={save} disabled={saving || !isValid(draft)}>
              {saving ? "Saving…" : editing ? "Save changes" : "Log food"}
            </button>
            {!editing && <button onClick={() => changeDraft(mode === "quick" ? emptyQuick() : null)}>Back</button>}
            <button onClick={saveFavorite} disabled={favState !== "idle" || !asTemplate()} aria-live="polite">
              {favState === "saved" ? "★ Saved to favorites" : favState === "saving" ? "Saving…" : "☆ Save as favorite"}
            </button>
          </div>
        </div>
      )}
      {!draft && error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}

function isValid(d: Draft): boolean {
  if (d.kind === "food") return Number(d.amount) > 0;
  if (d.kind === "off") return offNutrition(d) !== undefined;
  const nums = [d.kcal, d.proteinG, d.carbsG, d.fatG, d.fiberG, d.sugarG, d.sodiumMg];
  return d.displayName.trim() !== "" && d.kcal.trim() !== "" && nums.every((s) => s.trim() === "" || (Number.isFinite(Number(s)) && Number(s) >= 0));
}

// ── Pickers ──────────────────────────────────────────────────────────────────

function useSearch<T>(items: T[] | null, text: (t: T) => string) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !needle || text(i).toLowerCase().includes(needle));
  }, [items, q, text]);
  return { q, setQ, filtered };
}

const templateDetail = (t: FoodTemplate) =>
  `${t.kind === "food" ? `${t.amount} ${t.label ?? ""}` : "Quick add"}${t.kcal !== undefined ? ` · ${fmtInt(t.kcal)} kcal` : ""}`;

function FavoritesPicker({ favorites, onPick, onRemove }: { favorites: FavoriteFood[]; onPick: (f: FavoriteFood) => void; onRemove: (f: FavoriteFood) => void }) {
  const text = useCallback((f: FavoriteFood) => f.template.displayName, []);
  const { q, setQ, filtered } = useSearch(favorites, text);
  return (
    <>
      {favorites.length > 8 && <input className="food-search" type="search" placeholder="Search favorites" value={q} onChange={(e) => setQ(e.target.value)} />}
      <ul className="pick-list">
        {filtered.map((f) => (
          <li key={f.id} className="pick-row">
            <button onClick={() => onPick(f)}>
              <span className="pick-name">{f.template.displayName}</span>
              <span className="muted">{templateDetail(f.template)}</span>
            </button>
            <button className="pick-remove" aria-label={`Remove ${f.template.displayName} from favorites`} title="Remove from favorites"
              onClick={() => { if (window.confirm(`Remove “${f.template.displayName}” from favorites?`)) onRemove(f); }}>×</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function RecentPicker({ today, onPick }: { today: string; onPick: (r: RecentFood) => void }) {
  const [items, setItems] = useState<RecentFood[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.food.recents(today).then(setItems, (e: Error) => setError(e.message));
  }, [today]);
  const text = useCallback((r: RecentFood) => r.displayName, []);
  const { q, setQ, filtered } = useSearch(items, text);
  if (error) return <p className="error-text">Couldn't load recent foods: {error}</p>;
  if (!items) return <p className="muted">Loading recent foods…</p>;
  if (!items.length) return <p className="muted">Nothing logged in the last 30 days. Try Search, My foods or Quick add.</p>;
  return (
    <>
      <input className="food-search" type="search" placeholder="Search recent foods" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="pick-list">
        {filtered.map((r, i) => (
          <li key={i}>
            <button onClick={() => onPick(r)}>
              <span className="pick-name">{r.displayName}</span>
              <span className="muted">{templateDetail(r)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function LibraryPicker({ onPick }: { onPick: (f: LibraryFood) => void }) {
  const [items, setItems] = useState<LibraryFood[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.food.library().then(setItems, (e: Error) => setError(e.message));
  }, []);
  const text = useCallback((f: LibraryFood) => `${f.displayName} ${f.brand ?? ""}`, []);
  const { q, setQ, filtered } = useSearch(items, text);
  if (error) return <p className="error-text">Couldn't load your foods: {error}</p>;
  if (!items) return <p className="muted">Loading your foods…</p>;
  if (!items.length) return <p className="muted">No saved foods in your Google Health / Fitbit library yet. Use Search or Quick add.</p>;
  return (
    <>
      <p className="muted">Your saved foods from Google Health / Fitbit. New foods can't be created through Google's API; use Search or Quick add for those.</p>
      <input className="food-search" type="search" placeholder="Search your foods" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="pick-list">
        {filtered.map((f) => (
          <li key={f.name}>
            <button onClick={() => onPick(f)}>
              <span className="pick-name">{f.displayName}{f.brand ? <span className="muted"> · {f.brand}</span> : null}</span>
              <span className="muted">
                {f.defaultServing.amount} {f.defaultServing.label}
                {f.kcal !== undefined ? ` · ${fmtInt(f.kcal)} kcal` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Open Food Facts search by name (on submit; the API forbids search-as-you-type) or barcode. */
function SearchPicker({ onPick, onError }: { onPick: (p: OffProduct) => void; onError: (msg: string | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OffProduct[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const canScan = typeof window !== "undefined" && "BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    onError(null);
    try {
      setResults(await api.off.search(q));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const lookup = async (barcode: string) => {
    const digits = barcode.replace(/\D/g, "");
    if (digits.length < 6) return onError("Enter the 6–14 digit number under the barcode.");
    setBusy(true);
    onError(null);
    try {
      const { product } = await api.off.product(digits);
      if (product) onPick(product);
      else onError(`No product with barcode ${digits} in Open Food Facts (or it has no nutrition data). Try searching by name, or use Quick add.`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="off-search">
      <form className="inline-form" onSubmit={search} role="search">
        <input className="food-search" type="search" placeholder="Search foods and brands, e.g. “chobani greek yogurt”" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Open Food Facts" />
        <button className="primary" type="submit" disabled={busy || q.trim().length < 2}>{busy && !code ? "Searching…" : "Search"}</button>
      </form>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void lookup(code); }}>
        <input className="food-search" type="text" inputMode="numeric" placeholder="Or enter a barcode number" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Barcode number" />
        <button type="submit" disabled={busy || code.replace(/\D/g, "").length < 6}>Look up</button>
        {canScan && <button type="button" onClick={() => setScanning(true)} disabled={busy}>Scan with camera</button>}
      </form>
      {scanning && <BarcodeScanner onCode={(c) => { setScanning(false); setCode(c); void lookup(c); }} onClose={() => setScanning(false)} onError={onError} />}
      <p className="muted small">Product data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer noopener">Open Food Facts</a> (crowd-sourced; check the label). Logged as a quick add.</p>

      {results && (results.length ? (
        <ul className="pick-list">
          {results.map((p) => (
            <li key={p.code}>
              <button onClick={() => onPick(p)}>
                <span className="pick-name">{p.name}{p.brand ? <span className="muted"> · {p.brand}</span> : null}</span>
                <span className="muted">{fmtInt(p.per100g.kcal)} kcal / 100 g</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="muted">No matches with nutrition data. Try fewer or different words.</p>)}
    </div>
  );
}

// Minimal typing for the Shape Detection API (Chrome/Edge; not in TS's DOM lib).
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> }
declare global {
  interface Window { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike }
}

/** Webcam barcode scanner using the browser's BarcodeDetector. Stops the camera on close. */
function BarcodeScanner({ onCode, onClose, onError }: { onCode: (c: string) => void; onClose: () => void; onError: (m: string | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Callbacks via a ref so parent re-renders don't restart the camera.
  const cb = useRef({ onCode, onClose, onError });
  cb.current = { onCode, onClose, onError };
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    const video = videoRef.current;

    /**
     * Release the camera. Must run on EVERY exit path: Stop, panel Cancel,
     * switching tabs, a successful scan, errors, leaving the page, and the
     * case where we're closed while getUserMedia() is still pending (React
     * StrictMode mounts twice in dev, which hits exactly that path).
     */
    const releaseCamera = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    };
    const close = () => {
      closed = true;
      releaseCamera();
    };

    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        stream = s;
        if (closed || !video) return releaseCamera(); // closed while the camera was starting
        video.srcObject = s;
        await video.play();
        if (closed) return releaseCamera();
        const detector = new window.BarcodeDetector!({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        timer = setInterval(async () => {
          if (closed || video.readyState < 2) return;
          try {
            const [hit] = await detector.detect(video);
            if (hit?.rawValue && !closed) {
              close(); // camera off as soon as we have a code
              cb.current.onCode(hit.rawValue);
            }
          } catch {
            /* frame not ready; keep scanning */
          }
        }, 250);
      } catch (err) {
        releaseCamera();
        if (closed) return;
        cb.current.onError(`Couldn't start the camera (${(err as Error).message}). You can type the barcode number instead.`);
        cb.current.onClose();
      }
    })();

    // Leaving or hiding the page also turns the camera off (and closes the scanner).
    const onHide = () => {
      if (document.visibilityState === "hidden" && !closed) {
        close();
        cb.current.onClose();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", close);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", close);
      close();
    };
  }, []);
  return (
    <div className="scanner">
      <video ref={videoRef} muted playsInline aria-label="Camera preview for barcode scanning" />
      <div className="actions"><span className="muted">Hold the barcode up to the camera…</span><button onClick={onClose}>Stop</button></div>
    </div>
  );
}

// ── Forms ────────────────────────────────────────────────────────────────────

function NutritionLine({ n, note }: { n: OffNutrition | undefined; note?: string }) {
  if (!n) return <p className="food-estimate muted">Enter an amount to see nutrition.</p>;
  return (
    <p className="food-estimate">
      <strong>{fmtInt(n.kcal)} kcal</strong>
      {([["protein", n.proteinG], ["carbs", n.carbsG], ["fat", n.fatG]] as const).map(([label, v]) =>
        v !== undefined ? <span key={label} className="muted"> · {v} g {label}</span> : null,
      )}
      {note && <span className="muted"> {note}</span>}
    </p>
  );
}

function OffAmount({ draft, onChange }: { draft: OffDraft; onChange: (d: Draft) => void }) {
  const { product } = draft;
  const hasServing = Boolean(product.perServing || product.servingGrams);
  return (
    <>
      <h3 className="food-name">{product.name}{product.brand ? <span className="muted"> · {product.brand}</span> : null}</h3>
      <div className="form-grid form-grid-2">
        <label>
          Amount
          <input type="number" inputMode="decimal" min="0" step="any" value={draft.amount} onChange={(e) => onChange({ ...draft, amount: e.target.value })} />
        </label>
        <label>
          Unit
          <select value={draft.unit} onChange={(e) => {
            const unit = e.target.value as OffDraft["unit"];
            onChange({ ...draft, unit, amount: unit === "g" ? String(Math.round(product.servingGrams ?? 100)) : "1" });
          }}>
            {hasServing && <option value="serving">serving{servingText(product) ? ` (${servingText(product)})` : ""}</option>}
            <option value="g">grams</option>
          </select>
        </label>
      </div>
      <NutritionLine n={offNutrition(draft)} note="· from Open Food Facts" />
    </>
  );
}

function FoodAmount({ draft, onChange }: { draft: FoodDraft; onChange: (d: Draft) => void }) {
  const { food } = draft;
  const serving = food.servings.find((s) => s.unit === draft.unit);
  const factor = serving ? Number(draft.amount || 0) * serving.multiplier : undefined;
  const est = (v: number | undefined) => (v !== undefined && factor !== undefined ? r1(v * factor) : undefined);
  return (
    <>
      <h3 className="food-name">{food.displayName}{food.brand ? <span className="muted"> · {food.brand}</span> : null}</h3>
      <div className="form-grid form-grid-2">
        <label>
          Amount
          <input type="number" inputMode="decimal" min="0" step="any" value={draft.amount} onChange={(e) => onChange({ ...draft, amount: e.target.value })} />
        </label>
        <label>
          Unit
          <select value={draft.unit} onChange={(e) => onChange({ ...draft, unit: e.target.value })}>
            {food.servings.map((s) => <option key={s.unit} value={s.unit}>{s.plural && Number(draft.amount) !== 1 ? s.plural : s.label}</option>)}
          </select>
        </label>
      </div>
      {food.kcal !== undefined && factor !== undefined
        ? <NutritionLine n={{ kcal: food.kcal * factor, proteinG: est(food.proteinG), carbsG: est(food.carbsG), fatG: est(food.fatG) }} note="(estimate; Google calculates the final values)" />
        : <p className="food-estimate muted">No calorie info for this food.</p>}
    </>
  );
}

function QuickFields({ draft, onChange }: { draft: QuickDraft; onChange: (d: Draft) => void }) {
  const [more, setMore] = useState(Boolean(draft.fiberG || draft.sugarG || draft.sodiumMg));
  const set = (k: keyof QuickDraft) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [k]: e.target.value });
  const macroKcal = [draft.proteinG, draft.carbsG].reduce((t, s) => t + (Number(s) || 0) * 4, 0) + (Number(draft.fatG) || 0) * 9;
  const field = (k: keyof QuickDraft, label: string, required = false) => (
    <label>
      {label}
      <input type="number" inputMode="decimal" min="0" step="any" value={draft[k] as string} onChange={set(k)} required={required} />
    </label>
  );
  return (
    <>
      <div className="form-grid form-grid-2">
        <label>
          Name
          <input type="text" value={draft.displayName} onChange={set("displayName")} maxLength={100} placeholder="e.g. Turkey sandwich" autoFocus />
        </label>
        {field("kcal", "Calories (kcal)", true)}
      </div>
      <div className="form-grid form-grid-3">
        {field("proteinG", "Protein (g)")}
        {field("carbsG", "Carbs (g)")}
        {field("fatG", "Fat (g)")}
      </div>
      {draft.kcal.trim() === "" && macroKcal > 0 && (
        <p className="muted">
          Macros add up to about {fmtInt(macroKcal)} kcal.{" "}
          <button className="link" onClick={() => onChange({ ...draft, kcal: String(Math.round(macroKcal)) })}>Use that</button>
        </p>
      )}
      {more ? (
        <div className="form-grid form-grid-3">
          {field("fiberG", "Fiber (g)")}
          {field("sugarG", "Sugar (g)")}
          {field("sodiumMg", "Sodium (mg)")}
        </div>
      ) : (
        <button className="link" onClick={() => setMore(true)}>Add fiber, sugar, sodium</button>
      )}
    </>
  );
}
