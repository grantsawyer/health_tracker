/**
 * Errors shared by every host (local server today, browser later). Hosts map
 * them to their own responses: HTTP status codes on the server, UI states in
 * the browser.
 */

/** No usable sign-in: never signed in, refresh rejected, or token revoked. */
export class ReauthRequiredError extends Error {
  constructor(message = "Google sign-in expired or was revoked") {
    super(message);
  }
}

/** The Google account hasn't been linked in the Google Health app. */
export class AccountNotLinkedError extends Error {
  constructor() {
    super("This Google account isn't linked to Google Health yet. Open the Google Health app on your phone, sign in, then retry.");
  }
}

/** Any other non-OK response from the Google Health API. */
export class HealthApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

/** Invalid input from the UI (shown to the user as-is). */
export class FoodInputError extends Error {}

/** The entry was written by another app, and the write scope only covers this app's own data. */
export class NotEditableError extends Error {
  constructor() {
    super("This entry was logged by another app, so Health Tracker can't change it. Edit it there instead.");
  }
}

/** Open Food Facts errors carry an HTTP-like status (400 input, 429 rate limit, 502/503 upstream). */
export class OffError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
