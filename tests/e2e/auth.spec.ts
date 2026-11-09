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

test("first run: a new user sees starting goals and can keep them", async ({ page }) => {
  const fake = await fakeBackend(page, { driveEmpty: true });
  await page.goto("/#today");
  const card = page.getByRole("region", { name: "Set your goals" });
  await expect(card).toContainText("starts with general targets");
  await card.getByRole("button", { name: "Keep these" }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => fake.goals?.steps).toBe(10000); // saved to the new user's Drive
  await page.reload();
  await expect(page.getByRole("button", { name: "Customize" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Set your goals" })).toHaveCount(0);
});

test("a new browser offers to load goals from Drive instead of overwriting them with defaults", async ({ page }) => {
  const fake = await fakeBackend(page, { driveConnected: false, goals: { steps: 12345, activeZoneMinutes: 22, floors: 10, caloriesBurned: 2000, caloriesEaten: 2000, carbsG: 275, fatG: 78, proteinG: 50, exerciseDaysPerWeek: 5, sleepMinutes: null } });
  await page.goto("/#today");
  const card = page.getByRole("region", { name: "Bring your goals here" });
  await expect(card.getByRole("button", { name: "Keep these" })).toHaveCount(0);
  await card.getByRole("button", { name: "Connect Google Drive" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Fitness", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Goal 12,345 for Steps/ }).first()).toBeVisible();
  expect(fake.goals.steps).toBe(12345); // Drive copy untouched
});

test("a second Google account sees only its own data and settings", async ({ page }) => {
  const fake = await fakeBackend(page, {
    goals: { steps: 12345, activeZoneMinutes: 22, floors: 10, caloriesBurned: 2000, caloriesEaten: 2000, carbsG: 275, fatG: 78, proteinG: 50, exerciseDaysPerWeek: 5, sleepMinutes: null },
    entries: [{ id: "users/me/dataTypes/nutrition-log/dataPoints/1", timeLocal: `${new Date().toLocaleDateString("en-CA")}T08:00`, mealType: "BREAKFAST", displayName: "First person's oatmeal", kcal: 150, editable: true }],
  });
  await page.goto("/#food");
  await expect(page.locator(".entry-list")).toContainText("First person's oatmeal");

  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  fake.switchAccount("second.person@example.com");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();

  // Their own Drive: nothing there yet, so they're asked to connect it, then offered starting goals.
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("region", { name: "Bring your goals here" }).getByRole("button", { name: "Connect Google Drive" }).click();
  await expect(page.getByRole("region", { name: "Set your goals" })).toBeVisible();
  await page.getByRole("button", { name: "Fitness", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Goal 10,000 for Steps/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Food", exact: true }).click();
  await expect(page.getByText("First person's oatmeal")).toHaveCount(0);
  await expect(page.getByText("Nothing logged yet today")).toBeVisible();
  expect(fake.driveOf("tester@example.com").entries.goals!.value.steps).toBe(12345); // first account's Drive untouched
});

test("forget this device warns about unsent entries, then removes them", async ({ page }) => {
  const fake = await fakeBackend(page);
  fake.googleDown = true;
  await page.goto("/#food");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByRole("tab", { name: "Quick add" }).click();
  await page.getByLabel("Name").fill("Offline snack");
  await page.getByLabel("Calories (kcal)").fill("120");
  await page.getByRole("button", { name: "Log food" }).click();
  await expect(page.getByLabel("Entries waiting to sync")).toContainText("Offline snack");

  await page.getByRole("button", { name: "Account", exact: true }).click();
  let message = "";
  page.once("dialog", (d) => { message = d.message(); void d.accept(); });
  await page.getByRole("button", { name: "Forget this device" }).click();
  await expect(page.getByRole("heading", { name: "Connect Google Health" })).toBeVisible();
  expect(message).toContain("1 food entry hasn't reached Google Health yet and will be lost");

  fake.googleDown = false;
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await page.getByRole("button", { name: "Food", exact: true }).click();
  await expect(page.getByText("Nothing logged yet today")).toBeVisible();
  await expect(page.getByLabel("Entries waiting to sync")).toHaveCount(0);
});
