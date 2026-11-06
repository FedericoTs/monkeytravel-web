/**
 * The site says a trip works offline, and nothing had ever checked. A trip opened
 * once has to open again with no connection, from the service worker's copy.
 *
 * Needs the same fixtures as key-flows.spec.ts:
 *   KEY_FLOWS_AUTH_STATE  — a Playwright storageState for the owner
 *   KEY_FLOWS_TRIP_ID     — a trip that owner owns
 * Skipped without them. The worker only registers in a production build.
 */
import { test, expect } from "@playwright/test";

const AUTH_STATE = process.env.KEY_FLOWS_AUTH_STATE;
const TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;

test.describe("a trip with no connection", () => {
  test.skip(!AUTH_STATE || !TRIP_ID, "set KEY_FLOWS_AUTH_STATE and KEY_FLOWS_TRIP_ID");
  test.use({ storageState: AUTH_STATE });
  test.describe.configure({ timeout: 120_000 });

  test("opens again once it has been opened", async ({ page, context }) => {
    await page.goto(`/trips/${TRIP_ID}`);
    await page.locator("h1").first().waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

    // A page isn't under the worker until its next load, and that load makes the copy.
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.reload();
    const heading = (await page.locator("h1").first().innerText()).trim();
    expect(heading).not.toBe("");
    await expect
      .poll(() => page.evaluate(async () => Boolean(await caches.match(window.location.pathname))))
      .toBe(true);

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.locator("h1").first()).toHaveText(heading);
      await expect(page.getByText("Offline and not cached")).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });

  test("gives no copy to someone who isn't signed in", async ({ browser }) => {
    const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await stranger.newPage();
    await page.goto(`/trips/${TRIP_ID}`);
    await expect(page).not.toHaveURL(new RegExp(`/trips/${TRIP_ID}`));
    await stranger.close();
  });
});
