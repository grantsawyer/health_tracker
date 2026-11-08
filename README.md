# Health Tracker

A personal, local-only browser app for viewing Google Health data (fitness, sleep, nutrition, body
metrics) and logging food entries back to Google Health.

It talks to the **Google Health API** (`health.googleapis.com/v4`), the successor to the Fitbit Web
API and the retiring Google Fit REST API.

```
Browser (React SPA)  ──/api/*──▶  Local Node server (Hono)  ──OAuth + REST──▶  health.googleapis.com
                                   holds client secret + refresh token
```

The server binds to `127.0.0.1` only. Secrets, tokens, and cached data live in
`~/.health_tracker/` (override with `HEALTH_TRACKER_HOME`), never in this repo.

## Google Cloud setup (one time)

Google requires every app that reads Google Health data to be registered in Google Cloud. It's
free, and it hosts and stores nothing. It just issues the app's OAuth credentials.

**Easiest: use the in-app setup.** Run `npm run dev`, open <http://localhost:5173>, and follow the
steps. Each step links to the right Console page, has copy buttons for the exact values (scopes,
redirect URI), and ends with a form where you upload the client JSON or paste the client ID and
secret. The app saves them to `~/.health_tracker/.env` (0600) itself.

The steps, for reference:

1. **Link your account:** sign in to the Google Health phone app (else `ACCOUNT_NOT_LINKED`).
2. **Create a project:** <https://console.cloud.google.com/projectcreate>
3. **Enable the API:** “Google Health API” (`health.googleapis.com`).
4. **Consent screen:** Google Auth Platform → Get started; Audience **External**.
5. **Test users:** Audience page, status **Testing**, add your Google account.
6. **Scopes:** Data Access → Add or remove scopes → Manually add the `googlehealth.*` scopes
   (`activity_and_fitness.readonly`, `sleep.readonly`, `nutrition.readonly`,
   `nutrition.writeonly`, `health_metrics_and_measurements.readonly`, `profile.readonly`).
7. **OAuth client:** Clients → Create client → **Web application**, redirect URI
   `http://localhost:8787/auth/callback` (match `PORT` if you change it). Download the JSON.
8. **Give the credentials to the app:** in-app setup form, or manually:
   ```sh
   cp .env.example ~/.health_tracker/.env && chmod 600 ~/.health_tracker/.env
   # then edit it and fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and restart the server
   ```

> **Weekly sign-in:** while the OAuth app is in Testing mode, Google expires refresh tokens after
> 7 days. The app detects this and shows a “Sign in again” button. Removing that limit requires
> publishing the app, which for these scopes means Google's verification process. Not worth it for
> a single-user personal tool.

## Running

```sh
npm install
npm run dev        # server on :8787 + Vite on http://localhost:5173 (open this one)
```

Production-style (single process, serves the built app):

```sh
npm run build
npm start          # http://localhost:8787
```

## Files in `~/.health_tracker/`

| File | Contents |
|---|---|
| `.env` | Google OAuth client ID and secret, optional `PORT` |
| `token.enc` | OAuth tokens, AES-256-GCM encrypted (0600) |
| `token.key` | Encryption key for `token.enc` (0600) |
| `cache.db` | SQLite cache of API responses (safe to delete) |
| `app.db` | Favorites and entries waiting to sync to Google (keep this one) |

The encryption keeps the refresh token from sitting in plain text if `token.enc` alone gets copied
or backed up. It does **not** protect against someone who can read your user account's files, since
the key sits next to it.

To fully disconnect: click **Sign out** (revokes the token at Google), or delete `token.enc`.

## Security notes

- The server rejects requests whose `Host` isn't `localhost`/`127.0.0.1` (DNS-rebinding guard) and
  state-changing requests from any other `Origin` (CSRF guard).
- OAuth uses `state` + PKCE (S256). `include_granted_scopes` is deliberately **not** sent: it has
  been reported to break tokens for accounts that previously consented to legacy Google Fit scopes.
- Write scopes (`*.writeonly`) let the app add data and edit/delete only data **it** created. They
  grant no read access.
