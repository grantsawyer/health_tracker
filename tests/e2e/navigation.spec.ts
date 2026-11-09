import { expect, test } from "@playwright/test";
import { fakeBackend } from "./fakeBackend";

test("tiles open their tab, periods change the title, and Log food opens the add panel", async ({ page }) => {
  const fake = await fakeBackend(page);
  await page.goto("/#today");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
  // Today has no period switcher; it is always a single day.
  await expect(page.getByRole("group", { name: "Period" })).toHaveCount(0);

  await page.getByRole("button", { name: /^Steps, last 7 days: / }).click();
  await expect(page.getByRole("button", { name: "Fitness", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Last 7 days");
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^[A-Z][a-z]{2} \d{1,2} – /); // e.g. "Oct 27 – Nov 2"
  await page.getByRole("button", { name: "Back to today" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Last 7 days");
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Log food" }).click();
  await expect(page.getByRole("button", { name: "Food", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Add food" })).toBeVisible();
  expect(fake.unmocked).toEqual([]);
});

test("Body charts: two across on wide screens, one on narrower ones", async ({ page }) => {
  await fakeBackend(page);
  const cols = () => page.locator(".dash-grid.two-up").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto("/#body");
  expect(await cols()).toBe(2);
  await page.setViewportSize({ width: 2600, height: 1000 }); // never three, however wide
  expect(await cols()).toBe(2);
  await page.setViewportSize({ width: 1000, height: 1000 });
  expect(await cols()).toBe(1);
});

test("Sleep quality: four metrics against the usual range, for a night and for a week", async ({ page }) => {
  await fakeBackend(page, { sleepNights: 35 });
  await page.goto("/#sleep");
  const card = page.locator("section[aria-labelledby=quality-h]");
  await expect(card.locator(".range-row")).toHaveCount(4);
  await expect(card).toContainText("Time to sound sleep");
  await expect(card).toContainText("Sound sleep");
  await expect(card).toContainText("Restlessness");
  await expect(card).toContainText(/Interruptions · \d+m · \d+ times?/);
  await expect(card.locator(".range-target").first()).toBeVisible(); // usual range drawn
  await expect(card).toContainText("over your last 30 nights");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(card).toContainText(/Average of \d+ nights?/);
});

test("range charts end on the latest day: the last 7 / 30 days, newest last", async ({ page }) => {
  await fakeBackend(page);
  await page.goto("/#fitness");
  const steps = page.locator(".viz-card", { has: page.getByRole("heading", { name: "Steps", exact: true }) });
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await steps.getByRole("button", { name: "Table" }).click();
  const firstCells = () => steps.locator("tbody tr td:first-child").allTextContents();
  const fmt = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
  };
  // Tables list newest first; the chart runs oldest → newest, so today is its last column.
  await expect.poll(firstCells).toHaveLength(7);
  const week = await firstCells();
  expect(week[0]).toContain(fmt(0));
  expect(week.at(-1)).toContain(fmt(-6));
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Last 30 days");
  await expect.poll(firstCells).toHaveLength(30);
  expect((await firstCells())[0]).toContain(fmt(0));
  expect((await firstCells()).at(-1)).toContain(fmt(-29));
});

test("Sleep quality bars share one minutes axis", async ({ page }) => {
  await fakeBackend(page, { sleepNights: 35 });
  await page.goto("/#sleep");
  const rows = page.locator("section[aria-labelledby=quality-h] .range-row");
  await expect(rows).toHaveCount(4);
  // Each fill's set width (% of its track; rendered pixels add a minimum for the rounded ends) is proportional to
  // the minutes in the row's detail ("Sound sleep · 1h 20m").
  const data = await rows.evaluateAll((els) => els.map((row) => {
    const fill = row.querySelector<HTMLElement>(".range-fill");
    const m = /· (?:(\d+)h )?(\d+)m/.exec(row.querySelector(".range-head")!.textContent ?? "")!;
    return { frac: fill ? parseFloat(fill.style.width) / 100 : 0, minutes: Number(m[1] ?? 0) * 60 + Number(m[2]) };
  }));
  const perMinute = data.filter((d) => d.minutes > 0).map((d) => d.frac / d.minutes);
  for (const r of perMinute) expect(r).toBeCloseTo(perMinute[0]!, 3);
});
