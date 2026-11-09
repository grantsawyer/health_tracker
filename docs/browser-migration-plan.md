# Migration plan: browser-only Health Tracker

**Status:** approved 2026-11-08 with the recommended options (Drive settings sync, GitHub Pages with a public repo,
keep the local server until phase 6). **Phase 1 done**; phase 2 next.
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
- **One consent screen** covers everything: the Google Health scopes, plus `drive.appdata` if settings sync is
  on. Drive is not a separate sign-in.
- Sign-out revokes the token (`google.accounts.oauth2.revoke`) and clears that browser's cache and queue.
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
| 2 | **Browser platform** | `platform/auth` (GIS), `platform/cache` + `platform/queue` (IndexedDB), `platform/settings` (Drive appData + local fallback). | New unit tests with fake GIS/Drive/IndexedDB pass. |
| 3 | **Switch the seam** | `src/api.ts` calls `core/` + `platform/` directly instead of `/api/*`. Setup screen becomes client-ID + JavaScript-origin flow; sign-in button uses GIS. Settings export/import. | `npm run dev` works with **no Node server**; browser tests rewritten to mock Google/Drive/OFF endpoints pass. |
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

## 12. Decisions needed

1. **Settings sync:** Google Drive app data, synced across devices (recommended), or local-only per browser?
2. **Hosting:** GitHub Pages with the repo made public (recommended), or Netlify/Cloudflare Pages to keep it
   private?
3. **The local server during migration:** keep it until phase 6 (recommended), or retire it as soon as phase 3
   works?
