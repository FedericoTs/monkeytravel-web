import { test, expect, type Page } from "@playwright/test";
import { stubGeneration, stubPlan } from "./generation-stub";

/**
 * A signed-out planner goes from a one-tap destination to a generated trip:
 * the pick fills the place and pencils in five days, step 2 takes a vibe,
 * Generate streams the plan into the result view, and Save asks for an
 * account. The generation is answered by the test (generation-stub.ts), so no
 * model is called.
 *
 * Nothing leaves the page that could write or bill: keeping the plan,
 * analytics beacons, photos and maps are stubbed or blocked.
 */

async function isolate(page: Page) {
  await page.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (/(googletagmanager|google-analytics|posthog|buildhop)\.|^maps\.googleapis\.com$/.test(url.host)) {
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

/** Today in the browser's calendar, plus `days`. */
async function browserDate(page: Page, days: number): Promise<string> {
  return page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, days);
}

test.describe("wizard: planning a trip", () => {
  test("a one-tap pick is generated, shown and kept behind the account wall", async ({ page }) => {
    await isolate(page);
    // After the catch-all: the last route registered is asked first.
    const generation = await stubGeneration(page);

    await page.goto("/trips/new");
    const essentialOnly = page.getByRole("button", { name: /essential only/i });
    await essentialOnly
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => essentialOnly.click())
      .catch(() => {});

    const pick = page.getByRole("group", { name: "Popular right now" }).getByRole("button").first();
    const place = (await pick.getAttribute("aria-label"))?.match(/^Start a trip to (.+) — /)?.[1];
    expect(place, "the pick names its place").toBeTruthy();
    await pick.click();
    await expect(page.getByRole("combobox").first()).toHaveValue(place!);

    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("heading", { name: "Set your travel style" }).waitFor();
    // The cards animate in, and a click landing mid-entrance is lost: click
    // until the pick registers, as a person clicks again.
    const foodie = page.getByText("Foodie Journey", { exact: true }).filter({ visible: true }).first();
    const generate = page.getByRole("button", { name: "Generate Itinerary" });
    await expect(async () => {
      if (await generate.isDisabled()) await foodie.click();
      await expect(generate).toBeEnabled({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    await generate.click();

    const start = await browserDate(page, 21);
    const end = await browserDate(page, 25);
    const plan = stubPlan({ destination: place!, startDate: start, endDate: end });
    await expect(page.getByRole("heading", { level: 1, name: place! })).toBeVisible({ timeout: 30_000 });
    for (const day of plan.days) {
      await expect(page.getByRole("heading", { name: `Day ${day.day_number}`, exact: true })).toBeVisible();
    }
    for (const activity of plan.days[0].activities) {
      await expect(page.getByText(activity.name, { exact: true }).first()).toBeVisible();
    }

    expect(generation.streamed).toHaveLength(1);
    expect(generation.streamed[0]).toMatchObject({ destination: place, startDate: start, endDate: end, locale: "en" });
    expect(generation.streamed[0].vibes).toContain("foodie");
    expect(generation.json, "the stream answered, so the JSON endpoint is not asked").toHaveLength(0);

    const accountWall = page.getByRole("dialog").filter({ hasText: /sign|continue with google/i });
    await expect(accountWall).toHaveCount(0);
    await page.getByRole("button", { name: /Save Trip/ }).first().click();
    await expect(accountWall.first()).toBeVisible({ timeout: 5_000 });
  });
});
