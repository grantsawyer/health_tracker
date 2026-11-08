# Health Tracker: notes for Claude

Personal local web app: dashboards for Google Health data (fitness, sleep, nutrition, body) plus
food logging written back to Google Health. Single user (the owner). See README.md for setup.

## Repo layout & policies

- This is its **own git repo**, nested inside `project-vibes/`. The parent ignores it via
  `project-vibes/.git/info/exclude` (`/health_tracker/`). Never `git add` it from the parent.
- Secrets, tokens, and cached data live in `~/.health_tracker/` (`HEALTH_TRACKER_HOME`), **never**
  in the repo. `.gitignore` is only a safety net.
- Only `server/googleHealth.ts` talks to `health.googleapis.com`. Keep all API shape mapping
  there, since the API is new (launched 2026-03-24) and still changing.

## Stack

- `server/`: Node + Hono (`@hono/node-server`), run with `tsx`. Binds 127.0.0.1.
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
