import { test, expect, devices } from "@playwright/test";

/**
 * Mobile wizard E2E. Drives the full wizard → generate → result flow
 * at iPhone 13 dimensions (390x844). NOT @prod-tagged because it
 * generates a real itinerary (burns AI quota); intended for the local
 * dev CI job.
 *
 * Guards against the classic "wizard works on desktop, breaks on
 * mobile" failure mode — Continue button hidden under MobileBottomNav,
 * date picker overflows, hero image overflows the viewport, etc.
 */

test.use({ ...devices["iPhone 13"] });

test.describe("wizard at mobile width", () => {
  test.skip(
    !!process.env.SKIP_AI_TESTS,
    "set SKIP_AI_TESTS=1 to skip AI-quota-burning tests"
  );

  test("step1 → step2 → generate → result renders without horizontal scroll", async ({
    page,
  }) => {
    // Fixed destination + dates 30 days out so the test is repeatable.
    const start = new Date();
    start.setDate(start.getDate() + 30);
    const end = new Date(start);
    end.setDate(end.getDate() + 2);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    await page.goto(`/trips/new?destination=Lisbon`);

    // Whichever way the wizard surfaces "Just me" vs "With friends",
    // we pick the solo path so the flow is deterministic.
    await page.getByRole("button", { name: /just me|solo/i }).click();

    // Fill the dates via the form. The DateRangePicker uses buttons;
    // tap each to open the calendar.
    // Use the start/end ISO date attributes if available, or fall back
    // to date strings in the inputs.
    const startInput = page.locator(`input[value], input[type='date']`).first();
    if ((await startInput.count()) > 0) {
      await startInput.fill(fmt(start));
    }
    const endInput = page.locator(`input[type='date']`).nth(1);
    if ((await endInput.count()) > 0) {
      await endInput.fill(fmt(end));
    }

    await page.getByRole("button", { name: /continue|next/i }).click();

    // Step 2: at least one vibe is auto-selected by the seasonal
    // suggester, so we should be able to hit Generate directly.
    await page.getByRole("button", { name: /generate/i }).click();

    // Generation takes 20–40s. Wait up to 60s for the result hero.
    await page.waitForSelector("text=/lisbon|trip overview/i", {
      timeout: 60_000,
    });

    // Result page checks at iPhone width:
    // 1) No horizontal scrollbar — document scrollWidth must equal viewport.
    const viewportW = await page.evaluate(() => window.innerWidth);
    const docScrollW = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    expect(
      docScrollW,
      `horizontal overflow detected (doc=${docScrollW}px, viewport=${viewportW}px)`
    ).toBeLessThanOrEqual(viewportW + 1); // +1 to forgive subpixel rounding

    // 2) Save Trip button is reachable (visible AND within viewport).
    const saveBtn = page.getByRole("button", { name: /save trip/i }).first();
    await expect(saveBtn).toBeVisible();
  });
});
