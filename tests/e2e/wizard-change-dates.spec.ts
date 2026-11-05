import { test, expect, type Page } from "@playwright/test";
import draft from "./fixtures/wizard-draft-paris.json";
import { stubGeneration } from "./generation-stub";
import { isolate, restoreDraft as restore, storedDraft } from "./wizard-draft";

/**
 * Changing a generated plan's dates, signed out. The plan moves with the
 * dates; a longer trip asks the assistant for the new days only; when those
 * can't be planned, a note says so, about that plan only.
 *
 * The draft is the first three days of the public Paris template, 10 to 12
 * May 2027. The assistant and generation are stubbed: nothing that writes or
 * bills leaves the page.
 */

async function changeDates(page: Page, start: string, end: string) {
  await page.getByRole("button", { name: "Change dates" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Start").fill(start);
  await dialog.getByLabel("End").fill(end);
  await dialog.getByRole("button", { name: "Change dates" }).click();
  await expect(dialog).toHaveCount(0);
}

const unplanned = /extra days couldn't be planned/;
const planning = "Planning your extra days";

/** The assistant holds its answer, Days 4 and 5 of a longer trip, until released. */
async function holdExtraDays(page: Page): Promise<() => void> {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const day = draft.generatedItinerary.days[0];
  const edits = [4, 5].map((n) => ({
    day_number: n,
    theme: day.theme,
    activities: day.activities.map((a, i) => ({ ...a, id: `added-${n}-${i}` })),
  }));
  await page.route("**/api/ai/assistant-anon", async (route) => {
    await held;
    // The page may have cancelled the request by now.
    await route
      .fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { edits, tripLength: 5 } }) })
      .catch(() => {});
  });
  return release;
}

/** Time for a late answer to land, then nothing of it on the plan now on screen. */
async function expectNothingLanded(page: Page) {
  await page.waitForTimeout(1_000);
  await expect(page.getByRole("heading", { name: "Day 4", exact: true })).toHaveCount(0);
  await expect(page.getByText(unplanned)).toHaveCount(0);
  await expect(page.getByText(planning)).toHaveCount(0);
}

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
        const plan = kept.generatedItinerary;
        return [kept.startDate, kept.endDate, plan.days.map((d) => d.date), plan.trip_summary.total_estimated_cost];
      })
      // The same days on new dates: the total stays.
      .toEqual(["2027-06-01", "2027-06-03", ["2027-06-01", "2027-06-02", "2027-06-03"], 900]);
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
    // Two more days of Day 1's activities (140 each): the total grows by 280.
    await expect
      .poll(async () => {
        const plan = (await storedDraft(page)).generatedItinerary;
        return [plan.days.length, plan.trip_summary.total_estimated_cost];
      })
      .toEqual([5, 1180]);
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

  test("extra days still being planned don't land on the plan that replaced this one", async ({ page }) => {
    const release = await holdExtraDays(page);
    const generation = await stubGeneration(page);
    await restore(page);

    await changeDates(page, "2027-05-10", "2027-05-14");
    await expect(page.getByText(planning)).toBeVisible();
    await page.getByRole("button", { name: "Regenerate", exact: true }).first().click();
    await expect.poll(() => generation.streamed.length + generation.json.length, { timeout: 30_000 }).toBe(1);
    await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });

    release();
    await expectNothingLanded(page);
  });

  test("extra days still being planned don't land on a plan brought back from the session tray", async ({ page }) => {
    const release = await holdExtraDays(page);
    const generation = await stubGeneration(page);
    await restore(page);
    // A second plan for other dates, so the tray offers the first one back.
    await changeDates(page, "2027-06-01", "2027-06-03");
    await page.getByRole("button", { name: "Regenerate", exact: true }).first().click();
    await expect.poll(() => generation.streamed.length + generation.json.length, { timeout: 30_000 }).toBe(1);
    await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });

    await changeDates(page, "2027-06-01", "2027-06-05");
    await expect(page.getByText(planning)).toBeVisible();
    const chips = page.getByRole("button", { name: /^Paris · 3 days$/ });
    await expect(chips).toHaveCount(2);
    const current = () => chips.evaluateAll((els) => els.findIndex((el) => el.getAttribute("aria-current") === "true"));
    const shown = await current();
    await chips.nth(1 - shown).click();
    await expect.poll(current).toBe(1 - shown);

    release();
    await expectNothingLanded(page);
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
