import { expect, test } from "@playwright/test";
import { fakeBackend } from "./fakeBackend";

test("Try the demo: synthetic dashboards and food log with no Google calls, then Exit demo", async ({ page }) => {
  const fake = await fakeBackend(page, { start: "notConfigured" });
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo" }).click();

  await expect(page).toHaveURL(/\?demo#today$/);
  await expect(page.getByRole("status").filter({ hasText: "Demo data." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
  await expect(page.getByRole("button", { name: /^Steps, last 7 days: [\d,]+/ })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Sections" });
  await nav.getByRole("button", { name: "Sleep", exact: true }).click();
  await expect(page.getByText(/On schedule \d+ of \d+ nights/).first()).toBeVisible();

  await nav.getByRole("button", { name: "Food", exact: true }).click();
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await expect(page.getByRole("region", { name: "Add food" })).toBeVisible();

  // Reloading keeps the demo; Exit demo returns to the real app's setup.
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Demo data." })).toBeVisible();
  await page.getByRole("button", { name: "Exit demo" }).click();
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Demo data." })).toHaveCount(0);

  expect(fake.requests.filter((r) => /googleapis\.com|openfoodfacts/.test(r.url.host))).toEqual([]);
  expect(fake.unmocked).toEqual([]);
});

test("the sign-in screen offers the demo too", async ({ page }) => {
  await fakeBackend(page, { start: "signedOut" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
});
