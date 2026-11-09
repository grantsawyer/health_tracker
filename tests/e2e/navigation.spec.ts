import { expect, test } from "@playwright/test";
import { mockApi } from "./mockApi";

test("tiles open their tab, periods change the title, and Log food opens the add panel", async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto("/#today");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
  // Today has no period switcher; it is always a single day.
  await expect(page.getByRole("group", { name: "Period" })).toHaveCount(0);

  await page.getByRole("button", { name: /^Steps this week: / }).click();
  await expect(page.getByRole("button", { name: "Fitness", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This week");
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Last week");
  await page.getByRole("button", { name: "Back to today" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This week");
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Log food" }).click();
  await expect(page.getByRole("button", { name: "Food", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Add food" })).toBeVisible();
  expect(mock.unmocked).toEqual([]);
});
