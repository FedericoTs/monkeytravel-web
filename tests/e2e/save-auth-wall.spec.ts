import { test, expect } from "@playwright/test";

/**
 * The Save Trip flow now hosts the auth wall (moved from Generate as of
 * 2026-05-23). An anonymous visitor should be able to walk all the way
 * through the wizard + see their generated itinerary; the signup modal
 * should ONLY appear when they click Save.
 *
 * Heavy UI test — slow because it includes a real Gemini generation.
 * Tagged @prod for post-deploy smoke; can be skipped via CI env in
 * a rate-limited environment.
 */

test.describe("save → auth wall @prod @slow", () => {
  test.skip(
    !!process.env.SKIP_AI_TESTS,
    "set SKIP_AI_TESTS=1 to skip AI-quota-burning tests"
  );

  test("anonymous visitor: wizard → generate → save → auth modal", async ({
    page,
  }) => {
    await page.goto("/trips/new");

    // Step 1: destination + dates
    // The DestinationAutocomplete uses a textbox; type something common
    // that will resolve in the autocomplete.
    // The destination field is role="combobox" (autocomplete listbox), so
    // getByRole("textbox") has never matched it.
    const destInput = page.getByRole("combobox").first();
    await destInput.fill("Lisbon");
    await page.waitForTimeout(800); // let autocomplete settle
    // Press Enter or click the first suggestion if visible
    await page.keyboard.press("Enter");

    // Dates. The wizard offers one-tap DURATION PRESETS (Weekend / 5 days /
    // 1 week / 10 days / 2 weeks) behind an "Add your travel dates" control —
    // there are no input[type=date] elements, so the old branch here silently
    // matched nothing, dates stayed empty, and "Continue" stayed DISABLED.
    // That is why this test timed out waiting for a button that was present
    // but never enabled.
    const preset = page.getByRole("button", { name: /^5 days$/i }).first();
    if (await preset.isVisible().catch(() => false)) {
      await preset.click();
    } else {
      const dateInputs = page.locator('input[type="date"]');
      if ((await dateInputs.count()) >= 2) {
        await dateInputs.nth(0).fill("2026-10-15");
        await dateInputs.nth(1).fill("2026-10-17");
      }
    }

    // Continue to step 2
    const continueBtn = page.getByRole("button", { name: /continue|next/i }).first();
    // isVisible() alone is not enough — the button renders disabled until step
    // 1 is valid, and clicking a disabled button waits out the whole timeout.
    if (await continueBtn.isEnabled().catch(() => false)) {
      await continueBtn.click();
    }

    // Step 2: select a vibe
    const vibeFoodie = page.getByText(/foodie/i).first();
    if (await vibeFoodie.isVisible()) {
      await vibeFoodie.click();
    }

    // Generate
    const generateBtn = page.getByRole("button", { name: /generate|create/i }).first();
    await generateBtn.click();

    // Wait for the itinerary to render (up to ~50s for Gemini)
    await expect(
      page.getByText(/day 1/i).first()
    ).toBeVisible({ timeout: 50_000 });

    // CRITICAL ASSERTION: the auth modal should NOT have appeared.
    await expect(page.locator('[role="dialog"]').filter({ hasText: /sign up|log in|sign in/i }))
      .not.toBeVisible();

    // Now click Save → THIS should trigger the auth modal
    const saveBtn = page.getByRole("button", { name: /save/i }).first();
    await saveBtn.click();

    // Auth modal should appear within 3s
    await expect(
      page.locator('[role="dialog"]').filter({ hasText: /sign|continue with google/i }).first()
    ).toBeVisible({ timeout: 3_000 });
  });
});
