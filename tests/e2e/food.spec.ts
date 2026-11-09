import { expect, test } from "@playwright/test";
import { RICE, mockApi, today } from "./mockApi";

const at = (hhmm: string) => `${today()}T${hhmm}`;

test.afterEach(async ({ page }, info) => {
  // Every test must stay inside the mock.
  const state = (page as any).__mock;
  if (state) expect(state.unmocked, `unmocked requests in "${info.title}"`).toEqual([]);
});

test("quick add logs an entry with the right request and shows it in the day", async ({ page }) => {
  const mock = await mockApi(page);
  (page as any).__mock = mock;
  await page.goto("/#food");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByRole("tab", { name: "Quick add" }).click();
  await page.getByLabel("Name").fill("Turkey sandwich");
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByLabel("Carbs (g)").fill("40");
  await page.getByLabel("Fat (g)").fill("12");
  await expect(page.getByText("Macros add up to about 388 kcal.")).toBeVisible();
  await page.getByRole("button", { name: "Use that" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("388");
  await page.getByLabel("Meal").selectOption("LUNCH");
  await page.getByLabel("Time").fill("12:30");
  await page.getByRole("button", { name: "Log food" }).click();

  await expect(page.locator(".entry-list")).toContainText("Turkey sandwich");
  await expect(page.locator(".meal-name").first()).toHaveText("Lunch");
  const create = mock.requests.find((r) => r.path === "/api/food/entries" && r.method === "POST")!;
  expect(create.body).toMatchObject({ kind: "quick", displayName: "Turkey sandwich", kcal: 388, proteinG: 30, carbsG: 40, fatG: 12, mealType: "LUNCH", timeLocal: at("12:30") });
  expect(typeof create.body.utcOffsetSeconds).toBe("number");
});

test("own entries can be edited and deleted; other apps' entries are read-only", async ({ page }) => {
  const mock = await mockApi(page, {
    entries: [
      { id: "users/me/dataTypes/nutrition-log/dataPoints/1", timeLocal: at("08:00"), mealType: "BREAKFAST", displayName: "Oatmeal", kcal: 150, editable: true, source: "Health Tracker" },
      { id: "users/me/dataTypes/nutrition-log/dataPoints/2", timeLocal: at("09:00"), mealType: "BREAKFAST", displayName: "Green tea", kcal: 5, editable: false, source: "Fitbit" },
    ],
  });
  (page as any).__mock = mock;
  await page.goto("/#food");
  const oatmeal = page.locator(".entry-list li", { hasText: "Oatmeal" });
  const tea = page.locator(".entry-list li", { hasText: "Green tea" });
  await expect(tea).toContainText("Read-only");
  await expect(tea.getByRole("button")).toHaveCount(0);

  await oatmeal.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText("Google can't edit quick-add entries in place")).toBeVisible();
  await page.getByLabel("Calories (kcal)").fill("180");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".entry-list li", { hasText: "Oatmeal" })).toContainText("180 kcal");
  const update = mock.requests.find((r) => r.path === "/api/food/entries/update")!;
  expect(update.body).toMatchObject({ id: "users/me/dataTypes/nutrition-log/dataPoints/1", entry: { kind: "quick", displayName: "Oatmeal", kcal: 180, mealType: "BREAKFAST", timeLocal: at("08:00") } });

  page.once("dialog", (d) => d.accept());
  await page.locator(".entry-list li", { hasText: "Oatmeal" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".entry-list li", { hasText: "Oatmeal" })).toHaveCount(0);
  await expect(page.locator(".entry-list li", { hasText: "Green tea" })).toHaveCount(1);
});

test("library foods log by amount and unit with a live estimate", async ({ page }) => {
  const mock = await mockApi(page);
  (page as any).__mock = mock;
  await page.goto("/#food");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByRole("tab", { name: "My foods" }).click();
  await page.getByPlaceholder("Search your foods").fill("ric");
  await page.getByRole("button", { name: /Rice/ }).click();
  await page.getByLabel("Amount").fill("3");
  await expect(page.locator(".food-estimate")).toContainText("120 kcal");
  await page.getByRole("button", { name: "Log food" }).click();
  await expect(page.locator(".entry-list")).toContainText("Rice");
  const create = mock.requests.find((r) => r.path === "/api/food/entries")!;
  expect(create.body).toMatchObject({ kind: "food", food: RICE.name, unit: RICE.defaultServing.unit, amount: 3 });
});

test("Open Food Facts search scales nutrition and logs a quick add", async ({ page }) => {
  const mock = await mockApi(page);
  (page as any).__mock = mock;
  await page.goto("/#food");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByRole("tab", { name: "Search" }).click();
  await page.getByLabel("Search Open Food Facts").fill("chobani greek yogurt");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /Greek Yogurt/ }).click();
  // The pick fetches the full product (servings) before showing the form.
  await expect(page.getByRole("combobox", { name: "Unit", exact: true })).toHaveValue("serving");
  await expect(page.locator(".food-estimate")).toContainText("110 kcal");
  await page.getByLabel("Amount").fill("2");
  await expect(page.locator(".food-estimate")).toContainText("220 kcal");
  await page.getByRole("button", { name: "Log food" }).click();
  await expect(page.locator(".entry-list")).toContainText("Greek Yogurt (Chobani), 2 servings (150 g)");
  const create = mock.requests.find((r) => r.path === "/api/food/entries")!;
  expect(create.body).toMatchObject({ kind: "quick", kcal: 220, proteinG: 24, carbsG: 32 });
  expect(mock.requests.some((r) => r.path === "/api/off/product")).toBe(true);
});

test("saving a favorite makes the panel open on Favorites next time", async ({ page }) => {
  const mock = await mockApi(page);
  (page as any).__mock = mock;
  await page.goto("/#food");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByRole("button", { name: /Hummus/ }).click(); // from Recent
  await page.getByRole("button", { name: "☆ Save as favorite" }).click();
  await expect(page.getByRole("button", { name: "★ Saved to favorites" })).toBeVisible();
  expect(mock.favorites[0]!.template).toMatchObject({ kind: "quick", displayName: "Hummus", kcal: 70 });

  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Favorites" })).toHaveAttribute("aria-selected", "true");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove Hummus from favorites" }).click();
  await expect.poll(() => mock.favorites.length).toBe(0);
});

test("when Google is down the entry is queued and shown as waiting to sync", async ({ page }) => {
  const mock = await mockApi(page, { googleDown: true });
  (page as any).__mock = mock;
  await page.goto("/#food");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByRole("tab", { name: "Quick add" }).click();
  await page.getByLabel("Name").fill("Offline snack");
  await page.getByLabel("Calories (kcal)").fill("120");
  await page.getByRole("button", { name: "Log food" }).click();

  await expect(page.locator(".banner-ok")).toContainText("was saved on this computer. It will sync automatically.");
  const banner = page.getByLabel("Entries waiting to sync");
  await expect(banner).toContainText("1 entry waiting to sync to Google Health");
  await expect(banner).toContainText("Offline snack");
  page.once("dialog", (d) => d.accept());
  await banner.getByRole("button", { name: "Discard" }).click();
  await expect(banner).toHaveCount(0);
});

test("meal cards collapse, and chips filter by meal", async ({ page }) => {
  const mock = await mockApi(page, {
    entries: [
      { id: "users/me/dataTypes/nutrition-log/dataPoints/1", timeLocal: at("08:00"), mealType: "BREAKFAST", displayName: "Oatmeal", kcal: 150, editable: true, source: "Health Tracker" },
      { id: "users/me/dataTypes/nutrition-log/dataPoints/2", timeLocal: at("19:00"), mealType: "DINNER", displayName: "Salmon", kcal: 400, editable: true, source: "Health Tracker" },
    ],
  });
  (page as any).__mock = mock;
  await page.goto("/#food");
  const breakfast = page.getByRole("button", { name: /Breakfast\s*1 item/ });
  await expect(breakfast).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".entry-list")).toContainText(["Oatmeal", "Salmon"]);
  await breakfast.click();
  await expect(breakfast).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Oatmeal")).toHaveCount(0);

  await page.getByRole("button", { name: "Dinner", exact: true }).click();
  await expect(page.locator(".meal-card")).toHaveCount(1);
  await expect(page.locator(".meal-name")).toHaveText("Dinner");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator(".meal-card")).toHaveCount(2);
});
