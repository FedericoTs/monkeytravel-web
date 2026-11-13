import { test, expect, type Page } from "@playwright/test";
import draft from "./fixtures/wizard-draft-paris.json";
import itCommon from "../../messages/it/common.json";
import itTrips from "../../messages/it/trips.json";

/**
 * A signed-out planner who generated a trip and comes back finds it in the
 * draft banner, and Restore Trip puts the whole result view back: the trip,
 * every day and activity, and the actions around them. The draft is the
 * first three days of the public Paris template.
 *
 * Nothing leaves the page that could write or bill: keeping the plan,
 * analytics beacons, photos and maps are stubbed or blocked.
 */

const DRAFT_KEY = "monkeytravel-itinerary-draft";

async function isolate(page: Page) {
  await page.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (/(googletagmanager|google-analytics|posthog)\.|^maps\.googleapis\.com$/.test(url.host)) {
      return route.abort();
    }
    if (url.pathname === "/api/plans" && req.method() === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ token: "A".repeat(22), key: "B".repeat(43), expiresAt: "2099-01-01T00:00:00.000Z" }),
      });
    }
    if (url.pathname.startsWith("/api/plans/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ expiresAt: "2099-01-01T00:00:00.000Z" }) });
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

test.describe("wizard: a restored draft", () => {
  test.beforeEach(async ({ page }) => {
    await isolate(page);
    // Once per tab: the wizard rewrites the draft as it restores it.
    await page.addInitScript(
      ({ key, value }) => {
        if (sessionStorage.getItem("e2e-draft-seeded")) return;
        localStorage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now() }));
        sessionStorage.setItem("e2e-draft-seeded", "1");
      },
      { key: DRAFT_KEY, value: draft }
    );
  });

  test("the save wall says why no email went out, in the visitor's language", async ({ page }) => {
    // Supabase's answer once the project's auth-email cap is reached.
    await page.route("**/auth/v1/otp**", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" }),
      })
    );
    const { magicLink } = itCommon.authPrompt;

    await page.goto("/it/trips/new");
    await page.getByRole("button", { name: itTrips.wizard.draftRecovery.restore }).click({ timeout: 30_000 });
    await page.getByRole("button", { name: new RegExp(itTrips.wizard.result.saveTrip) }).first().click({ timeout: 30_000 });

    const wall = page.getByRole("dialog");
    await wall.getByPlaceholder(magicLink.emailPlaceholder).fill("planner@example.com");
    await wall.getByRole("button", { name: magicLink.send }).click();

    await expect(wall.getByText(magicLink.codeRateLimited)).toBeVisible();
    await expect(wall.getByText(/rate limit/i)).toHaveCount(0);
  });

  test("Restore Trip brings back the itinerary and its actions", async ({ page }) => {
    await page.goto("/trips/new");
    await expect(page.getByText("Unsaved trip found")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Restore Trip" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });
    for (const day of draft.generatedItinerary.days) {
      await expect(page.getByRole("heading", { name: `Day ${day.day_number}`, exact: true })).toBeVisible();
      for (const activity of day.activities) {
        await expect(page.getByText(activity.name, { exact: true }).first()).toBeVisible();
      }
    }

    await expect(page.getByRole("button", { name: /Save Trip/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Skyscanner/ })).toHaveAttribute(
      "href",
      draft.generatedItinerary.booking_links.flights[0].url
    );
    await expect(page.getByText(draft.generatedItinerary.trip_summary.packing_suggestions[0])).toBeVisible();
  });
});
