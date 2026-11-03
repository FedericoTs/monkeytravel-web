import { test, expect, type Page } from "@playwright/test";
import draft from "./fixtures/wizard-draft-paris.json";
import { stubGeneration } from "./generation-stub";

/**
 * Changing a generated plan's dates, signed out. The plan moves with the
 * dates; a longer trip asks the assistant for the new days only; when those
 * can't be planned, a note says so, about that plan only.
 *
 * The draft is the first three days of the public Paris template, 10 to 12
 * May 2027. The assistant and generation are stubbed: nothing that writes or
 * bills leaves the page.
 */

const DRAFT_KEY = "monkeytravel-itinerary-draft";

async function isolate(page: Page) {
  await page.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (/(googletagmanager|google-analytics|posthog|buildhop)\.|^maps\.googleapis\.com$/.test(url.host)) {
      return route.abort();
    }
    if (url.pathname === "/api/plans" && req.method() === "POST") {
      return route.fulfill({ status: 503, body: "" });
    }
    if (/^\/api\/(wizard-event|consent-event|page-engaged|page-view|session)/.test(url.pathname)) {
      return route.fulfill({ status: 204, body: "" });
    }
    if (/^\/api\/(places|images|img)(\/|$)/.test(url.pathname) || req.resourceType() === "image") {
      return route.abort();
    }
    return route.continue();
  });
}

/** Restores the Paris draft onto the result view. */
async function restore(page: Page) {
  await page.addInitScript(
    ({ key, value }) => {
      if (sessionStorage.getItem("e2e-draft-seeded")) return;
      localStorage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now() }));
      sessionStorage.setItem("e2e-draft-seeded", "1");
    },
    { key: DRAFT_KEY, value: draft }
  );
  await page.goto("/trips/new");
  const essentialOnly = page.getByRole("button", { name: /essential only/i });
  await essentialOnly
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => essentialOnly.click())
    .catch(() => {});
  await page.getByRole("button", { name: "Restore Trip" }).click({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });
}

async function changeDates(page: Page, start: string, end: string) {
  await page.getByRole("button", { name: "Change dates" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Start").fill(start);
  await dialog.getByLabel("End").fill(end);
  await dialog.getByRole("button", { name: "Change dates" }).click();
  await expect(dialog).toHaveCount(0);
}

/** The draft the wizard keeps, as it stands now. */
async function storedDraft(page: Page): Promise<{ startDate: string; endDate: string; generatedItinerary: { days: { date: string }[] } }> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), DRAFT_KEY);
}

const unplanned = /extra days couldn't be planned/;

test.describe("wizard: changing a plan's dates", () => {
  test.beforeEach(async ({ page }) => {
    await isolate(page);
  });

  test("new dates of the same length move the plan, without asking the assistant", async ({ page }) => {
    const asked: unknown[] = [];
    await page.route("**/api/ai/assistant-anon", (route) => {
      asked.push(route.request().postDataJSON());
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    await restore(page);

    await changeDates(page, "2027-06-01", "2027-06-03");
    await expect
      .poll(async () => {
        const kept = await storedDraft(page);
        return [kept.startDate, kept.endDate, kept.generatedItinerary.days.map((d) => d.date)];
      })
      .toEqual(["2027-06-01", "2027-06-03", ["2027-06-01", "2027-06-02", "2027-06-03"]]);
    expect(asked).toHaveLength(0);
    await expect(page.getByText(unplanned)).toHaveCount(0);
  });

  test("a longer trip asks the assistant for only the new days", async ({ page }) => {
    const asked: { message: string; days: unknown[] }[] = [];
    await page.route("**/api/ai/assistant-anon", async (route) => {
      asked.push(route.request().postDataJSON());
      const day = draft.generatedItinerary.days[0];
      const edits = [4, 5].map((n) => ({
        day_number: n,
        theme: day.theme,
        activities: day.activities.map((a, i) => ({ ...a, id: `added-${n}-${i}` })),
      }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { edits, tripLength: 5 } }) });
    });
    await restore(page);

    await changeDates(page, "2027-05-10", "2027-05-14");
    await expect(page.getByRole("heading", { name: "Day 5", exact: true })).toBeVisible({ timeout: 15_000 });
    expect(asked).toHaveLength(1);
    expect(asked[0].message).toContain("Days 4 to 5");
    expect(asked[0].days).toHaveLength(3);
    await expect(page.getByText(unplanned)).toHaveCount(0);
  });

  test("extra days that can't be planned are noted, and a new plan starts without the note", async ({ page }) => {
    await page.route("**/api/ai/assistant-anon", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
    );
    // After the catch-all: the last route registered is asked first.
    const generation = await stubGeneration(page);
    await restore(page);

    await changeDates(page, "2027-05-10", "2027-05-14");
    await expect(page.getByText(unplanned)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Regenerate", exact: true }).first().click();
    await expect.poll(() => generation.streamed.length + generation.json.length, { timeout: 30_000 }).toBe(1);
    await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(unplanned)).toHaveCount(0);
  });

  test("a plan brought back from the session tray starts without the note", async ({ page }) => {
    await page.route("**/api/ai/assistant-anon", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
    );
    const generation = await stubGeneration(page);
    await restore(page);
    // A second plan for other dates, so the tray offers the first one back
    // (regenerating the same trip only refreshes its entry).
    await changeDates(page, "2027-06-01", "2027-06-03");
    await page.getByRole("button", { name: "Regenerate", exact: true }).first().click();
    await expect.poll(() => generation.streamed.length + generation.json.length, { timeout: 30_000 }).toBe(1);
    await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });

    await changeDates(page, "2027-06-01", "2027-06-05");
    await expect(page.getByText(unplanned)).toBeVisible({ timeout: 15_000 });

    const chips = page.getByRole("button", { name: /^Paris · 3 days$/ });
    await expect(chips).toHaveCount(2);
    const current = () => chips.evaluateAll((els) => els.findIndex((el) => el.getAttribute("aria-current") === "true"));
    const shown = await current();
    await chips.nth(1 - shown).click();
    await expect.poll(current).toBe(1 - shown);
    await expect(page.getByText(unplanned)).toHaveCount(0);
  });
});
