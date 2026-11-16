import { test, expect, type Page } from "@playwright/test";
import { stubGeneration } from "./generation-stub";

/**
 * "Who's coming?" on step 1 offers four answers, two by two so they fit a
 * phone, and the one picked travels with the plan: in the request the planner
 * sends and in the funnel row for the generation. The generation is answered
 * by the test (generation-stub.ts), so no model is called; every write is
 * stubbed or blocked.
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

const ANSWERS = ["Just me", "Couple", "Family", "With friends"];

test.describe("wizard: who's coming", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("four answers fit a phone two by two, and Family travels with the plan", async ({ page }) => {
    await isolate(page);
    const generation = await stubGeneration(page);
    const groupSizes: unknown[] = [];
    await page.route("**/api/wizard-event", (route) => {
      const row = route.request().postDataJSON();
      if (row.step === "generating") groupSizes.push(row.group_size);
      return route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/trips/new");
    const essentialOnly = page.getByRole("button", { name: /essential only/i });
    await essentialOnly
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => essentialOnly.click())
      .catch(() => {});

    const boxes = [];
    for (const name of ANSWERS) {
      const answer = page.getByRole("button", { name, exact: true });
      await expect(answer).toHaveAttribute("aria-pressed", "false");
      boxes.push((await answer.boundingBox())!);
    }
    // Two rows of two, in the order offered, inside the screen's width.
    const [justMe, couple, family, friends] = boxes;
    expect(Math.abs(justMe.y - couple.y)).toBeLessThan(2);
    expect(Math.abs(family.y - friends.y)).toBeLessThan(2);
    expect(family.y).toBeGreaterThan(justMe.y + justMe.height - 1);
    expect(couple.x).toBeGreaterThan(justMe.x);
    for (const box of boxes) expect(box.x + box.width).toBeLessThanOrEqual(375);

    const familyButton = page.getByRole("button", { name: "Family", exact: true });
    await familyButton.click();
    await expect(familyButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("You'll be able to invite friends to vote")).toHaveCount(0);

    const pick = page.getByRole("group", { name: "Popular right now" }).getByRole("button").first();
    const place = (await pick.getAttribute("aria-label"))?.match(/^Start a trip to (.+) — /)?.[1];
    expect(place, "the pick names its place").toBeTruthy();
    await pick.click();
    await page.getByRole("button", { name: /^Continue/ }).click();
    await page.getByRole("heading", { name: "Set your travel style" }).waitFor();
    const foodie = page.getByText("Foodie Journey", { exact: true }).filter({ visible: true }).first();
    const generate = page.getByRole("button", { name: "Generate Itinerary" });
    await expect(async () => {
      if (await generate.isDisabled()) await foodie.click();
      await expect(generate).toBeEnabled({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    await generate.click();
    await expect(page.getByRole("heading", { level: 1, name: place })).toBeVisible({ timeout: 30_000 });

    expect([...generation.streamed, ...generation.json].map((r) => r.tripIntent)).toEqual(["family"]);
    await expect.poll(() => groupSizes).toEqual(["family"]);
  });

  test("a link that names a couple opens with Couple picked", async ({ page }) => {
    await isolate(page);
    await page.goto("/trips/new?who=couple");
    await expect(page.getByRole("button", { name: "Couple", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Just me", exact: true })).toHaveAttribute("aria-pressed", "false");
  });
});
