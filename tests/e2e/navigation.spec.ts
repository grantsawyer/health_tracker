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

test("Sleep duration card: a night has the timeline; a week keeps only the comparison views", async ({ page }) => {
  await fakeBackend(page, { sleepNights: 35 });
  await page.goto("/#sleep");
  const card = page.locator("section[aria-labelledby=night-h]");
  const views = card.getByRole("group", { name: "Sleep view" });
  await expect(views.getByRole("button")).toHaveText(["Timeline", "Compared with usual", "30-day average"]);

  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(views.getByRole("button")).toHaveText(["Compared with usual", "30-day average"]);
  await expect(card).toContainText(/Average of 7 nights/);
  await expect(card).toContainText("on average");
  await expect(views.getByRole("button", { name: "Compared with usual" })).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator(".range-row")).toHaveCount(4);
  await expect(card.locator(".range-target").first()).toBeVisible();
});

test("Sleep schedule: bedtime at the bottom, wake time at the top; goal bands have no edge lines", async ({ page }) => {
  await fakeBackend(page, { sleepNights: 10, goals: { steps: 10000, activeZoneMinutes: 22, floors: 10, caloriesBurned: 2000, caloriesEaten: 2000, carbsG: 275, fatG: 78, proteinG: 50, exerciseDaysPerWeek: 5, sleepMinutes: null, bedtime: 23 * 60, wakeTime: 7 * 60 } });
  await page.goto("/#sleep");
  const card = page.locator(".viz-card", { has: page.getByRole("heading", { name: "Sleep schedule" }) });
  const yOf = (label: RegExp) => card.locator("svg text", { hasText: label }).first().evaluate((el) => (el as SVGGraphicsElement).getBBox().y);
  expect(await yOf(/^Wake goal/)).toBeLessThan(await yOf(/^Bedtime goal/));
  await expect(card.locator(".viz-target")).toHaveCount(2);
  await expect(card.locator(".viz-target line")).toHaveCount(0);
});

test("Recovery vitals: Body shows each vital against the typical range, and they can be Today cards", async ({ page }) => {
  const fake = await fakeBackend(page, { vitalsDays: 40 });
  await page.goto("/#body");
  const section = page.getByRole("region", { name: "Recovery vitals" });
  await expect(section.locator(".viz-card-title")).toHaveText(["Heart rate variability", "Oxygen saturation (SpO2)", "Breathing rate", "Skin temperature", "Cardio fitness (VO2 max)"]);
  const vo2 = section.locator(".viz-card", { has: page.getByRole("heading", { name: "Cardio fitness (VO2 max)" }) });
  await expect(vo2).toContainText("Good cardio fitness.");
  await expect(vo2).toContainText(/Your typical range/);
  // Skin temperature is the night's variation from baseline, in °F with imperial units.
  await expect(section.locator(".viz-card", { has: page.getByRole("heading", { name: "Skin temperature" }) }).locator(".viz-card-value")).toHaveText(/^[+−±]\d\.\d °F$/);

  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Customize" }).click();
  await page.locator(".today-grid .board-add").click();
  await page.getByRole("region", { name: "Add a card to Today" }).getByRole("button", { name: /^Heart rate variability/ }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".today-grid .tile-label")).toContainText(["Heart rate variability"]);
  await expect.poll(() => fake.layout?.today).toContain("hrv");
  expect(fake.unmocked).toEqual([]);
});

test("Recovery vitals: an account without them gets a short note, not empty charts", async ({ page }) => {
  await fakeBackend(page);
  await page.goto("/#body");
  const section = page.getByRole("region", { name: "Recovery vitals" });
  await expect(section).toContainText("No recovery vitals yet");
  await expect(section.locator(".viz-card")).toHaveCount(0);
});
