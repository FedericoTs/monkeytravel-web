import { test, expect, type Page } from "@playwright/test";
import draft from "./fixtures/wizard-draft-paris.json";
import { isolate, restoreDraft, storedDraft } from "./wizard-draft";

/**
 * The wizard's assistant, signed out: an edit applies as soon as it arrives and
 * Undo takes it back. The assistant is stubbed: nothing that writes or bills
 * leaves the page.
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

async function ask(page: Page) {
  await page.getByPlaceholder(/Make day 2 cheaper/).fill("Make day 1 a canal cruise");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Day 1 is now a canal cruise.")).toBeVisible({ timeout: 15_000 });
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
});
