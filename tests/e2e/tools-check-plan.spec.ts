import { test, expect } from "@playwright/test";

/**
 * /tools/check-my-plan — the page and its report. The check itself is stubbed,
 * since it spends on the model and on Google. Other writes don't happen here.
 */

const REPORT = {
  destination: "Rome",
  lookedUp: true,
  looked: 2,
  closed: 1,
  missing: 0,
  packedDays: 1,
  keep: ["Trattoria da Enzo", "Colosseum"],
  days: [
    {
      label: "Day 1",
      packed: true,
      stops: [
        { name: "Colosseum", status: null },
        { name: "Trattoria da Enzo", status: "open" },
        { name: "Gone Forever", status: "closed" },
      ],
    },
  ],
};

test.describe("check my plan @prod", () => {
  test("renders its form, in English and Italian", async ({ page }) => {
    const res = await page.goto("/tools/check-my-plan");
    expect(res?.status()).toBe(200);
    await expect(page.locator("main h1").first()).toContainText(/check your travel plan/i);
    await expect(page.getByLabel("Your plan")).toBeVisible();

    await page.goto("/it/tools/check-my-plan");
    await expect(page.locator("main h1").first()).toContainText(/controlla il tuo piano/i);
  });

  test("is on the tools page", async ({ page }) => {
    await page.goto("/tools");
    await expect(page.locator('a[href$="/tools/check-my-plan"]').first()).toBeVisible();
  });
});

test("a pasted plan gets its report, and the fix opens the planner with the places kept", async ({ page }) => {
  const asked: unknown[] = [];
  await page.route("**/api/tools/check-plan", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REPORT) });
  });

  await page.goto("/tools/check-my-plan");
  await page.getByLabel("Your plan").fill("Day 1: Colosseum, lunch at Trattoria da Enzo, dinner at Gone Forever");
  await page.getByRole("button", { name: "Check my plan" }).click();

  await expect(page.getByRole("heading", { name: "Your plan for Rome" })).toBeVisible();
  expect(asked).toEqual([{ text: "Day 1: Colosseum, lunch at Trattoria da Enzo, dinner at Gone Forever" }]);
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();
  await expect(page.getByText("Too full", { exact: true })).toBeVisible();

  const fix = page.getByRole("link", { name: "Build the fixed plan" });
  const href = new URL((await fix.getAttribute("href"))!, "https://x.test");
  expect(href.pathname).toBe("/trips/new");
  expect(href.searchParams.getAll("must")).toEqual(["Trattoria da Enzo", "Colosseum"]);

  await fix.click();
  await expect(page).toHaveURL(/\/trips\/new\?/);
  await expect(page.getByRole("combobox").first()).toHaveValue(/Rome/);
});
