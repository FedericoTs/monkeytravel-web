import { test, expect, type Page } from "@playwright/test";
import draft from "./fixtures/wizard-draft-paris.json";

/**
 * A plan a signed-out planner kept comes back from its private link
 * (#plan=<token>), on arrival or pasted into the open planner, and from step
 * 1's list of the plans this browser kept. The link leaves the address bar
 * before anything is sent, the plan is shown with the answers it was made
 * with, and it keeps its own link instead of being kept again. A link whose
 * plan has expired says so, and the list forgets it.
 *
 * The plan is the restored-draft fixture, served by the test in place of
 * /api/plans, which is never written to. Analytics beacons, photos and maps
 * are stubbed or blocked.
 */

const LINKED = "L".repeat(22);
const LISTED = "M".repeat(22);
const EXPIRED = "X".repeat(22);
const EXPIRES = "2099-01-01T00:00:00.000Z";
const KEPT_KEY = "mt_kept_plans";

// Answers of its own, so the form can be seen to take them.
const plan = {
  destination: draft.destination,
  startDate: draft.startDate,
  endDate: draft.endDate,
  itinerary: draft.generatedItinerary,
  pace: "relaxed",
  vibes: ["cultural", "foodie"],
  budgetTier: "premium",
  travelStyle: "classic",
  tripIntent: "solo",
  flexibleDates: true,
  mustDos: ["Musée d'Orsay at opening"],
  dietary: ["vegetarian"],
};
const ANSWERS = [
  "destination", "startDate", "endDate", "pace", "vibes", "budgetTier",
  "travelStyle", "tripIntent", "flexibleDates", "mustDos", "dietary",
] as const;

/** A plan as step 1's list remembers it. */
function entry(token: string, destination: string, key?: string) {
  return {
    token,
    ...(key ? { key } : {}),
    destination,
    startDate: plan.startDate,
    endDate: plan.endDate,
    dayCount: plan.itinerary.days.length,
    expiresAt: EXPIRES,
  };
}

/** Serves the plan (EXPIRED is gone), and records what the page asked of /api/plans. */
async function isolate(page: Page) {
  const plans = { reads: [] as string[], writes: [] as string[] };
  await page.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (/(googletagmanager|google-analytics|posthog|buildhop)\.|^maps\.googleapis\.com$/.test(url.host)) {
      return route.abort();
    }
    if (url.pathname === "/api/plans" || url.pathname.startsWith("/api/plans/")) {
      if (req.method() !== "GET") {
        plans.writes.push(`${req.method()} ${url.pathname}`);
        return route.fulfill({ status: 503, body: "" });
      }
      const token = url.pathname.split("/")[3];
      plans.reads.push(token);
      return token === EXPIRED
        ? route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not found" }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plan, expiresAt: EXPIRES }) });
    }
    if (/^\/api\/(wizard-event|consent-event|page-engaged|page-view|session)/.test(url.pathname)) {
      return route.fulfill({ status: 204, body: "" });
    }
    if (/^\/api\/(places|images|img)(\/|$)/.test(url.pathname) || req.resourceType() === "image") {
      return route.abort();
    }
    return route.continue();
  });
  return plans;
}

/** Every request other than the plan's own read that carries `token`. */
function watchFor(page: Page, token: string): string[] {
  const carried: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === `/api/plans/${token}`) return;
    if ((req.url() + (req.postData() ?? "")).includes(token)) carried.push(req.url());
  });
  return carried;
}

/** Puts `entries` in step 1's list, once per tab. */
async function seedList(page: Page, entries: ReturnType<typeof entry>[]) {
  await page.addInitScript(
    ({ key, value }) => {
      if (sessionStorage.getItem("e2e-kept-seeded")) return;
      localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem("e2e-kept-seeded", "1");
    },
    { key: KEPT_KEY, value: entries }
  );
}

async function keptList(page: Page): Promise<unknown[]> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), KEPT_KEY);
}

/** The answers in the draft the wizard keeps for the way back from signing in. */
async function draftAnswers(page: Page): Promise<Record<string, unknown> | null> {
  const stored = await page.evaluate(() => localStorage.getItem("monkeytravel-itinerary-draft"));
  if (!stored) return null;
  const parsed = JSON.parse(stored) as Record<string, unknown>;
  return Object.fromEntries(ANSWERS.map((k) => [k, parsed[k]]));
}

async function dismissConsent(page: Page) {
  const essentialOnly = page.getByRole("button", { name: /essential only/i });
  await essentialOnly
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => essentialOnly.click())
    .catch(() => {});
}

async function expectPlanShown(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });
  for (const day of plan.itinerary.days) {
    await expect(page.getByRole("heading", { name: `Day ${day.day_number}`, exact: true })).toBeVisible();
  }
}

test.describe("wizard: a kept plan", () => {
  test.beforeEach(async ({ page }) => {
    // What Copy link puts on the clipboard.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            (window as unknown as { copiedLink?: string }).copiedLink = text;
          },
        },
      });
    });
  });

  test("its link opens the plan with its answers, and the plan keeps that link", async ({ page }) => {
    const plans = await isolate(page);
    const carried = watchFor(page, LINKED);

    await page.goto(`/trips/new#plan=${LINKED}`);
    await expectPlanShown(page);
    expect(new URL(page.url()).hash, "the link leaves the address bar").toBe("");
    // The answers are what a sign-in would bring back.
    await expect.poll(() => draftAnswers(page)).toEqual(Object.fromEntries(ANSWERS.map((k) => [k, plan[k]])));

    // Not kept again: Copy link copies the link it came from.
    await page.getByRole("button", { name: "Copy link" }).filter({ visible: true }).first().click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { copiedLink?: string }).copiedLink))
      .toBe(new URL(`/trips/new#plan=${LINKED}`, page.url()).href);
    expect(plans.reads).toEqual([LINKED]);
    expect(plans.writes).toEqual([]);
    // Remembered here, without a key: this browser did not keep it.
    expect(await keptList(page)).toEqual([entry(LINKED, plan.destination)]);
    expect(carried, "the token reached a request other than the plan's own read").toEqual([]);
  });

  test("a link pasted into the open planner opens its plan", async ({ page }) => {
    const plans = await isolate(page);
    await page.goto("/trips/new");
    await dismissConsent(page);
    await expect(page.getByRole("group", { name: "Popular right now" })).toBeVisible({ timeout: 30_000 });

    await page.evaluate((token) => {
      window.location.hash = `plan=${token}`;
    }, LINKED);
    await expectPlanShown(page);
    expect(new URL(page.url()).hash).toBe("");
    expect(plans.reads).toEqual([LINKED]);
  });

  test("step 1's list opens a plan this browser kept, which stays this browser's to change", async ({ page }) => {
    const ownKey = "k".repeat(43);
    await seedList(page, [entry(LISTED, plan.destination, ownKey)]);
    const plans = await isolate(page);
    // Held until the list has been seen waiting on it (the last route registered is asked first).
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/plans/${LISTED}`, async (route) => {
      await held;
      await route.fallback();
    });

    await page.goto("/trips/new");
    await dismissConsent(page);
    const listed = page.getByRole("region", { name: "Your plans" }).getByRole("button", { name: /^Paris/ });
    await listed.click({ timeout: 30_000 });
    await expect(listed).toHaveAttribute("aria-busy", "true");
    await expect(listed).toBeDisabled();
    release();

    await expectPlanShown(page);
    await expect(page.getByRole("button", { name: "Copy link" }).filter({ visible: true }).first()).toBeVisible();
    expect(plans.reads).toEqual([LISTED]);
    expect(plans.writes).toEqual([]);
    expect(await keptList(page)).toEqual([entry(LISTED, plan.destination, ownKey)]);
  });

  test("an expired link says so, and the list forgets its plan", async ({ page }) => {
    await seedList(page, [entry(EXPIRED, "Lisbon, Portugal", "e".repeat(43)), entry(LISTED, plan.destination)]);
    const plans = await isolate(page);

    await page.goto(`/trips/new#plan=${EXPIRED}`);
    await expect(page.getByText("That plan's link has expired.", { exact: false })).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).hash).toBe("");
    const list = page.getByRole("region", { name: "Your plans" });
    await expect(list.getByRole("button", { name: /^Paris/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /^Lisbon/ })).toHaveCount(0);
    expect(await keptList(page)).toEqual([entry(LISTED, plan.destination)]);
    expect(plans.reads).toEqual([EXPIRED]);
  });
});
