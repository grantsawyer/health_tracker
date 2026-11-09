# Health Tracker: notes for Claude

Personal local web app: dashboards for Google Health data (fitness, sleep, nutrition, body) plus
food logging written back to Google Health. Single user (the owner). See README.md for setup.

## Session handoff (start here)

**State as of 2026-11-08:**
- The app works locally (`npm run dev`, then http://localhost:5173) with the redesign, customizable Today page,
  inline goal editing, sleep benchmarks, food logging, and Open Food Facts.
- **Browser-only migration** (`docs/browser-migration-plan.md`) was approved with the recommended options:
  Google Drive app-data settings sync, GitHub Pages with a public repo, keep the local server until phase 6.
  **Phase 1 (core extraction) is done:** all logic is in `core/`, and the server is a thin host via
  `server/platform.ts`.
- **Phase 2 (browser platform) is done:** `platform/` holds GIS sign-in, the IndexedDB cache and retry queue, and
  settings in IndexedDB synced to Drive appData. It is tested but **not wired into the UI yet**.
- **Next: phase 3**, switching the seam: `src/api.ts` calls `core/` + `platform/` directly, GIS sign-in button,
  client-ID setup flow, settings export/import, OFF search via `cgi/search.pl` + `X-User-Agent`. Wiring notes are in
  the plan's §13.
- **Scope additions** S1–S9 (from a review of seven similar apps, 2026-11-08) are in the plan's §12: recovery vitals,
  BMR-only energy trimming, `.date` filter fallback, food→sleep connections, incremental sync, demo mode, a CI
  history scan before the repo goes public, client ID in the bundle, raw exercise type. Most land after phase 3.
- **Tests:** `npm test` (204 unit) and `npm run test:e2e` (15 browser). The owner prefers that tests aren't run
  unless asked; running them when adding or changing tests is expected.
- **Before committing:** run `npm run check:privacy`, `npm run typecheck`, and `npm run build`.
- **History rewrite pushed** 2026-11-08: `origin/main` no longer contains `28d4e58` (force-pushed with lease).

**Owner's local state (not in the repo):** `~/.health_tracker/` holds `.env` (client id and secret),
`token.enc`/`token.key`, `cache.db`, `app.db` (their goals, layout, favorites, retry queue) and
`private-patterns.txt`. Their real goals are saved in app.db, so changing the defaults doesn't affect them.

## Repo layout & policies

- This is its **own git repo**, nested inside `project-vibes/`. The parent ignores it via
  `project-vibes/.git/info/exclude` (`/health_tracker/`). Never `git add` it from the parent.
- Secrets, tokens, and cached data live in `~/.health_tracker/` (`HEALTH_TRACKER_HOME`), **never**
  in the repo. `.gitignore` is only a safety net.
- Only `server/googleHealth.ts` talks to `health.googleapis.com`. Keep all API shape mapping
  there, since the API is new (launched 2026-03-24) and still changing.

## Privacy rules (hard requirement)

- **Run `npm run check:privacy` before every commit and push.** It scans tracked + untracked files for the
  private literals in `~/.health_tracker/private-patterns.txt` (outside the repo) plus the real client id/secret
  from `.env`. A clean run is required; if it fails, remove the value (never add it to an allow-list in the repo).
  No git hook is installed by choice: the check is a documented step.
- Never commit personal data: no real health values, food names from a real log, emails, Google Health user
  ids, OAuth client ids/secrets, or screenshots. Tests and fixtures use synthetic values only; default goals are
  generic published references.
- Commits must use the GitHub noreply identity (repo-local `git config user.email` is set to it). Check
  `git config user.email` before committing in a new clone.
- History was rewritten on 2026-11-08 to remove a commit whose tests contained real health values (see below).

## Stack

- `core/` (phase 1 of docs/browser-migration-plan.md): all business logic, host-independent. Gets network,
  tokens, cache, settings and the retry queue from `core/platform.ts` (`configurePlatform`). Never imports
  `server/`, `node:*`, or reads `process.env` (enforced by `tests/unit/core.test.ts`).
  - `healthClient.ts` (Google Health API), `dataService.ts` (cached reads + TTL), `summary.ts`, `food.ts`
    (library, day log, recents, create/update/delete, retry queue), `openFoodFacts.ts`, `goals.ts`, `layout.ts`,
    `favorites.ts` (stored as one settings entry), `errors.ts`.
- `platform/` (phase 2, browser only; never imports `server/` or `node:*`, enforced by
  `tests/unit/browserPlatform.test.ts`): `idb.ts` (one DB `health-tracker`, stores cache / pending / settings, every
  record keyed by the signed-in email), `cache.ts`, `queue.ts` (same backoff as the server; `due()` is scoped to the
  signed-in user), `drive.ts` (one `settings.json` in appDataFolder), `settings.ts` (local copy plus per-key
  last-write-wins sync; never throws, reports status), `auth.ts` (GIS token model; `signIn()` must run inside a click;
  token in memory + sessionStorage), `browserPlatform.ts` (`createBrowserPlatform`, `browserScopes`, `startRetryLoop`).
  Tests use `fake-indexeddb` (pinned) and `tests/helpers/fakeBrowser.ts` (fake GIS, Drive, sessionStorage).
- `server/platform.ts`: the server's `Platform` (SQLite cache, app.db settings + pending queue per signed-in
  user, token file, client id). Imported by `server/app.ts`; also migrates the old favorites table once.


- `server/`: Node + Hono (`@hono/node-server`), run with `tsx`. Binds 127.0.0.1. Now a thin host for `core/`.
  - `config.ts`: env from `~/.health_tracker/.env`, paths, `REDIRECT_URI`
  - `tokenStore.ts`: AES-256-GCM encrypted token file
  - `oauth.ts`: auth URL (state + PKCE), code exchange, on-demand refresh, revoke
  - `googleHealth.ts`: `healthFetch` (auth header, 401 retry, `ACCOUNT_NOT_LINKED` mapping)
  - `cache.ts`: node:sqlite response cache (`~/.health_tracker/cache.db`), 5 min TTL if range includes today, else 24 h; `?fresh=1` bypasses
  - `dataRoutes.ts`: `/api/data-types`, `/api/data/:type/points|rollup`, `/api/data/delete`, `/api/debug/nutrition-test`
  - `index.ts`: Host/Origin guard, `/auth/*`, `/api/setup` (in-app credential setup → `~/.health_tracker/.env`), `/api/*`, static `dist/` in production
  - `dataService.ts`: cached `getPoints` / `getRollup` shared by raw routes and the summary
  - `food.ts`: library (private foods), units catalog (cached 30 d), day log, recents (last 30 days, deduped by
    food resource or name+kcal), create / update / delete with the rules below. Routes under `/api/food/*`.
  - `appStore.ts`: `~/.health_tracker/app.db` (NOT a cache; don't delete) holding `favorites` and
    `pending_writes`, keyed by user (signed-in email) so the schema already supports multiple users.
  - `favorites.ts`: validated FoodTemplate favorites. `openFoodFacts.ts`: OFF search
    (search.openfoodfacts.org) + product by barcode (world.openfoodfacts.org/api/v2), sliding-window rate
    limits (10 searches/min, 15 products/min), cached 1 d / 30 d, UA includes `OFF_CONTACT` env if set.
  - Retry queue: `createEntry` queues on Google 5xx/429, network failure or expired sign-in, then returns
    `{status:"queued"}`. A timer in index.ts runs `processPendingWrites` every 60 s (backoff 1→60 min).
  - `summary.ts`: `/api/summary` builds normalized `DailySummary[]`, `SleepSession[]`, `ExerciseSession[]`
    (shared/summary.ts) from 11 rollups + 3 lists in parallel; per-type failures land in `errors`
- `src/`: React + Vite SPA. Dev server proxies `/api` and `/auth` to the Node server.
  - `viz/`: hand-rolled SVG charts following the dataviz skill (ColumnChart stacked/single, LineChart
    with optional band, ScheduleChart, StatTile+sparkline, ChartCard with legend + table toggle).
    Palette = dataviz reference slots 1–4 + ordinal blue ramp, validated light/dark; light slots 3–4
    are below 3:1, so every chart keeps a table view.
  - `food/`: FoodView (day log + trends; `?date=YYYY-MM-DD#food` deep link) and AddFood (Recent / My foods /
    Quick add panel, also used for edits).
  - `ui/`: icons, status Pill. `viz/` adds MiniTrend (overview cards), Ring, RangeBar, SleepTimeline (hypnogram).
  - `dashboard/`: DashboardShell (one filter row: range, units, refresh), Today/Fitness/Sleep/Body views.
    Tabs are linkable (`#sleep`). Units, range and tab are per-browser localStorage conveniences.
- `shared/types.ts`: types used by both. `shared/dataTypes.ts`: data type registry (id, union field, filter kind, scope, rollup limits).

## Google Health API facts (verified against docs 2026-11-07)

- Base URL `https://health.googleapis.com/v4`; identity: `GET /users/me/identity`
  → `{ name, legacyUserId, healthUserId }` (no email; we take email from the `openid email` id_token).
- Scopes: `https://www.googleapis.com/auth/googlehealth.<category>.readonly|.writeonly`.
  Write scopes don't grant read. Users may grant a subset, so always check the granted `scope`.
- OAuth client type documented: **Web Server** (client secret). Hence the backend.
- Testing-mode refresh tokens expire after **7 days**; `invalid_grant` → `reauth_required`.
- dataPoints methods: list, get, create, patch, batchDelete, rollUp, dailyRollUp, reconcile,
  exportExerciseTcx. Data types used: `nutrition-log`, `food`, `food-measurement-unit`,
  `hydration-log`, steps, sleep, weight, etc.
- `NutritionLog`: `interval` (required), `energy`, `totalFat`, `totalCarbohydrate`,
  `energyFromFat`, `nutrients[]` ({nutrient, quantity g}), `mealType`
  (BREAKFAST/LUNCH/DINNER/SNACK), `serving` ({foodMeasurementUnit, amount}), `food` (resource
  name). **Logs from anonymous food are not editable**, so prefer creating a private `Food` first.
- Unconfirmed: which data types accept `create`. Verify a nutrition write early in Phase 2.
  Use the Data explorer “Write test food entry” button, then query Food log with “Written by this app”.
- **List filter prefix is the snake_case data type id** (`nutrition_log.interval.civil_start_time`,
  `daily_resting_heart_rate.date`), verified live 2026-11-07. The camelCase union field is rejected
  with `INVALID_DATA_POINT_FILTER_DATA_TYPE_RESTRICTION`, despite the docs' `dailyHeartRateVariability` example.
- `daily-resting-heart-rate` does NOT support dailyRollUp (only list/reconcile).
- Live rollup value shapes (int64s arrive as strings): `steps.countSum`, `distance.millimetersSum`,
  `floors.countSum`, `totalCalories.kcalSum`, `heartRate.beatsPerMinute{Avg,Min,Max}`,
  `activeZoneMinutes.sumIn{FatBurn,Cardio,Peak}HeartZone`,
  `activeMinutes.activeMinutesRollupByActivityLevel[{activityLevel, activeMinutesSum}]`,
  `weight.weightGramsAvg`, `bodyFat.bodyFatPercentageAvg`, `nutritionLog.{energy.kcalSum, totalFat.gramsSum,
  totalCarbohydrate.gramsSum, nutrients[{nutrient, quantity.gramsSum}]}`. Days without data are absent.
- Live nutrition logs use `mealType: "ANYTIME"` (not in the documented enum) and `serving.foodMeasurementUnitDisplayName`.
- Sleep points: `summary.{minutesAsleep, minutesAwake, minutesInSleepPeriod, stagesSummary[{type, minutes}]}`,
  `metadata.{nap, mainSleep}`. Times are UTC plus `*UtcOffset` like `"-18000s"`.
- `sleep`, `food`, `food-measurement-unit` reject `dataSourceFamily`; list pageSize caps at 25 for sleep/exercise.
- dailyRollUp range caps: 14 days for heart-rate, active-minutes, total-calories, calories-in-heart-rate-zone; else 90.
- create/patch/batchDelete return an `Operation` that is already `done: true` with the DataPoint in `response`
  (verified live 2026-11-08).
- **batchDelete rejects mixed data types** ("Multiple data types are not supported at the moment"), and the `-`
  wildcard parent fails. `batchDeleteDataPoints` groups names by type and calls each collection.
- **Client-chosen data point IDs are ignored** on create (Google assigns its own; verified 2026-11-08), so
  retries can't rely on IDs. Each new entry gets a random millisecond offset inside its minute; the exact
  `interval.startTime` is a fingerprint, and the queue checks self-sources for it before re-sending.
- Open Food Facts search hits lack serving fields; picking a hit fetches the product record for servings.
- **Food logging rules (verified live 2026-11-08, see shared/food.ts):**
  - `food` is read-only (list/get). Apps cannot create foods. Listing returns the owner's PRIVATE foods first,
    then the public database (thousands); `getMyFoods` stops at the first page containing a public food.
  - `food` / `food-measurement-unit` lists are capped at 25 per page regardless of pageSize.
  - Logs against a food (`food` + `serving{foodMeasurementUnit, amount}`) get nutrition computed by Google and
    CAN be patched. Anonymous logs (no food) CANNOT be patched (400); edit = create replacement, then delete.
  - Read-back logs carry `serving.foodMeasurementUnitDisplayName` but often not the unit id; recover it by
    matching the label against the food's `servings`.
  - Write scope only allows changing data this OAuth client wrote: `dataSource.application.googleWebClientId`
    equals our client ID. Entries from Fitbit etc. are shown read-only.

## Design system (2026-11-08)

Direction: reference screenshots kept locally in `samples/` (gitignored: they contain personal data).
Adapted, not copied: no Google branding.
- Tokens in `src/styles.css` (chrome) and `src/viz/viz.css` (charts). Dark is primary; light follows the OS.
  Radius by hierarchy: 28 cards · 20 tiles · 14 inputs · pills round. No shadows. Figtree font.
- Category tones (UI identity only): activity aqua, sleep lavender, heart green, food blue, body amber.
  Status pills (good/warn/info) are reserved and always carry text.
- Chart palettes were validated with the dataviz `validate_palette.js` against #1f2125 / #ffffff:
  sleep stages stacked deep violet · REM aqua · light blue · awake pink (violet next to blue FAILS);
  macros carbs blue · fat pink · protein gold; intensity (AZM zones, active minutes) = ordinal blue ramp.
  Sample-style pastel blues/cyans failed the checks: deliberately not used.
- Period model `src/dashboard/period.ts`: D/W/M/3M with ‹ › and back-to-today; weeks are Mon–Sun. No "Y"
  (a year needs ~27 heart-rate rollup requests, so cold loads would take close to a minute). Today tab = always D.
- "Typical range" = the owner's own last 30 days, mean ± 1 SD (`baseline.ts`), never population norms.
  Macro "On target" uses a ±10% display tolerance (FoodView), documented as such.
- Goals live in app.db (`server/goals.ts`, Account page). Google's API exposes none. Defaults are generic and
  sourced (FDA Daily Values, Fitbit default targets); never derive defaults or test data from a real account.
- Sleep D night card (`NightDetail` + `sleepStages.ts`): chips switch Timeline / Compared with usual /
  30-day average, after the owner's benchmarks screenshot. Stage share = minutes ÷ time in bed. "Usual" is the
  owner's last 30 nights (the sample says "people like you"; the API has no population data). Pills: Typical =
  good; Higher/Lower than usual = neutral (the sample colors all green, but status green is reserved for good,
  and more REM / less deep isn't inherently good).
- Today page is customizable: `shared/layout.ts` (22 card ids incl. `stepsRing`; "today" = 12 SLOTS, the ring
  uses 3 (`slotSize`); "week" = 12 cards; layout v2 added the ring as a card, v1 layouts get it prepended),
  defaults, validation shared with the server), `server/layout.ts` (app.db, per user; stale ids cleaned on read),
  `src/dashboard/cards.tsx` (registry: tile + week renderers, availability = any data in last 30 days),
  `CardBoard.tsx` (Customize mode: drag/drop + ‹ › + ×, picker; edits are a draft until Done).
  Today grid: container query on `.today-wrap`: 4 columns ≥760px board width (4 × 3), else 2 (2 × 6); rows 96px;
  `grid-auto-flow: row dense`; the ring card spans 3 rows. Fitness (D) keeps its own square ring (`.day-hero`).
- Goals are editable inline (`src/ui/GoalEditor.tsx`) wherever a goal is shown; all dashboard views share one
  goals source (`goalsContext.tsx`, provided by DashboardShell), so an edit updates every chart immediately.
  Mini trend cards are buttons, so they get no inline editor (no nested buttons); edit from the tab instead.
- Sidebar collapses to icons (wide screens; `health-tracker:rail-collapsed` in localStorage).
- Grid items containing charts must size their column from the card (`minmax(0, 1fr)`), never from the SVG:
  an auto column sized to the chart made charts keep stale widths after a window resize.
- Pill-shaped bars (from the samples) instead of the dataviz 4px data-end; goal lines with check badges.
- `useWidth` uses a callback ref: charts swap between empty state and plot, and a once-only effect left
  some charts at width 0.

## Tests

- `npm test` = Vitest unit suite (`tests/unit/*.test.ts`); `npm run test:e2e` = Playwright (`tests/e2e/`,
  Chrome channel, Vite on 5174, all `/api` mocked in-browser via `tests/e2e/mockApi.ts`).
- `tests/setup.ts` sets `HEALTH_TRACKER_HOME` to a fresh temp dir per test file BEFORE server modules load
  (config.ts reads env at import). Never point tests at `~/.health_tracker`.
- `tests/helpers/fakeGoogle.ts` replaces `fetch` with a strict router: unmatched requests throw.
  Fixtures are synthetic but shaped like live responses; never commit real health data.
- `server/app.ts` holds routes/guards; `server/index.ts` only binds the port and starts the retry timer,
  so tests can call `app.request()`.
- Pure UI logic lives in `.ts` modules (`src/food/offMath.ts`, `src/dashboard/sleep.ts`, `src/viz/scale.ts`,
  `src/units.ts`) so it's testable without React.
- Mutation-checked 2026-11-08: breaking the snake_case filter prefix, the create-before-delete order for
  quick-add edits, or the retry queue's already-written check each fails the suite.
- Owner preference (project memory): don't run test suites unless asked.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Google Cloud project, consent screen, OAuth client, `~/.health_tracker/.env` (owner) | done |
| 1 | Repo skeleton, OAuth + encrypted tokens, `/api/status`, connection page, in-app setup wizard | done (owner connected 2026-11-07) |
| 2 | Typed dataPoints client, SQLite cache, raw-data Data explorer | done (verified live 2026-11-07) |
| 3 | Dashboards: Today, Fitness, Sleep, Body (`/api/summary`, 7/30/90-day ranges) | built; owner said keep going 2026-11-08 |
| 4 | Food tab: day log by meal, add from Recent / My foods / Quick add, edit, delete, nutrition trends | **built, awaiting owner test** (API paths verified live; UI driven without saving) |
| 5 | Open Food Facts search + barcode (typed or webcam), favorites, retry queue. PWA/mobile skipped by owner. | **built, awaiting owner test** (queue verified live with simulated failures; UI driven without logging) |

Defaults chosen 2026-11-07 (owner may revise): accept weekly re-auth; localhost only; Open Food
Facts deferred to Phase 5.

Deliberately NOT done: no PWA/mobile build (owner skipped it); no OFF search-as-you-type (OFF policy); OFF contact email not sent unless OFF_CONTACT is set; no creating foods (API forbids it; quick add instead); no editing other apps' entries (scope forbids it); no `include_granted_scopes` (legacy Google Fit consent breaks tokens);
no browser-only/implicit OAuth flow (Google documents only the Web Server client for this API, and the
secret can't live in the browser); no Google verification/publishing (single user).
