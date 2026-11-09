import { expect, test } from "@playwright/test";
import { fakeBackend } from "./fakeBackend";

test("goals can be edited inline on the chart that shows them", async ({ page }) => {
  const fake = await fakeBackend(page);
  await page.goto("/#fitness");
  const stepsCard = page.locator(".viz-card", { has: page.getByRole("heading", { name: "Steps", exact: true }) });
  await stepsCard.getByRole("button", { name: /^Goal 10,000 for Steps/ }).click();
  const dialog = page.getByRole("dialog", { name: "Steps goal" });
  await dialog.getByLabel("Steps goal").fill("9500");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => fake.goals.steps).toBe(9500);
  // Every goal display updates from the shared goals source.
  await expect(stepsCard.getByRole("button", { name: /^Goal 9,500 for Steps/ })).toBeVisible();
  await expect(stepsCard.locator("svg text", { hasText: "Goal 9,500" })).toBeVisible(); // the goal-line label

  // Validation and Escape
  await stepsCard.getByRole("button", { name: /^Goal 9,500 for Steps/ }).click();
  await dialog.getByLabel("Steps goal").fill("0");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a number");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(fake.goals.steps).toBe(9500);
});

test("an unset sleep goal can be set from the sleep chart, in hours", async ({ page }) => {
  const fake = await fakeBackend(page);
  await page.goto("/#sleep");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.getByRole("button", { name: /^Set goal for Sleep/ }).first().click();
  await page.getByRole("dialog", { name: "Sleep goal" }).getByLabel("Sleep goal").fill("7.5");
  await page.getByRole("dialog", { name: "Sleep goal" }).getByRole("button", { name: "Save" }).click();
  await expect.poll(() => fake.goals.sleepMinutes).toBe(450);
  await expect(page.getByRole("button", { name: /^Goal 7h 30m for Sleep/ }).first()).toBeVisible();
});

test("the sidebar collapses to icons and remembers it", async ({ page }) => {
  await fakeBackend(page);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/#today");
  await expect(page.locator(".brand")).toContainText("Health Tracker");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator(".shell")).toHaveClass(/rail-collapsed/);
  await expect(page.locator(".nav-btn span").first()).toBeHidden();
  // Tabs still work by their accessible names.
  await page.getByRole("button", { name: "Sleep", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sleep", exact: true })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(page.locator(".shell")).toHaveClass(/rail-collapsed/);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.locator(".shell")).not.toHaveClass(/rail-collapsed/);
});

test("clicking empty sidebar space collapses and expands it; buttons don't", async ({ page }) => {
  await fakeBackend(page);
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto("/#today");
  const shell = page.locator(".shell");
  const rail = page.locator(".rail");
  const box = (await rail.boundingBox())!;
  // Empty space between the last nav button and the Collapse button.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.65);
  await expect(shell).toHaveClass(/rail-collapsed/);
  await page.getByRole("button", { name: "Sleep", exact: true }).click(); // a button only navigates
  await expect(shell).toHaveClass(/rail-collapsed/);
  await expect(page.getByRole("button", { name: "Sleep", exact: true })).toHaveAttribute("aria-current", "page");
  await page.locator(".brand").click(); // the logo area is empty space too
  await expect(shell).not.toHaveClass(/rail-collapsed/);
});

test("on narrow screens (top bar) clicking the bar doesn't collapse anything", async ({ page }) => {
  await fakeBackend(page);
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto("/#today");
  await page.locator(".rail").click({ position: { x: 3, y: 3 } }); // the bar's empty padding
  await expect(page.locator(".shell")).not.toHaveClass(/rail-collapsed/);
});

test("on wide screens the content is centered beside the sidebar", async ({ page }) => {
  await fakeBackend(page);
  await page.setViewportSize({ width: 2200, height: 900 });
  await page.goto("/#today");
  const rail = (await page.locator(".rail").boundingBox())!;
  const main = (await page.locator(".main").boundingBox())!;
  expect(Math.round(main.width)).toBe(1475);
  const left = main.x - (rail.x + rail.width);
  const right = 2200 - (main.x + main.width);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
});

test("the sidebar stays put while the page scrolls", async ({ page }) => {
  await fakeBackend(page, { sleepNights: 10 });
  await page.setViewportSize({ width: 1300, height: 700 });
  await page.goto("/#food");
  await expect(page.locator(".viz-card").first()).toBeVisible();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  const rail = (await page.locator(".rail").boundingBox())!;
  expect(Math.round(rail.y)).toBe(0);
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeInViewport();
  // …and still no sideways scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("bedtime and wake goals: set inline, then nights show as on schedule or not", async ({ page }) => {
  const fake = await fakeBackend(page, { sleepNights: 10 });
  await page.goto("/#sleep");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  const card = page.locator(".viz-card", { has: page.getByRole("heading", { name: "Sleep schedule", exact: true }) });
  await card.getByRole("button", { name: /^Set goal for Sleep schedule/ }).click();
  const dialog = page.getByRole("dialog", { name: "Sleep schedule goal" });
  await dialog.getByLabel("Bedtime").fill("23:00");
  await dialog.getByLabel("Wake time").fill("04:45");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => [fake.goals.bedtime, fake.goals.wakeTime]).toEqual([23 * 60, 4 * 60 + 45]);
  await expect(card.getByRole("button", { name: /^Goal 11 PM – 4:45 AM for Sleep schedule/ })).toBeVisible();
  await expect(card).toContainText(/On schedule \d+ of 7 nights/);
  await expect(card.locator(".viz-target")).toHaveCount(2); // bedtime and wake bands
  await card.getByRole("button", { name: "Table" }).click();
  await expect(card.locator("th", { hasText: "On schedule" })).toBeVisible();
  // Day view: the night card says how that night compares.
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.locator(".night-card")).toContainText(/(On|Off) schedule: bedtime .*, wake time /);
});
