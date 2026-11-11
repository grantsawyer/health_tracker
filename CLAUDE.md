# Health Tracker: notes for Claude

Personal local web app: dashboards for Google Health data (fitness, sleep, nutrition, body) plus
food logging written back to Google Health. Single user (the owner). See README.md for setup.

## Session handoff (start here)

**State as of 2026-11-08:**
- The app runs **without a server**: `npm run dev` (Vite only), then http://localhost:5173. It has the redesign,
  customizable Today page, inline goal editing, sleep benchmarks, food logging, and Open Food Facts. The old local
  server remains as a fallback: `npm run dev:server-mode` (`VITE_BACKEND=server`).
- **Browser-only migration** (`docs/browser-migration-plan.md`) was approved with the recommended options:
  Google Drive app-data settings sync, GitHub Pages with a public repo, keep the local server until phase 6.
  **Phase 1 (core extraction) is done:** all logic is in `core/`, and the server is a thin host via
  `server/platform.ts`.
- **Phase 2 (browser platform) is done:** `platform/` holds GIS sign-in, the IndexedDB cache and retry queue, and
  settings in IndexedDB synced to Drive appData.
- **Phase 3 (switch the seam) is done**, confirmed by the owner 2026-11-09 (settings import and food edits work). `src/api.ts` picks the
  browser backend (`api.browser.ts` → core + platform) by default. The setup wizard asks for a client ID and a
  JavaScript origin, sign-in is a GIS pop-up, the Account page has settings export/import plus the Drive sync
  status, and OFF search uses `cgi/search.pl` with `X-User-Agent`. Verified with fakes only; real sign-in needs
  the owner to:
  1. add `http://localhost:5173` under Authorized JavaScript origins on the existing OAuth client;
  2. enable the Google Drive API and add the `drive.appdata` scope on Data Access;
  3. paste the client ID once in the setup screen;
  4. export settings from server mode and import them in browser mode.
- **Phase 4 (multi-user readiness) is built, awaiting a live check with a second test account** (2026-11-09):
  - **First-run card** on Today until goals are saved (`goalsSaved()` in core; `saved` in the goals context).
  - **Drive paused:** when Drive sync is paused, the card offers only "Connect Google Drive", never "Keep these".
    Saving defaults there would become the newest copy and overwrite the real goals in Drive on the next sync.
  - **Account → Forget this device** (`logout({ forgetDevice })`) warns with the unsent-entry count.
  - **Isolation test:** the e2e fake keeps data per account (`switchAccount`, `driveOf`).
  - **README:** "Sharing it with other people".
- **Next: phase 5** (GitHub Pages deploy, CSP, Pages origin on the OAuth client, S6 demo mode, S7 CI history
  scan before the repo goes public).
- **Commit directly to `main`** in this repo (owner's instruction 2026-11-09). Don't create branches; push only
  when asked.
- **Scope additions** S1–S9 (from a review of seven similar apps, 2026-11-08) are in the plan's §12: recovery vitals,
  BMR-only energy trimming, `.date` filter fallback, food→sleep connections, incremental sync, demo mode, a CI
  history scan before the repo goes public, client ID in the bundle, raw exercise type. Most land after phase 3.
- **Tests:** `npm test` (216 unit) and `npm run test:e2e` (19 browser, serverless app against fakes). The owner prefers that tests aren't run
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

- **Coding-agent settings files never get committed.** Claude Code's "Yes, and don't ask again" saves the full
  approved command, including any secret in it, to `.claude/settings.local.json`, and only ignores that file in the
  user's global gitignore (other clones don't have it; Apiiro found 1,122 public copies with real secrets, Nov 2026).
  Every agent folder (`.claude/`, `.cursor/`, `.gemini/`, `.specstory/`, `.codex/`, `.aider*`, `*.local.md`,
  `.mcp.json`) is treated like `.env`: ignored in `.gitignore`, and `scripts/check-secrets.mjs` blocks it even when
  force-added. It also scans for credential patterns (Google client secrets, tokens and API keys;
  GitHub/AWS/Anthropic/OpenAI/Slack keys; private keys) **and passwords inside commands** (`PGPASSWORD=`,
  `sshpass -p`, `mysql -p…`, bearer headers, `user:pass@` URLs, `curl -u`). `$VAR` references are allowed.
  Never put a secret on a command line; reference `$VAR` or read it from `~/.health_tracker/.env`. Test values must
  look fake (contain "test", "example", "synthetic", …). Root `CLAUDE.md` is the one deliberate agent file in the
  repo (shared instructions, scanned like any file).
- `npm run check:privacy` now runs check-secrets first, then the private-values check. CI
  (`.github/workflows/secret-scan.yml`) runs `check-secrets --history` on every push.

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
- `core/validate.ts` (range/date/type/source checks, `BadRequestError`) and `core/explorer.ts` (Data explorer test
  entry + delete), shared by the server routes and the browser seam. `Platform.off` says how to reach Open Food
  Facts: the server sends `User-Agent` to search-a-licious; the browser calls `cgi/search.pl` with `app_name` /
  `app_version` query params and no custom headers, so there is no CORS preflight (search-a-licious sends no CORS
  header, verified 2026-11-08). **OFF's legacy search fails ~50% of requests with a 503 that has no CORS header**,
  so the browser sees "Failed to fetch" (measured from Chrome 2026-11-09). `getJson` retries network errors and
  503/502/504: search 4 attempts (~94%), barcode 2.
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
- `src/`: React + Vite SPA.
  - `api.ts` is the seam: `backendMode` comes from `VITE_BACKEND` (default `browser`). Both `api.browser.ts`
    (core + platform in the page; maps core errors to the same `ApiError` status/`error` keys the server used)
    and `api.server.ts` (`/api` fetches; Vite proxies `/api` + `/auth` in server mode) implement `Api` in
    `apiTypes.ts`.
  - `browser/runtime.ts`: client ID (`health-tracker:client-id` in localStorage, else `VITE_GOOGLE_CLIENT_ID`),
    IndexedDB, GIS, `configurePlatform`, retry loop. `ensureSynced` pulls Drive settings once per account, waits at
    most 4 s, and is shared by concurrent callers. `login()` must call GIS synchronously inside the click.
  - `SettingsCard.tsx` + `settingsTransfer.ts`: Drive sync status, settings export/import (goals, layout,
    favorite templates; favorites deduplicated on import).
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
- **Tokens must carry only Google Health scopes (+ openid/email).** A token that also had `drive.appdata` got
  `403 Request contains disallowed OAuth scope(s)` on every Health call (live, 2026-11-08). The browser uses two
  GIS clients: Health and Drive (`storageName: "drive"`; connected by a separate click).
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
- Period model `src/dashboard/period.ts`: D/W/M/3M are **rolling windows ending on the anchor** (owner request
  2026-11-09): W = last 7 days, M = last 30, 3M = last 90; D shows its day with the 7 days ending on it for
  context. The latest day is always the last point on every chart. ‹ › move by the window length, never past
  today; titles "Last 7 days" / "Last 30 days" / "Last 90 days" or the window's dates. No "Y" (a year needs ~27
  heart-rate rollup requests). Today tab = always D; its second section is "Last 7 days". Tables list newest first.
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
  Today grid columns follow the **window** width (owner's breakpoints, 2026-11-08): 1 below 600px, 2 from 600,
  3 from 1100, 4 from 1500; rows 96px; `grid-auto-flow: row dense`; the ring card spans 3 rows. "This week"
  (`.mini-grid`) shares the same rule and gap, so both sections always have the same columns (owner request). Fitness (D) keeps its own square ring (`.day-hero`).
- Goals are editable inline (`src/ui/GoalEditor.tsx`) wherever a goal is shown; all dashboard views share one
  goals source (`goalsContext.tsx`, provided by DashboardShell), so an edit updates every chart immediately.
  Mini trend cards are buttons, so they get no inline editor (no nested buttons); edit from the tab instead.
- Sidebar is sticky (html/body use `overflow-x: clip`; `hidden` made them scroll containers and the sidebar
  scrolled away). It collapses to icons (wide screens; `health-tracker:rail-collapsed` in localStorage), via the Collapse
  button or a click on any empty sidebar space (not on a button). Main content max width 1475px (1180 + 25%), centered beside the sidebar.
- Body charts use `.dash-grid.two-up`: at most two across (each column ≥ half the row), so wide screens get two
  large charts. Food day view (`.food-day`): log column (meal filter + Refresh/Add food, add panel, meals) first,
  calories/macros summary (`.food-summary`, first row "Calories") below; 50/50 side by side from 1100px.
- Sleep quality card (`sleepQuality.ts`, after the owner's sample): time to sound sleep (session start → first
  deep), sound sleep (deep min), restlessness (awake spells < 5 min between onset and final wake), interruptions
  (spells ≥ 5 min: minutes + count). App-defined (Google publishes none) and stated on the card. D = that night,
  W/M/3M = average of the period's nights; vs the owner's last 30 nights; neutral pills like the stage benchmarks.
  All four bars share one minutes axis (end = 1.15 × largest value or usual-range edge), like the macro bars.
- Food: macro summary bars share one **gram** axis (track end = 1.15 × the largest goal or intake), so goals of
  different sizes sit at different points (owner request 2026-11-09; an earlier "relative" version aligned them). Carbs/Fat/Protein charts mirror the Calories eaten chart (goal line, average, "on target ±10%" days).
  "By meal" section (`src/food/meals.ts`, `api.food.entries(start, end)` → `core getEntries`): daily stacked by
  meal + average per meal with share, one metric switch (kcal/carbs/fat/protein). Entries without a meal
  (`ANYTIME`) are placed by time: 4–11 breakfast, 11–15 lunch, 17–21 dinner, else snack (said on the chart). Meal
  colors = `--series-1..4` (validated light/dark, adjacent stacked pairs pass CVD; light slots 3–4 < 3:1 → tables).
- Sleep schedule goals (2026-11-09): `bedtime` / `wakeTime` are optional clock goals (minutes after midnight,
  0–1439, `CLOCK_GOALS` / `OPTIONAL_GOALS` in shared/goals.ts). A night is on schedule when each set goal is within
  ±`SCHEDULE_TOLERANCE_MIN` (30, a display tolerance) (`checkSchedule` in src/dashboard/sleep.ts; bedtimes from noon
  on count as the evening before). Schedule chart: goal bands, check on on-schedule nights, early/late in the
  tooltip, "On schedule N of M nights" pill, `ScheduleGoalEditor` inline; night card sentence; Goals page fields.
- Macro charts use a target band (goal ± 10%) via `ColumnChart`'s `target` prop (`.viz-target`, goal-line tint,
  distinct from the green "typical range" band), with check badges for days inside it.
- `.viz-card-head` wraps: the title keeps ≥240px and the controls drop below when they don't fit.
- Grid items containing charts must size their column from the card (`minmax(0, 1fr)`), never from the SVG:
  an auto column sized to the chart made charts keep stale widths after a window resize.
- Pill-shaped bars (from the samples) instead of the dataviz 4px data-end; goal lines with check badges.
- `useWidth` uses a callback ref: charts swap between empty state and plot, and a once-only effect left
  some charts at width 0.

## Tests

- `npm test` = Vitest unit suite (`tests/unit/*.test.ts`); `npm run test:e2e` = Playwright (`tests/e2e/`,
  Chrome channel, Vite on 5174, browser mode). `tests/e2e/fakeBackend.ts` fakes the GIS script, userinfo, Google
  Health (stateful nutrition-log points), Drive appData and Open Food Facts in the browser. It seeds the client ID
  and session via `addInitScript`; settings live under the `todayLayout` / `goals` / `favorites` keys. Assert
  settings with `expect.poll` (Drive sync is debounced). Server mode has no e2e; its routes are unit-tested.
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
