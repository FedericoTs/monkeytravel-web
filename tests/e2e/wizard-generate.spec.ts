import { test, expect, type Locator, type Page } from "@playwright/test";
import { stubGeneration, stubPlan, stubPlannerOutage } from "./generation-stub";

/**
 * A signed-out planner goes from a one-tap destination to a generated trip:
 * the pick fills the place and pencils in five days, step 2 takes a vibe,
 * Generate streams the plan into the result view, and Save asks for an
 * account. Start Over clears every answer, so the next plan starts fresh, and
 * after a second plan, switching back to the first in the session tray brings
 * back that plan's own answers. The generation is answered by the test
 * (generation-stub.ts), so no model is called.
 *
 * Nothing leaves the page that could write or bill: keeping the plan, Start
 * Over's feedback, analytics beacons, photos and maps are stubbed or blocked.
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

/** Asks for the trip `pick` starts, with `mustDo` as its one wish, and returns the place. */
async function askForPick(page: Page, pick: Locator, mustDo: string): Promise<string> {
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
  const wish = page.locator("#must-do-input");
  await wish.fill(mustDo);
  await wish.press("Enter");
  await generate.click();
  return place!;
}

/** Plans the trip `pick` starts, with `mustDo` as its one wish, and returns the place. */
async function planPick(page: Page, pick: Locator, mustDo: string): Promise<string> {
  const place = await askForPick(page, pick, mustDo);
  await expect(page.getByRole("heading", { level: 1, name: place })).toBeVisible({ timeout: 30_000 });
  return place;
}

/** The draft the wizard keeps for the way back from signing in. */
async function storedDraft(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("monkeytravel-itinerary-draft");
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  });
}

test.describe("wizard: planning a trip", () => {
  test("a one-tap pick is generated, shown and kept behind the account wall", async ({ page }) => {
    await isolate(page);
    // After the catch-all: the last route registered is asked first.
    const generation = await stubGeneration(page);
    // The funnel rows the wizard sends (wizard_step_events), in order.
    const funnel: { step: string; [field: string]: unknown }[] = [];
    await page.route("**/api/wizard-event", (route) => {
      funnel.push(route.request().postDataJSON());
      return route.fulfill({ status: 204, body: "" });
    });

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

    await page.getByRole("button", { name: /^Continue/ }).click();
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
    // The plan stays readable behind the box: on a phone the box sits at the
    // bottom, with the top of the screen left to the plan.
    const viewport = page.viewportSize()!;
    if (viewport.width < 640) {
      const box = await accountWall.first().getByRole("heading", { name: "Keep this plan" }).boundingBox();
      expect(box!.y).toBeGreaterThan(viewport.height * 0.25);
    }

    // One row per stage, each with the trip's shape; the dwell heartbeat on
    // step 1 depends on time and is left out. No `abandoned`: the planner
    // generated.
    await expect
      .poll(() => funnel.map((e) => e.step).filter((step) => step !== "step1_heartbeat"))
      .toEqual([
        "step_1_destination_dates",
        "step_2_vibes",
        "generating",
        "result",
        "first_value",
        "save_clicked",
        "save_blocked_anon",
        "auth_modal_shown",
      ]);
    const row = (step: string) => funnel.find((e) => e.step === step);
    const shape = { destination: place, group_size: "unspecified", backpacker_mode: false, locale: "en", front_door: "wizard" };
    expect(row("step_1_destination_dates")).toMatchObject({ locale: "en", front_door: "wizard" });
    for (const step of ["step_2_vibes", "generating", "result", "save_clicked"]) {
      expect(row(step), step).toMatchObject({ ...shape, duration_days: 5 });
    }
    expect(row("first_value")).toMatchObject({ destination: place, duration_days: 5, locale: "en" });
    expect(row("save_blocked_anon")).toMatchObject(shape);
    expect(row("auth_modal_shown")).toMatchObject({ destination: place, front_door: "wizard" });
  });

  test("switching back to an earlier plan in the session tray brings back its own answers", async ({ page }) => {
    await isolate(page);
    // Start Over reports why the plan was dropped; nothing is stored here.
    await page.route("**/api/trips/*/deletion-feedback", (route) => route.fulfill({ status: 204, body: "" }));
    await stubGeneration(page);

    await page.goto("/trips/new");
    const essentialOnly = page.getByRole("button", { name: /essential only/i });
    await essentialOnly
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => essentialOnly.click())
      .catch(() => {});

    const picks = page.getByRole("group", { name: "Popular right now" }).getByRole("button");
    const first = await planPick(page, picks.nth(0), "Lunch at the market");
    await page.getByRole("button", { name: "Start Over" }).first().click();
    await page.getByLabel("What didn't work?").selectOption("wrong_destination");
    await page.getByRole("button", { name: "Start Fresh" }).click();
    const second = await planPick(page, picks.nth(1), "Sunset at the viewpoint");
    expect(second).not.toBe(first);

    const city = first.split(",")[0];
    await page.getByRole("button", { name: new RegExp(`^${city} · `) }).click();
    await expect(page.getByRole("heading", { level: 1, name: first })).toBeVisible();
    // What is on screen is what a sign-in would bring back: the first plan's wish, not the second's.
    await expect
      .poll(async () => {
        const draft = await storedDraft(page);
        return draft && { destination: draft.destination, mustDos: draft.mustDos };
      })
      .toEqual({ destination: first, mustDos: ["Lunch at the market"] });
  });

  test("Start Over begins the next plan from a fresh form", async ({ page }) => {
    await isolate(page);
    await page.route("**/api/trips/*/deletion-feedback", (route) => route.fulfill({ status: 204, body: "" }));
    await stubGeneration(page);
    // Who was coming, as each generation reported it to the funnel.
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

    const withFriends = page.getByRole("button", { name: "With friends" });
    await withFriends.click();
    await expect(withFriends).toHaveAttribute("aria-pressed", "true");
    const picks = page.getByRole("group", { name: "Popular right now" }).getByRole("button");
    await planPick(page, picks.nth(0), "Lunch at the market");
    await page.getByRole("button", { name: "Start Over" }).first().click();
    await page.getByLabel("What didn't work?").selectOption("wrong_destination");
    await page.getByRole("button", { name: "Start Fresh" }).click();

    await expect(withFriends).toHaveAttribute("aria-pressed", "false");
    await planPick(page, picks.nth(1), "Sunset at the viewpoint");
    await expect.poll(() => groupSizes).toEqual(["group", "unspecified"]);
  });
});

test.describe("wizard: with the planner out of service", () => {
  test("says so, offers ready-made trips, and a later try still plans the trip", async ({ page }) => {
    await isolate(page);
    await stubPlannerOutage(page);

    await page.goto("/trips/new");
    const essentialOnly = page.getByRole("button", { name: /essential only/i });
    await essentialOnly
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => essentialOnly.click())
      .catch(() => {});

    const place = await askForPick(page, page.getByRole("group", { name: "Popular right now" }).getByRole("button").nth(0), "Lunch at the market");
    await expect(page.getByText(/Our trip planner is down right now/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("temporarily unavailable")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Or browse ready-made trips" })).toHaveAttribute("href", /\/templates$/);

    // The planner is back: the answers are still there, and the try works.
    await stubGeneration(page);
    await page.getByRole("button", { name: "Try Again" }).click();
    await expect(page.getByRole("heading", { level: 1, name: place })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Our trip planner is down right now/)).toHaveCount(0);
  });
});

test.describe("wizard: planning a trip on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the bottom bar's Start Over is named, and starts over", async ({ page }) => {
    await isolate(page);
    await page.route("**/api/trips/*/deletion-feedback", (route) => route.fulfill({ status: 204, body: "" }));
    await stubGeneration(page);

    await page.goto("/trips/new");
    const essentialOnly = page.getByRole("button", { name: /essential only/i });
    await essentialOnly
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => essentialOnly.click())
      .catch(() => {});

    const picks = page.getByRole("group", { name: "Popular right now" }).getByRole("button");
    await planPick(page, picks.nth(0), "Lunch at the market");
    // The header's Start Over is hidden at this width: this one is behind the bar's More.
    await page.locator('button[aria-controls="result-more"]').click();
    await page.getByRole("button", { name: "Start Over" }).click();
    await page.getByLabel("What didn't work?").selectOption("wrong_destination");
    await page.getByRole("button", { name: "Start Fresh" }).click();
    await expect(page.getByRole("group", { name: "Popular right now" })).toBeVisible();
  });
});
