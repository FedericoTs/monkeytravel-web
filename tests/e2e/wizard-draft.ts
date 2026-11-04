import { expect, type Page } from "@playwright/test";
import draft from "./fixtures/wizard-draft-paris.json";

const DRAFT_KEY = "monkeytravel-itinerary-draft";

/** Blocks or stubs what would write or bill: keeping the plan, analytics beacons, photos and maps. */
export async function isolate(page: Page) {
  await page.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (/(googletagmanager|google-analytics|posthog|buildhop)\.|^maps\.googleapis\.com$/.test(url.host)) {
      return route.abort();
    }
    if (url.pathname === "/api/plans" && req.method() === "POST") {
      return route.fulfill({ status: 503, body: "" });
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

/** Restores the Paris draft, the first three days of the public template, onto the result view. */
export async function restoreDraft(page: Page) {
  await page.addInitScript(
    ({ key, value }) => {
      if (sessionStorage.getItem("e2e-draft-seeded")) return;
      localStorage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now() }));
      sessionStorage.setItem("e2e-draft-seeded", "1");
    },
    { key: DRAFT_KEY, value: draft }
  );
  await page.goto("/trips/new");
  const essentialOnly = page.getByRole("button", { name: /essential only/i });
  await essentialOnly
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => essentialOnly.click())
    .catch(() => {});
  await page.getByRole("button", { name: "Restore Trip" }).click({ timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });
}

/** The draft the wizard keeps, as it stands now. */
export async function storedDraft(page: Page): Promise<{
  startDate: string;
  endDate: string;
  generatedItinerary: {
    days: { date: string; activities: { name: string; image_url?: string }[] }[];
    trip_summary: { total_estimated_cost: number };
  };
}> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), DRAFT_KEY);
}
