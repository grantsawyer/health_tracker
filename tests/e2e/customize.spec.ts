import { expect, test } from "@playwright/test";
import { mockApi } from "./mockApi";

const tileLabels = (page: import("@playwright/test").Page) => page.locator(".today-grid .tile-label").allTextContents();
const weekTitles = (page: import("@playwright/test").Page) => page.locator(".mini-grid .mini-title").allTextContents();

test("customize: remove, reorder, add cards, then save", async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto("/#today");
  await expect.poll(() => tileLabels(page)).toEqual(["Heart rate", "Sleep", "Calories eaten"]);

  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Remove Heart rate from Today" }).click();
  await page.getByRole("button", { name: "Move Sleep later in Today" }).click();
  await expect.poll(() => tileLabels(page)).toEqual(["Calories eaten", "Sleep"]);

  // Add a tile from the picker (Today section's add slot is first on the page).
  await page.locator(".today-grid .board-add").click();
  const picker = page.getByRole("region", { name: "Add a card to Today" });
  await picker.getByRole("button", { name: /^Distance/ }).click();
  await expect.poll(() => tileLabels(page)).toEqual(["Calories eaten", "Sleep", "Distance"]);

  // Add a week card too.
  await page.locator(".mini-grid .board-add").click();
  await page.getByRole("region", { name: "Add a card to This week" }).getByRole("button", { name: /^Weight/ }).click();

  // Nothing is saved until Done.
  expect(mock.requests.filter((r) => r.path === "/api/layout" && r.method === "POST")).toHaveLength(0);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Customize" })).toBeVisible();
  expect(mock.layout).toEqual({ today: ["caloriesEaten", "sleep", "distance"], week: ["steps", "sleep", "weight"] });
  await expect.poll(() => weekTitles(page)).toEqual(["Steps", "Sleep", "Weight"]);

  // Persisted: a reload shows the saved layout.
  await page.reload();
  await expect.poll(() => tileLabels(page)).toEqual(["Calories eaten", "Sleep", "Distance"]);
  expect(mock.unmocked).toEqual([]);
});

test("customize: cancel discards changes, and a full section offers no more spaces", async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto("/#today");
  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Remove Sleep from Today" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => tileLabels(page)).toEqual(["Heart rate", "Sleep", "Calories eaten"]);

  await page.getByRole("button", { name: "Customize" }).click();
  await page.locator(".today-grid .board-add").click();
  const picker = page.getByRole("region", { name: "Add a card to Today" });
  // Fill the remaining 9 of 12 slots; the ring (3 slots) is offered while it fits.
  await picker.getByRole("button", { name: /^Steps ring \(3 spaces\)/ }).click();
  for (let i = 0; i < 6; i++) await picker.locator(".picker-option:not([disabled])").first().click();
  await expect(page.locator(".today-grid .board-add")).toHaveCount(0);
  await expect(page.getByText("Today is full (12 spaces)")).toBeVisible();
  expect(mock.requests.filter((r) => r.path === "/api/layout" && r.method === "POST")).toHaveLength(0);
});

test("dragging a card onto another moves it there", async ({ page }) => {
  await mockApi(page);
  await page.goto("/#today");
  await page.getByRole("button", { name: "Customize" }).click();
  const items = page.locator(".today-grid .board-item");
  await items.nth(2).dragTo(items.nth(0));
  await expect.poll(() => tileLabels(page)).toEqual(["Calories eaten", "Heart rate", "Sleep"]);
});

test("the ring can't be added when fewer than 3 spaces are free", async ({ page }) => {
  await mockApi(page, { layout: { today: ["heartRate", "sleep", "caloriesEaten", "caloriesBurned", "carbs", "protein", "fat", "fiber", "weight", "floors"], week: [] } });
  await page.goto("/#today");
  await page.getByRole("button", { name: "Customize" }).click();
  await page.locator(".today-grid .board-add").click();
  const ring = page.getByRole("region", { name: "Add a card to Today" }).getByRole("button", { name: /^Steps ring/ });
  await expect(ring).toBeDisabled();
  await expect(ring).toContainText("Needs 3 free spaces");
});
