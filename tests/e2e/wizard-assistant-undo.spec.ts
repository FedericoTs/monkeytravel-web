import { test, expect, type Page } from "@playwright/test";
import draft from "./fixtures/wizard-draft-paris.json";
import { stubGeneration } from "./generation-stub";
import { changeDates, isolate, restoreDraft, storedDraft } from "./wizard-draft";

/**
 * The wizard's assistant, signed out: an edit applies as soon as it arrives and
 * Undo takes it back, and an answer about a plan that has since been replaced
 * changes nothing. The assistant and generation are stubbed: nothing that writes
 * or bills leaves the page.
 */

const originalDayOne = draft.generatedItinerary.days[0].activities.map((a) => a.name);

/** The assistant answers with Day 1 as one new activity. */
async function stubAssistant(page: Page) {
  const day = draft.generatedItinerary.days[0];
  const edits = [{ day_number: 1, theme: day.theme, activities: [{ ...day.activities[0], id: undefined, name: "Canal cruise" }] }];
  await page.route("**/api/ai/assistant-anon", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { reply: "Day 1 is now a canal cruise.", edits } }),
    })
  );
}

function askOnly(page: Page) {
  return page
    .getByPlaceholder(/Make day 2 cheaper/)
    .fill("Make day 1 a canal cruise")
    .then(() => page.getByRole("button", { name: "Send", exact: true }).click());
}

async function ask(page: Page) {
  await askOnly(page);
  await expect(page.getByText("Day 1 is now a canal cruise.")).toBeVisible({ timeout: 15_000 });
}

/** The assistant holds that answer until released. */
async function holdAssistant(page: Page): Promise<() => void> {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const day = draft.generatedItinerary.days[0];
  const edits = [{ day_number: 1, theme: day.theme, activities: [{ ...day.activities[0], id: undefined, name: "Canal cruise" }] }];
  await page.route("**/api/ai/assistant-anon", async (route) => {
    await held;
    // The page may have cancelled the request by now.
    await route
      .fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { reply: "Day 1 is now a canal cruise.", edits } }) })
      .catch(() => {});
  });
  return release;
}

/** Time for a late answer to land, then nothing of it on the plan now on screen. */
async function expectNothingLanded(page: Page) {
  await page.waitForTimeout(1_000);
  await expect(page.getByRole("heading", { name: "Canal cruise" })).toHaveCount(0);
  expect(await firstDayKept(page)).not.toContain("Canal cruise");
}

const firstDayKept = async (page: Page) =>
  (await storedDraft(page)).generatedItinerary.days[0].activities.map((a) => a.name);

test.describe("wizard: the assistant's edits", () => {
  test.beforeEach(async ({ page }) => {
    await isolate(page);
  });

  test("an edit applies as it arrives, and Undo takes it back", async ({ page }) => {
    await stubAssistant(page);
    await restoreDraft(page);

    await ask(page);
    await expect.poll(() => firstDayKept(page)).toEqual(["Canal cruise"]);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => firstDayKept(page)).toEqual(originalDayOne);
    await expect(page.getByText(/Can't undo/)).toHaveCount(0);
  });

  test("an answer that arrives after Regenerate changes nothing on the new plan", async ({ page }) => {
    const release = await holdAssistant(page);
    const generation = await stubGeneration(page);
    await restoreDraft(page);

    await askOnly(page);
    await page.getByRole("button", { name: "Regenerate", exact: true }).first().click();
    await expect.poll(() => generation.streamed.length + generation.json.length, { timeout: 30_000 }).toBe(1);
    await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });

    release();
    await expectNothingLanded(page);
  });

  test("an answer that arrives after a tray swap changes nothing on the plan brought back", async ({ page }) => {
    const release = await holdAssistant(page);
    const generation = await stubGeneration(page);
    await restoreDraft(page);
    // A second plan for other dates, so the tray offers the first one back.
    await changeDates(page, "2027-06-01", "2027-06-03");
    await page.getByRole("button", { name: "Regenerate", exact: true }).first().click();
    await expect.poll(() => generation.streamed.length + generation.json.length, { timeout: 30_000 }).toBe(1);
    await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });

    await askOnly(page);
    const chips = page.getByRole("button", { name: /^Paris · 3 days$/ });
    await expect(chips).toHaveCount(2);
    const current = () => chips.evaluateAll((els) => els.findIndex((el) => el.getAttribute("aria-current") === "true"));
    const shown = await current();
    await chips.nth(1 - shown).click();
    await expect.poll(current).toBe(1 - shown);

    release();
    await expectNothingLanded(page);
    await expect(page.getByText("Day 1 is now a canal cruise.")).toHaveCount(0);
  });

  test("a photo found after the edit leaves Undo working, and stays", async ({ page }) => {
    await stubAssistant(page);
    // After the catch-all: the last route registered is asked first.
    await page.route("**/api/images/landmarks", async (route) => {
      const { names } = route.request().postDataJSON() as { names: string[] };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ photos: names.map((_, i) => `/api/images/wikimedia/found-${i}-500.jpg?a=X&l=CC0&f=Y.jpg`) }),
      });
    });
    await restoreDraft(page);

    await ask(page);
    await expect.poll(() => firstDayKept(page)).toEqual(["Canal cruise"]);
    // The new stop, which has no photo, in the middle of the screen while the photos are found.
    await page.locator('[data-activity-name="Canal cruise"]').first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    // The planner asks for the photos found 5 seconds after a plan's activities change.
    const photoOf = async (name: string) =>
      (await storedDraft(page)).generatedItinerary.days.flatMap((d) => d.activities).find((a) => a.name === name)?.image_url;
    // Day 2 has no photo of this place in the draft, and is below the screen: its photo is added.
    const lunch = "Lunch at Le Comptoir du Panthéon";
    await expect.poll(() => photoOf(lunch), { timeout: 15_000 }).toContain("/api/images/wikimedia/found-");
    const lunchPhoto = await photoOf(lunch);
    // The stop on screen keeps showing none: adding one there would move what is being read.
    expect(await photoOf("Canal cruise")).toBeUndefined();

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => firstDayKept(page)).toEqual(originalDayOne);
    await expect(page.getByText(/Can't undo/)).toHaveCount(0);
    expect(await photoOf(lunch)).toBe(lunchPhoto);
  });
});
