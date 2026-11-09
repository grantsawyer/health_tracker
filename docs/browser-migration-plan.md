# Migration plan: browser-only Health Tracker

**Status:** approved 2026-11-08 with the recommended options (Drive settings sync, GitHub Pages with a public repo,
keep the local server until phase 6). **Phases 1–2 done; phase 3 built** (awaiting the owner's
live sign-in test); phase 4 next. Scope additions from a review of
similar apps are in §12.
**Goal:** run without any server, local or hosted. The app is a static website (e.g. GitHub Pages) that talks
directly to Google Health from the browser. Each person who opens it signs in with their own Google account and
sees only their own data. Sharing works with Google's test-user list (up to 100 people), and anyone technical
can run their own copy with their own Google Cloud project.

## 1. What we verified before planning (2026-11-08)

| Question | Finding |
|---|---|
| Can a web page call the Google Health API directly (CORS)? | **Yes.** Preflight to `health.googleapis.com` returns `access-control-allow-origin: <origin>`, methods incl. POST/PATCH/DELETE, headers `authorization,content-type`. |
| Open Food Facts product lookup from a browser? | **Yes.** `world.openfoodfacts.org/api/v2/product/…` sends `access-control-allow-origin: *`. |
| Open Food Facts search from a browser? | `search.openfoodfacts.org` sends **no** CORS header, so browsers block it. The legacy `world.openfoodfacts.org/cgi/search.pl?json=1` **does** (`*`), so search switches to it. |
| Does Google expose the user's goals? | No (Settings has units only). Goals remain app data. |

## 2. Target architecture

```
Browser (static files on GitHub Pages)
 ├─ UI (unchanged React views)
 ├─ src/api.ts  ← the single seam: today it calls /api/*; it will call the core directly
 ├─ core/       ← logic moved out of server/: Google Health client, summary building, food rules,
 │                Open Food Facts client, retry queue, goals/layout/favorites validation
 ├─ platform/
 │   ├─ auth     Google Identity Services (GIS) token client: no client secret
 │   ├─ cache    IndexedDB (replaces cache.db)
 │   ├─ queue    IndexedDB (replaces pending_writes)
 │   └─ settings SettingsStore: Google Drive appDataFolder (synced) with local fallback
 └─ talks to: health.googleapis.com · www.googleapis.com/drive (app data) · openfoodfacts.org
```

No component ever sees another user's data: tokens, cache and settings all belong to the signed-in person, in their
browser or their own Drive.

## 3. Sign-in (replaces server OAuth)

- **Google Identity Services token model** (`google.accounts.oauth2.initTokenClient`), loaded from
  `accounts.google.com/gsi/client`. A browser can't keep a client secret, so there is **no refresh token**.
- Access tokens last about an hour. The app requests a new one shortly before expiry (`prompt: ''`), which is
  normally silent or a one-click "Continue as …" pop-up. Some browsers (Safari with strict tracking prevention)
  may need a click each time. Expect **about one sign-in click per browsing session**.
- The token is kept in memory (optionally `sessionStorage` so a reload within the hour doesn't ask again);
  never in localStorage.
- Email for "Signed in as" comes from `openid email` + the `oauth2/v3/userinfo` endpoint (the token model has
  no ID token).
- **Two tokens, two pop-ups.** The plan originally had one consent screen for everything, but the Google Health
  API rejects any token carrying a non-Health scope (`403 Request contains disallowed OAuth scope(s)`, seen live
  2026-11-08 with `drive.appdata` on the token). So the Health token has only the Health scopes plus openid/email.
  Drive gets its own token from a second GIS client, connected by its own click ("Connect Google Drive" on the
  Account page; browsers allow one pop-up per click). Until then settings sync shows as paused, and settings stay
  local. Stored tokens carrying foreign scopes are discarded.
- Sign-out revokes the token (`google.accounts.oauth2.revoke`) and clears that user's cached health data. Queued food
  entries and the local settings copy are kept (a removed queue entry is never sent); "Forget this device" removes
  them too, and the UI warns first when entries are still queued. *(Changed in phase 2; the original text cleared the
  queue on every sign-out.)*
- Partial consent stays handled: features whose scope wasn't granted show as unavailable (as today).

## 4. Client ID as configuration (sharing + run-your-own-copy)

The OAuth **client ID is not secret** in a browser app (only client secrets are), so it can be configured openly:

1. **Build-time default:** `VITE_GOOGLE_CLIENT_ID` in the GitHub Actions build. Your deployment ships with your ID,
   so friends you add as test users just open the link and sign in.
2. **Runtime override:** the setup screen keeps a "Use your own Google Cloud project" option that stores a client
   ID in that browser's localStorage. Someone who forks the repo (or just opens the site) can bring their own
   project, with no build step needed.
3. The existing setup wizard is adapted: the redirect-URI step becomes **"Authorized JavaScript origins"**
   (e.g. `https://<user>.github.io`), the client secret step is removed, and the JSON-file upload reads only the
   client ID.

Who can sign in, by mode:

| Mode | Who can use it | What's needed |
|---|---|---|
| Your deployment, Testing mode | You + up to 100 test users you list in Cloud Console | Add their Gmail under Audience → Test users |
| Run-your-own copy | Anyone, in their own Google Cloud project | Follow the setup screen with their own client ID |
| Public (anyone) | Everyone | Publish the OAuth app and pass Google verification (privacy policy, homepage, verified domain, review; over 100 users needs a third-party security assessment). **Out of scope for this plan.** |

Every user must have signed in to the Google Health phone app (otherwise `ACCOUNT_NOT_LINKED`; the existing message
stays).

## 5. Data that used to live on the server

| Data | Server today | Browser-only |
|---|---|---|
| OAuth tokens | `token.enc` (encrypted refresh token) | Memory / sessionStorage access token only |
| API response cache | `cache.db` (SQLite) | IndexedDB, same keys and TTL rules (5 min if the range includes today, else 24 h); cleared on sign-out |
| Goals, Today layout, favorites | `app.db` per user | **SettingsStore:** one small `settings.json` in the user's Google Drive **appDataFolder** (hidden, app-only, synced across devices), cached locally. Last write wins by `updatedAt`. If Drive is declined or offline, it falls back to local storage and syncs later. |
| Retry queue | `app.db` + 60 s background timer | IndexedDB; runs on page load, every 60 s while open, and on the browser's `online` event. **Retries only while the app is open** (a static site has no background process). Same fingerprint-based duplicate check. |
| Units, tab, period, sidebar | localStorage | unchanged |

**One-time import:** before the server is removed, add an "Export my settings" action to the current app (goals,
layout, favorites → JSON). The new app's Account page gets "Import settings" to load it into Drive.

## 6. Open Food Facts from the browser

- Product by barcode: unchanged endpoint (CORS ok).
- Search: switch to `world.openfoodfacts.org/cgi/search.pl?search_terms=…&json=1&fields=…` (CORS ok) and map its
  response to the existing `OffProduct` shape.
- Browsers can't set `User-Agent`. Open Food Facts' CORS policy allows `X-User-Agent`, so send
  `X-User-Agent: HealthTracker/<version>` (no email).
- Rate limits are per IP, so each user's browser has its own allowance. Keep the client-side limiter (10
  searches/min, 15 lookups/min) and caching (now in IndexedDB).

## 7. Generic defaults for new users

- The current default goals come from **your** screenshots. For everyone else, use neutral starting values and
  show a **"Set your goals" first-run card** on Today until goals are saved. Your existing goals carry over via the
  settings import.
- Remove anything specific to you from the build (e.g. the Open Food Facts contact string).

## 8. Hosting

- **GitHub Pages via a GitHub Actions workflow:** `npm ci → npm test → vite build → deploy`. Vite `base` is set to
  the repo path (`/health_tracker/`); the app already uses hash routing (`#today`), so no server rewrites are needed.
- **Repo visibility:** free GitHub Pages needs a **public** repo, which is fine since it contains no secrets.
  For a private repo, Pages needs a paid plan, or use Netlify / Cloudflare Pages (free).
- **Security headers via a `<meta>` Content-Security-Policy:**
  - scripts: self and `accounts.google.com/gsi/client`;
  - connections: `health.googleapis.com`, `www.googleapis.com`, `oauth2.googleapis.com` and `*.openfoodfacts.org`;
  - fonts: Google Fonts;
  - no inline scripts.

  This limits the impact of any injected content, since tokens live in the page.

## 9. Migration phases

Each phase keeps the app working and ends with a check you can try.

| # | Phase | Work | Done when |
|---|---|---|---|
| 1 ✅ | **Core extraction** | Move logic from `server/` into `core/` with injected `fetch` and storage interfaces (Google Health client, summary, food rules, OFF, goals/layout/favorites validation, retry queue). The local server calls `core/` so nothing changes for you yet. Unit tests move with it. | All existing unit tests pass against `core/`; app unchanged. |
| 2 ✅ | **Browser platform** | `platform/auth` (GIS), `platform/cache` + `platform/queue` (IndexedDB), `platform/settings` (Drive appData + local fallback). | New unit tests with fake GIS/Drive/IndexedDB pass. **Done 2026-11-08:** `platform/` (idb, cache, queue, drive, settings, auth, browserPlatform + `startRetryLoop`), 34 tests in `tests/unit/browserPlatform.test.ts`. Not wired into the UI yet (phase 3). |
| 3 🟡 | **Switch the seam** | `src/api.ts` calls `core/` + `platform/` directly instead of `/api/*`. Setup screen becomes client-ID + JavaScript-origin flow; sign-in button uses GIS. Settings export/import. | `npm run dev` works with **no Node server**; browser tests rewritten to mock Google/Drive/OFF endpoints pass. **Built 2026-11-08:** browser backend is the default (`src/api.browser.ts`, `src/browser/runtime.ts`); `npm run dev` is Vite only; server mode via `npm run dev:server-mode`. Settings export/import works in both modes. OFF search uses the legacy endpoint (verified: CORS `*`, frequent 503s, so one retry and a "scan the barcode" hint). 19 browser tests against fakes pass; a smoke test confirmed the real GIS script loads. **Owner to verify live** (see §13). |
| 4 | **Multi-user readiness** | Generic defaults + first-run goals card; runtime client-ID override; per-user cache isolation and clear-on-sign-out; docs for adding test users and running your own copy. | A second test account sees only its own data and its own settings. |
| 5 | **Hosting** | GitHub Actions deploy to Pages; CSP; add the Pages origin to the OAuth client. | The live URL works on Mac and phone. |
| 6 | **Retire the server** | Delete `server/`, `/api` proxy, SQLite, Node-only deps; update README/CLAUDE.md. | Repo is a static app; `~/.health_tracker` no longer used (kept on disk until you delete it). |

## 10. Trade-offs to accept

- **Sign-in:** expect about one click per browsing session. The local server's 7-day refresh token can't exist
  in a browser.
- **Retry queue:** retries only while the app is open, not in the background.
- **Data on the device:** cached health data sits in each browser's IndexedDB; it's cleared on sign-out.
- **Shared API quota:** all users share your Cloud project's quota. That's ample for a small group, but
  watch it if many people join.
- **Who can use it:** limited to test users, or people running their own copy, until Google verification.
- **Third-party script:** the app depends on Google's GIS script, the one allowed by the CSP.

## 11. Deliberately not doing

- **No hosted backend or serverless functions:** that would mean storing users' tokens on a third party,
  contrary to the "no server" goal.
- **No Chrome extension:** it would only run in desktop Chrome and add install steps.
- **No storing tokens in localStorage:** it's readable by any script on the page and persists indefinitely.
- **No Google verification:** separate effort, only if you decide to open the app to the public.

## 12. Scope additions (review of similar open-source apps, 2026-11-08)

Added after reviewing seven comparable projects (Pulseboard, Fitbit Health Explorer, DocStream Vitals,
Vitals Command Center, fettle, HealthLog, HealthQuery). Each item lands where it's cheapest; feature items (S1–S4)
come after phase 3 so they're built once, on the browser seam, rather than twice.

| # | Item | Why | Lands in | Status |
|---|---|---|---|---|
| S1 | **Recovery vitals:** `daily-heart-rate-variability`, `daily-oxygen-saturation`, `daily-respiratory-rate`, `daily-sleep-temperature-derivations` (nightly skin temperature), `daily-vo2-max`. Read with list + `.date` filter; show on Sleep/Body with the existing "typical range" (`baseline.ts`) and as Today cards. | Every comparable Google Health app shows them; our `health_metrics_and_measurements.readonly` scope already covers them, so no new consent. | After phase 3 | planned |
| S2 | **Trim BMR-only energy days:** keep `total-calories` only on days with device evidence (any steps, active minutes, heart rate or sleep). | Google fills total calories from basal metabolic rate on days without a device, so the history runs back before the tracker existed and inflates energy-balance views. | After phase 3 (core/summary) | planned |
| S3 | **Daily `.date` filter fallback:** if a daily-summary list returns zero rows while the same range has rollup data, retry once with the camelCase union name (`dailyRestingHeartRate.date`) and remember which style the account accepts. | We verified snake_case live, but HealthLog saw snake_case return 200 with zero rows on some accounts. Cheap insurance; stays in `core/healthClient.ts`. | With S1 | planned |
| S4 | **Connections:** predefined, interpretable pairs including food → next-day sleep / resting heart rate (our unique data). Pearson on ≥5 matched days, "tentative" under 8, lagged pairs labelled "next day", always described as association, never cause. | Others show lagged correlations; none can use nutrition. | After S1 | planned |
| S5 | **Incremental sync:** store per-day records in IndexedDB, refetch only the last 3 days (overlap catches late sleep/workouts) plus any gap; paint cached data first, then revalidate. | Cuts cold-load requests (rollup caps make long ranges expensive) and makes the app instant on reopen. Replaces range-keyed TTL entries for daily data. | After phase 3 (core/dataService + platform/cache) | planned |
| S6 | **Demo mode:** reuse `tests/e2e/mockApi.ts`'s synthetic data as a "Try the demo" mode with no sign-in. | A public demo for the Pages site, and screenshots that can never contain personal data. | Phase 5 | planned |
| S7 | **History-wide hygiene check in CI:** a GitHub Actions job that scans every commit for forbidden paths (`.env`, `*.db`, `samples/`, tokens) and credential signatures (`GOCSPX-`, `ya29.`, `1//`, private keys). | The repo becomes public in phase 5. `check:privacy` stays the local gate (its patterns live outside the repo); CI catches generic leaks. | Phase 5 (before the repo goes public) | planned |
| S8 | **Client ID in the bundle:** the browser build ships `VITE_GOOGLE_CLIENT_ID` in its JavaScript by design (it isn't secret). It comes from a GitHub Actions variable, never a committed file, so `check:privacy` keeps treating it as private in the repo. | Avoids a false "leak" alarm and documents the decision. | Phase 3/5 | decided |
| S9 | **Keep the raw `exerciseType`** when it doesn't map to a known activity, and show it instead of "Other". | Lossless; small. | After phase 3 | planned |

Considered and **not** added: device battery / last-sync status (needs a new `settings.readonly` scope); population
benchmarks and composite scores like "physio age" (conflict with the own-baseline design); a public owner dashboard;
an AI coach (possible later; if added, follow the safe pattern: the model only narrates numbers the app computed,
metric names are fixed lists, numbers in its text are checked against the data, and nothing the model can call
reaches tokens or settings).

## 13. Phase 2 notes (for phase 3)

- **Wiring:** `openDb()` → `createGisAuth({ clientId, scopes: browserScopes(driveSync), gis: loadGisScript })` →
  `createBrowserPlatform(...)` → `configurePlatform(bp.platform)`. Call `auth.load()` at startup so the Sign-in button
  can call `auth.signIn()` synchronously inside the click (GIS needs the click's pop-up permission). After sign-in, call
  `bp.afterSignIn()` (prunes the cache, pulls settings from Drive) and `startRetryLoop(processPendingWrites)`.
- **Retry queue scope:** in the browser `due()` returns only the signed-in user's rows, since that user's token is the
  only one available. The server version returns every user's due rows.
- **Settings merge:** goes key by key, and the newest `updatedAt` wins. `settings.status()` reports
  local / unavailable / error / synced for the Account page. `exportAll()` / `importAll()` back the settings export
  and import.
- **Open Food Facts:** `offUserAgent` is `HealthTracker/<version>`. Phase 3 must send it as `X-User-Agent`, because
  browsers drop `User-Agent` and core still sets it.
- **Silent renewal:** may be blocked outside a click. It gives up after 8 s and raises `ReauthRequiredError`, which the
  UI turns into a "Sign in" prompt. The email hint survives reloads, so the next sign-in targets the same account.

### Phase 3: what the owner needs to do to try it live

1. Google Cloud → Clients → your existing Health Tracker client → **Authorized JavaScript origins** → add
   `http://localhost:5173` → Save. (The redirect URI stays for server mode. The same client ID keeps entries you
   logged before editable.)
2. Enable the **Google Drive API** in the same project, and on **Data Access** add
   `https://www.googleapis.com/auth/drive.appdata`.
3. In server mode (`npm run dev:server-mode`), open Account → **Export settings**.
4. Stop it, run `npm run dev`, paste the client ID in the setup screen, sign in, then Account → **Import settings**.
5. Check: dashboards load, a food entry logs and edits, and Account shows "Synced with your Google Drive".

Notes for later phases:
- `npm start` serves whatever `dist/` holds. A default build is browser mode, so server-mode production needs
  `VITE_BACKEND=server npm run build`.
- Server mode has no browser tests any more; its routes are covered by unit tests until it's removed in phase 6.
- Fixed on the way: three server routes (favorite delete, pending discard, pending retry) returned `{}` because
  they didn't await async core calls (a phase 1 regression).
- GIS defaults `include_granted_scopes` to true; the browser sets it to false (same rule as the server's OAuth).

## 14. Decisions needed

1. **Settings sync:** Google Drive app data, synced across devices (recommended), or local-only per browser?
2. **Hosting:** GitHub Pages with the repo made public (recommended), or Netlify/Cloudflare Pages to keep it
   private?
3. **The local server during migration:** keep it until phase 6 (recommended), or retire it as soon as phase 3
   works?
