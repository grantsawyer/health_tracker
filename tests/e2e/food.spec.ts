import { expect, test } from "@playwright/test";
import { RICE, YOGURT, fakeBackend, today, type Fake } from "./fakeBackend";

const at = (hhmm: string) => `${today()}T${hhmm}`;
const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
};

test.afterEach(async ({ page }, info) => {
  // Every test must stay inside the fakes.
  const fake = (page as unknown as { __fake?: Fake }).__fake;
  if (fake) expect(fake.unmocked, `unmocked requests in "${info.title}"`).toEqual([]);
});

test("quick add sends the right nutrition log to Google and shows it in the day", async ({ page }) => {
  const fake = await fakeBackend(page);
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
  await page.getByRole("combobox", { name: /^Meal/ }).selectOption("LUNCH");
  await page.getByLabel("Time").fill("12:30");
  await page.getByRole("button", { name: "Log food" }).click();

  await expect(page.locator(".entry-list")).toContainText("Turkey sandwich");
  await expect(page.locator(".meal-name").first()).toHaveText("Lunch");
  const [create] = fake.creates();
  expect(create).toMatchObject({ foodDisplayName: "Turkey sandwich", energy: { kcal: 388 }, totalCarbohydrate: { grams: 40 }, totalFat: { grams: 12 }, mealType: "LUNCH" });
  expect(create.nutrients).toContainEqual({ nutrient: "PROTEIN", quantity: { grams: 30 } });
  expect(fake.localStart(create)).toBe(at("12:30"));
});

test("own entries can be edited and deleted; other apps' entries are read-only", async ({ page }) => {
  const fake = await fakeBackend(page, {
    entries: [
      { id: "users/me/dataTypes/nutrition-log/dataPoints/1", timeLocal: at("08:00"), mealType: "BREAKFAST", displayName: "Oatmeal", kcal: 150, editable: true },
      { id: "users/me/dataTypes/nutrition-log/dataPoints/2", timeLocal: at("09:00"), mealType: "BREAKFAST", displayName: "Green tea", kcal: 5, editable: false },
    ],
  });
  await page.goto("/#food");
  const oatmeal = page.locator(".entry-list li", { hasText: "Oatmeal" });
  const tea = page.locator(".entry-list li", { hasText: "Green tea" });
  await expect(tea).toContainText("Read-only");
  await expect(tea.getByRole("button")).toHaveCount(0);
  // Calories-only entries have no macro bar.
  await expect(tea.locator(".macro-bars")).toHaveCount(0);

  await oatmeal.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText("Google can't edit quick-add entries in place")).toBeVisible();
  await page.getByLabel("Calories (kcal)").fill("180");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".entry-list li", { hasText: "Oatmeal" })).toContainText("180 kcal");
  // Quick adds can't be patched: the replacement is created first, then the original deleted.
  expect(fake.creates()[0]).toMatchObject({ foodDisplayName: "Oatmeal", energy: { kcal: 180 }, mealType: "BREAKFAST" });
  expect(fake.localStart(fake.creates()[0])).toBe(at("08:00"));
  const deletes = fake.requests.filter((r) => r.url.pathname.endsWith(":batchDelete"));
  expect(deletes[0]!.body).toEqual({ names: ["users/me/dataTypes/nutrition-log/dataPoints/1"] });
  const createdAt = fake.requests.findIndex((r) => r.method === "POST" && r.url.pathname.endsWith("/nutrition-log/dataPoints"));
  expect(createdAt).toBeLessThan(fake.requests.indexOf(deletes[0]!));

  page.once("dialog", (d) => d.accept());
  await page.locator(".entry-list li", { hasText: "Oatmeal" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".entry-list li", { hasText: "Oatmeal" })).toHaveCount(0);
  await expect(page.locator(".entry-list li", { hasText: "Green tea" })).toHaveCount(1);
});

test("library foods log by amount and unit with a live estimate", async ({ page }) => {
  const fake = await fakeBackend(page);
  await page.goto("/#food");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByRole("tab", { name: "My foods" }).click();
  await page.getByPlaceholder("Search your foods").fill("ric");
  await page.getByRole("button", { name: /^Rice/ }).click();
  await page.getByLabel("Amount").fill("3");
  await expect(page.locator(".food-estimate")).toContainText("120 kcal");
  await page.getByRole("button", { name: "Log food" }).click();
  await expect(page.locator(".entry-list")).toContainText("Rice");
  expect(fake.creates()[0]).toMatchObject({ food: RICE.name, serving: { foodMeasurementUnit: RICE.defaultServing.unit, amount: 3 } });
});

test("Open Food Facts search scales nutrition and logs a quick add", async ({ page }) => {
  const fake = await fakeBackend(page);
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
  const create = fake.creates()[0];
  expect(create).toMatchObject({ energy: { kcal: 220 }, totalCarbohydrate: { grams: 32 } });
  expect(create.nutrients).toContainEqual({ nutrient: "PROTEIN", quantity: { grams: 24 } });
  // Browser search uses the CORS-enabled legacy endpoint and identifies itself with X-User-Agent.
  const search = fake.requests.find((r) => r.url.pathname === "/cgi/search.pl")!;
  expect(search.url.searchParams.get("search_terms")).toBe("chobani greek yogurt");
  expect(fake.requests.some((r) => r.url.pathname === `/api/v2/product/${YOGURT.code}.json`)).toBe(true);
});

test("saving a favorite syncs it and makes the panel open on Favorites next time", async ({ page }) => {
  const fake = await fakeBackend(page, {
    entries: [{ id: "users/me/dataTypes/nutrition-log/dataPoints/7", timeLocal: `${yesterday()}T08:00`, mealType: "SNACK", displayName: "Hummus", kcal: 70, proteinG: 2, carbsG: 4, fatG: 5, editable: true }],
  });
  await page.goto("/#food");
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await page.getByRole("button", { name: /Hummus/ }).click(); // from Recent
  await page.getByRole("button", { name: "☆ Save as favorite" }).click();
  await expect(page.getByRole("button", { name: "★ Saved to favorites" })).toBeVisible();
  await expect.poll(() => fake.favorites[0]?.template).toMatchObject({ kind: "quick", displayName: "Hummus", kcal: 70 });

  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add food", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Favorites" })).toHaveAttribute("aria-selected", "true");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove Hummus from favorites" }).click();
  await expect.poll(() => fake.favorites.length).toBe(0);
});

test("when Google is down the entry is queued in the browser and shown as waiting to sync", async ({ page }) => {
  const fake = await fakeBackend(page);
  fake.googleDown = true;
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
  // Still queued after a reload (IndexedDB).
  await page.reload();
  await expect(page.getByLabel("Entries waiting to sync")).toContainText("Offline snack");
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("Entries waiting to sync").getByRole("button", { name: "Discard" }).click();
  await expect(page.getByLabel("Entries waiting to sync")).toHaveCount(0);
});

test("meal cards collapse, and chips filter by meal", async ({ page }) => {
  await fakeBackend(page, {
    entries: [
      { id: "users/me/dataTypes/nutrition-log/dataPoints/1", timeLocal: at("08:00"), mealType: "BREAKFAST", displayName: "Oatmeal", kcal: 150, editable: true },
      { id: "users/me/dataTypes/nutrition-log/dataPoints/2", timeLocal: at("19:00"), mealType: "DINNER", displayName: "Salmon", kcal: 400, editable: true },
    ],
  });
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

test("day layout: log first and summary below; side by side (50/50) on wide screens", async ({ page }) => {
  await fakeBackend(page, {
    entries: [{ id: "users/me/dataTypes/nutrition-log/dataPoints/1", timeLocal: at("08:00"), mealType: "BREAKFAST", displayName: "Oatmeal", kcal: 150, editable: true }],
  });
  const box = (sel: string) => page.locator(sel).first().boundingBox().then((b) => b!);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/#food");
  await expect(page.locator(".entry-list")).toContainText("Oatmeal");
  // The summary's first row is "Calories" (not "Budget").
  await expect(page.locator(".food-summary")).toContainText("Calories ·");
  await expect(page.locator(".food-summary")).not.toContainText("Budget");
  let log = await box(".food-log-col"), summary = await box(".food-summary");
  expect(summary.y).toBeGreaterThan(log.y + log.height - 1); // stacked: summary below the log
  expect((await box(".meal-chips")).y).toBeLessThan((await box(".meals")).y); // filter and actions on top

  await page.setViewportSize({ width: 1300, height: 900 });
  log = await box(".food-log-col");
  summary = await box(".food-summary");
  expect(Math.abs(log.y - summary.y)).toBeLessThan(2); // side by side
  expect(summary.x).toBeGreaterThan(log.x + log.width);
  expect(Math.abs(log.width - summary.width)).toBeLessThan(2); // 50/50
});

test("macro bars share one gram axis: goal markers sit in proportion to the goals", async ({ page }) => {
  await fakeBackend(page, {
    goals: { steps: 10000, activeZoneMinutes: 22, floors: 10, caloriesBurned: 2000, caloriesEaten: 2000, carbsG: 120, fatG: 60, proteinG: 90, exerciseDaysPerWeek: 5, sleepMinutes: null },
    entries: [{ id: "users/me/dataTypes/nutrition-log/dataPoints/1", timeLocal: at("08:00"), mealType: "BREAKFAST", displayName: "Oatmeal", kcal: 400, carbsG: 30, fatG: 20, proteinG: 40, editable: true }],
  });
  await page.goto("/#food");
  await expect(page.locator(".food-summary")).toContainText("Protein · ");
  const rows = page.locator(".food-summary .range-row").filter({ hasText: /^(Carbs|Fat|Protein)/ });
  await expect(rows).toHaveCount(3);
  // Marker centers relative to each track's left edge, in px: proportional to 120 : 60 : 90 g.
  const centers = await rows.evaluateAll((els) => els.map((row) => {
    const track = row.querySelector(".range-track")!.getBoundingClientRect();
    const m = row.querySelector(".range-target")!.getBoundingClientRect();
    return m.left + m.width / 2 - track.left;
  }));
  const [carbs, fat, protein] = centers as [number, number, number];
  expect(fat / carbs).toBeCloseTo(60 / 120, 1);
  expect(protein / carbs).toBeCloseTo(90 / 120, 1);
});

test("week view: carbs, fat and protein charts, and by-meal charts with a measure switch", async ({ page }) => {
  await fakeBackend(page, {
    entries: [
      { id: "users/me/dataTypes/nutrition-log/dataPoints/1", timeLocal: at("08:00"), mealType: "BREAKFAST", displayName: "Oatmeal", kcal: 300, carbsG: 50, fatG: 6, proteinG: 10, editable: true },
      { id: "users/me/dataTypes/nutrition-log/dataPoints/2", timeLocal: at("12:30"), mealType: "ANYTIME", displayName: "Sandwich", kcal: 500, carbsG: 55, fatG: 18, proteinG: 25, editable: true },
    ],
  });
  await page.goto("/#food");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  for (const name of ["Carbs", "Fat", "Protein"]) {
    const card = page.locator(".viz-card", { has: page.getByRole("heading", { name, exact: true }) });
    await expect(card).toContainText("g a day on average");
    await expect(card.getByRole("button", { name: new RegExp(`^Goal .* for ${name}`) })).toBeVisible();
  }
  const byMeal = page.locator("section[aria-labelledby=by-meal-h]");
  await expect(byMeal.getByRole("heading", { name: "Calories by meal" })).toBeVisible();
  await expect(byMeal).toContainText("placed by time of day"); // the ANYTIME sandwich
  await expect(byMeal).toContainText("Lunch · 500 kcal");
  await byMeal.getByRole("button", { name: "Protein", exact: true }).click();
  await expect(byMeal.getByRole("heading", { name: "Protein by meal" })).toBeVisible();
  await expect(byMeal).toContainText("Breakfast · 10 g");
});

test("macro charts show the goal ± 10% as a target band", async ({ page }) => {
  await fakeBackend(page);
  await page.goto("/#food");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  const carbs = page.locator(".viz-card", { has: page.getByRole("heading", { name: "Carbs", exact: true }) });
  await expect(carbs.locator(".viz-target")).toHaveCount(1);
  await expect(carbs.locator(".viz-target-label")).toHaveText("Target 248–303 g"); // default goal 275 g
  await expect(carbs.locator(".viz-goal")).toHaveCount(0);
});

test("each logged food shows its carbs / fat / protein balance", async ({ page }) => {
  await fakeBackend(page, {
    entries: [{ id: "users/me/dataTypes/nutrition-log/dataPoints/9", timeLocal: at("12:00"), mealType: "LUNCH", displayName: "Synthetic wrap", kcal: 330, carbsG: 40, fatG: 10, proteinG: 20, editable: true }],
  });
  await page.goto("/#food");
  const bar = page.locator(".entry-list li", { hasText: "Synthetic wrap" }).getByRole("img", { name: /of calories/ });
  await expect(bar).toHaveAttribute("aria-label", "Carbs 48% · Fat 27% · Protein 24% of calories");
  // Three stacked bars (carbs, fat, protein), each filled to its share.
  await expect(bar.locator(".macro-bar-fill")).toHaveCount(3);
  const widths = await bar.locator(".macro-bar-fill").evaluateAll((els) => els.map((el) => (el as HTMLElement).style.width));
  expect(widths.map((w) => Math.round(parseFloat(w)))).toEqual([48, 27, 24]);
});

test("entry rows: one-line names, icon buttons, macro bars before the name and details", async ({ page }) => {
  const long = "Synthetic grain bowl with roasted vegetables, chickpeas, tahini dressing and extra toppings";
  await fakeBackend(page, {
    entries: [{ id: "users/me/dataTypes/nutrition-log/dataPoints/11", timeLocal: at("12:30"), mealType: "LUNCH", displayName: long, kcal: 610, carbsG: 70, fatG: 25, proteinG: 22, editable: true }],
  });
  await page.goto("/#food");
  const row = page.locator(".entry-list li", { hasText: "Synthetic grain bowl" });
  const name = row.locator(".entry-name");
  await expect(name).toHaveAttribute("title", long); // full name on hover
  const lineHeight = await name.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height);
  expect((await name.boundingBox())!.height).toBeLessThanOrEqual(lineHeight + 1);
  // Details stay on one line too, even on a phone.
  await page.setViewportSize({ width: 390, height: 900 });
  const detail = row.locator(".entry-detail");
  const detailLine = await detail.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect((await detail.boundingBox())!.height).toBeLessThanOrEqual(detailLine + 1);
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(row.getByRole("button", { name: `Edit ${long}` })).toBeVisible();
  await expect(row.getByRole("button", { name: `Delete ${long}` })).toBeVisible();
  // The bars sit after the time and before the name/details.
  const time = (await row.locator(".entry-time").boundingBox())!;
  const bars = (await row.locator(".macro-bars").boundingBox())!;
  const text = (await name.boundingBox())!;
  expect(bars.x).toBeGreaterThanOrEqual(time.x + time.width);
  expect(bars.x + bars.width).toBeLessThanOrEqual(text.x);
  // The time column fits the widest time ("10:00 AM") on one line, then a 14px gap to the bars.
  const timeCol = await row.evaluate((li) => {
    const el = li.querySelector(".entry-time") as HTMLElement;
    const probe = el.cloneNode() as HTMLElement;
    probe.textContent = "10:00 AM";
    Object.assign(probe.style, { position: "absolute", width: "auto", visibility: "hidden" });
    li.appendChild(probe);
    const widest = probe.getBoundingClientRect().width;
    probe.remove();
    return { col: el.getBoundingClientRect().width, widest, gap: li.querySelector(".macro-bars")!.getBoundingClientRect().left - el.getBoundingClientRect().right };
  });
  expect(timeCol.col).toBeGreaterThanOrEqual(timeCol.widest);
  expect(timeCol.col - timeCol.widest).toBeLessThan(3);
  expect(Math.round(timeCol.gap)).toBe(14);
});
