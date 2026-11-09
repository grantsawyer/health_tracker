import { expect, test } from "@playwright/test";
import { mockApi } from "./mockApi";

test("goals can be edited inline on the chart that shows them", async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto("/#fitness");
  const stepsCard = page.locator(".viz-card", { has: page.getByRole("heading", { name: "Steps", exact: true }) });
  await stepsCard.getByRole("button", { name: /^Goal 10,000 for Steps/ }).click();
  const dialog = page.getByRole("dialog", { name: "Steps goal" });
  await dialog.getByLabel("Steps goal").fill("9500");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  expect(mock.goals.steps).toBe(9500);
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
  expect(mock.goals.steps).toBe(9500);
});

test("an unset sleep goal can be set from the sleep chart, in hours", async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto("/#sleep");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.getByRole("button", { name: /^Set goal for Sleep/ }).first().click();
  await page.getByRole("dialog", { name: "Sleep goal" }).getByLabel("Sleep goal").fill("7.5");
  await page.getByRole("dialog", { name: "Sleep goal" }).getByRole("button", { name: "Save" }).click();
  await expect.poll(() => mock.goals.sleepMinutes).toBe(450);
  await expect(page.getByRole("button", { name: /^Goal 7h 30m for Sleep/ }).first()).toBeVisible();
});

test("the sidebar collapses to icons and remembers it", async ({ page }) => {
  await mockApi(page);
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
