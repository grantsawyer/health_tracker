# Health Tracker

A personal browser app for viewing Google Health data (fitness, sleep, nutrition, body
metrics) and logging food entries back to Google Health.

It talks to the **Google Health API** (`health.googleapis.com/v4`), the successor to the Fitbit Web
API and the retiring Google Fit REST API.

```
Browser (static React app) ──GIS sign-in, REST──▶ health.googleapis.com
   core/ + platform/        ──Drive appData────▶ www.googleapis.com (your goals, layout, favorites)
   IndexedDB cache + queue  ──food search─────▶ world.openfoodfacts.org
```

**No server.** The app is static files: your browser signs in with Google Identity Services (a
client ID only, no secret) and calls Google directly. The access token lives in the tab's
`sessionStorage` for about an hour; cached data and queued food entries live in the browser's
IndexedDB; settings sync through a hidden file in your own Google Drive (`drive.appdata`, which can't
see your other files). See `docs/browser-migration-plan.md`.

The old **local server** (Node + Hono, client secret + 7-day refresh token in `~/.health_tracker/`)
still works as a fallback until migration phase 6: `npm run dev:server-mode`.

## Google Cloud setup (one time)

Google requires every app that reads Google Health data to be registered in Google Cloud. It's
free, and it hosts and stores nothing. It just issues the app's OAuth client ID.

**Easiest: use the in-app setup.** Run `npm run dev`, open <http://localhost:5173>, and follow the
steps. Each step links to the right Console page and has copy buttons for the exact values (scopes,
JavaScript origin). It ends with a form where you paste the client ID (or choose the client JSON).
The client ID is saved in that browser; it isn't secret.

The steps, for reference:

1. **Link your account:** sign in to the Google Health phone app (else `ACCOUNT_NOT_LINKED`).
2. **Create a project:** <https://console.cloud.google.com/projectcreate>
3. **Enable the APIs:** “Google Health API” (`health.googleapis.com`), and “Google Drive API” for
   settings sync (optional; without it settings stay in one browser).
4. **Consent screen:** Google Auth Platform → Get started; Audience **External**.
5. **Test users:** Audience page, status **Testing**, add your Google account.
6. **Scopes:** Data Access → Add or remove scopes → Manually add the `googlehealth.*` scopes
   (`activity_and_fitness.readonly`, `sleep.readonly`, `nutrition.readonly`,
   `nutrition.writeonly`, `health_metrics_and_measurements.readonly`, `profile.readonly`) and
   `https://www.googleapis.com/auth/drive.appdata`.
7. **OAuth client:** Clients → Create client → **Web application**. Under **Authorized JavaScript
   origins** add `http://localhost:5173` (and later your hosted URL). No redirect URI is needed.
   *Already have a client from the server version?* Add the origin to it: the same client ID keeps
   your earlier entries editable.
8. **Give the client ID to the app:** the in-app setup form.

> **Sign-in:** a browser can't hold a refresh token, so Google sign-in lasts about an hour. Expect a
> one-click “Continue” about once per visit. (Server mode keeps a 7-day refresh token instead.)
> Settings sync needs a second, separate Google sign-in for Drive (Account → **Connect Google Drive**):
> Google Health rejects tokens that carry any other scope, so the two can't share one.

## Sharing it with other people

Each person signs in with their own Google account and sees only their own data. Their cached data lives in
their browser, and their goals, layout and favorites in their own Google Drive. Nothing passes through you.

**Let people use your copy (up to 100 people).** While your OAuth app is in Testing mode, Google only lets listed
test users sign in:

1. Google Cloud console → **Google Auth Platform → Audience** → under **Test users**, click **Add users** and
   enter their Google email.
2. Send them the app's address. If they get "Access blocked" or "has not completed the Google verification
   process", they aren't on the list yet.
3. Each person must have signed in to the **Google Health** phone app once, or they'll see "account not linked".

All test users share your Cloud project's API quota, which is plenty for a small group. Opening it to anyone
requires Google's verification (privacy policy, verified domain, review). That's out of scope for this project.

**Run your own copy.** Anyone can use their own Google Cloud project instead of yours: open the app, choose
**Change Google credentials** on the Account page (or the first-run setup), and follow the steps with your own
client ID. It's saved in that browser only. To host your own build, set `VITE_GOOGLE_CLIENT_ID` when building, and
add the hosting address under **Authorized JavaScript origins**.

**On a shared computer**, use **Account → Forget this device** instead of Sign out. It also removes the
browser's copy of your settings and any food entries that haven't reached Google Health yet (it warns first).

## Running

```sh
npm install
npm run dev              # http://localhost:5173, no server
npm run build            # static files in dist/ (host anywhere; phase 5 adds GitHub Pages)
```

Server mode (fallback until phase 6; uses `~/.health_tracker/.env` with a client secret and the
redirect URI `http://localhost:8787/auth/callback`):

```sh
npm run dev:server-mode  # server on :8787 + Vite on http://localhost:5173
VITE_BACKEND=server npm run build && npm start   # single process on http://localhost:8787
```

Moving settings between the two: **Account → Your settings → Export settings** in one, **Import
settings** in the other (goals, Today layout, favorites; no health data).

## Tests

```sh
npm test            # unit tests (Vitest), ~1 s, no network
npm run test:e2e    # browser tests (Playwright, uses your installed Chrome), ~15 s
npm run test:all    # both
```

- **Unit tests** (`tests/unit/`) exercise core/, the browser platform (fake GIS, fake Drive,
  fake-indexeddb) and the server, against a strict fake of Google Health, Google OAuth and Open Food
  Facts: any request a test didn't expect fails it, so nothing reaches the real network. Each test
  file gets its own temporary `HEALTH_TRACKER_HOME`, so your real `~/.health_tracker` is never touched.
- **Browser tests** (`tests/e2e/`) run the real serverless app on port 5174 against in-browser fakes of
  Google sign-in, Google Health, Drive and Open Food Facts (`tests/e2e/fakeBackend.ts`), so they never
  touch your Google data.
- Test data copies the shape of real Google responses with made-up values.

## Keeping personal data out of the repo

**A pre-commit hook checks every commit automatically.** `npm install` turns it on for the clone
(`npm run hooks:install` does the same). It runs on the staged content and blocks the commit if it finds:
- a coding-agent folder or settings file (`.claude/`, `.cursor/`, `.gemini/`, `.specstory/`, `.mcp.json`, …). Claude
  Code's "Yes, and don't ask again" saves full commands, secrets included, to `.claude/settings.local.json`;
- anything that looks like a credential, including passwords inside commands (`PGPASSWORD=…`, bearer headers,
  `user:pass@` URLs). Pass secrets as `$VAR` instead;
- one of your private values (below).

To run the same checks on the whole working tree, or on every commit ever made:

```sh
npm run check:privacy           # check-secrets + private values, working tree
npm run check:secrets:history   # every commit (also runs in GitHub Actions on each push)
```

The private-values check fails if any tracked or new file contains a private value. The values are listed in
`~/.health_tracker/private-patterns.txt` (one literal per line; kept outside the repo so the list itself is
never published); your real OAuth client ID and secret are added from `~/.health_tracker/.env` automatically.
Add new personal values to that file whenever you notice them (e.g. a new food name or measurement).

Rules that the check can't enforce:
- Tests and fixtures use synthetic values only, never values copied from a real account.
- Default goals are generic published references, never anyone's personal targets.
- Screenshots of the real app stay in `samples/` (gitignored).
- Commits use the GitHub noreply email (this repo's local `git config user.email`), not a personal address.

## Files in `~/.health_tracker/` (server mode only)

| File | Contents |
|---|---|
| `.env` | Google OAuth client ID and secret, optional `PORT` |
| `token.enc` | OAuth tokens, AES-256-GCM encrypted (0600) |
| `token.key` | Encryption key for `token.enc` (0600) |
| `cache.db` | SQLite cache of API responses (safe to delete) |
| `app.db` | Goals, Today layout, favorites, and entries waiting to sync to Google (keep this one) |
| `private-patterns.txt` | Your personal values for `npm run check:privacy` (never commit) |

The encryption keeps the refresh token from sitting in plain text if `token.enc` alone gets copied
or backed up. It does **not** protect against someone who can read your user account's files, since
the key sits next to it.

To fully disconnect: click **Sign out** (revokes the token at Google), or delete `token.enc`.

## Security notes

- Browser mode: no client secret exists; the access token (about an hour) is kept in memory and the
  tab's `sessionStorage`, never `localStorage`. Sign-out revokes it at Google and clears cached health
  data; queued food entries stay until sent or discarded. The browser retries queued entries only while
  the app is open.
- Server mode: the server rejects requests whose `Host` isn't `localhost`/`127.0.0.1` (DNS-rebinding
  guard) and state-changing requests from any other `Origin` (CSRF guard). Its OAuth flow uses
  `state` + PKCE (S256).
- `include_granted_scopes` is deliberately **not** sent (either mode): it has been reported to break
  tokens for accounts that previously consented to legacy Google Fit scopes.
- Write scopes (`*.writeonly`) let the app add data and edit/delete only data **it** created. They
  grant no read access.
