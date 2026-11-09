import { expect, test } from "@playwright/test";
import { ALL_SCOPES, CLIENT_ID, fakeBackend, type Fake } from "./fakeBackend";

/** Sign-in and setup without a server: GIS in the page, settings from Drive. */

const tileLabels = (page: import("@playwright/test").Page) => page.locator(".today-grid .tile-label").allTextContents();

test.afterEach(async ({ page }, info) => {
  const fake = (page as unknown as { __fake?: Fake }).__fake;
  if (fake) expect(fake.unmocked, `unmocked requests in "${info.title}"`).toEqual([]);
});

test("first run: setup asks only for a client ID and shows the JavaScript origin to register", async ({ page }) => {
  await fakeBackend(page, { start: "notConfigured" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect to Google Health" })).toBeVisible();
  await expect(page.locator(".copy-block pre", { hasText: "http://localhost:5174" })).toBeVisible();
  await expect(page.getByLabel("Client secret")).toHaveCount(0);

  await page.getByLabel("Client ID").fill("not a client id");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("That doesn't look like a Client ID")).toBeVisible();

  await page.getByLabel("Client ID").fill(CLIENT_ID);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Connect Google Health" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("health-tracker:client-id"))).toBe(CLIENT_ID);

  // The sign-in card shows what Google checks, for "Access blocked" errors.
  await page.getByText("Google says “Access blocked”?").click();
  await expect(page.locator(".signin-help dd").nth(0)).toHaveText("http://localhost:5174");
  await expect(page.locator(".signin-help dd").nth(1)).toHaveText(CLIENT_ID);

  // Going back to setup shows the saved client ID, ready to check or change.
  await page.getByRole("button", { name: "Change Google credentials" }).click();
  await expect(page.getByLabel("Client ID")).toHaveValue(CLIENT_ID);
});

test("sign in with Google, then connect Drive (its own click) and settings come from Drive", async ({ page }) => {
  const fake = await fakeBackend(page, { start: "signedOut", layout: { today: ["sleep", "steps"], week: ["steps"] } });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  // Google Health rejects tokens with other scopes, so Drive has its own sign-in, from the Account page.
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Connect Google Drive to sync" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Google Drive" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Synced with your Google Drive" })).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect.poll(() => tileLabels(page)).toEqual(["Sleep", "Steps"]);
  expect(fake.requests.some((r) => r.url.pathname === "/oauth2/v3/userinfo")).toBe(true);
  // The access token is kept for this tab only, never in localStorage.
  const stored = await page.evaluate(() => ({ session: Object.keys(sessionStorage).some((k) => k.startsWith("health-tracker:session:")), local: JSON.stringify(localStorage) }));
  expect(stored.session).toBe(true);
  expect(stored.local).not.toContain("ya29.");
});

test("sign out revokes the token and returns to the sign-in card", async ({ page }) => {
  await fakeBackend(page);
  await page.goto("/#connection");
  await expect(page.getByRole("heading", { name: /Connected/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Synced with your Google Drive" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Connect Google Health" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __revoked?: string[] }).__revoked)).toEqual(["ya29.e2e-drive-seeded", "ya29.e2e-seeded"]);
});

test("declining Drive keeps settings in this browser and says so", async ({ page }) => {
  await fakeBackend(page, { scopes: ALL_SCOPES.filter((s) => !s.endsWith("/drive.appdata")) });
  await page.goto("/#connection");
  await page.getByRole("button", { name: "Connect Google Drive" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved in this browser only" })).toBeVisible();
});
