import { test, expect } from "@playwright/test";
import { isolate } from "./wizard-draft";

/**
 * A month's guide offers each place it ranks to the planner, that month: the
 * link under the place's heading opens the planner on the place with dates
 * pencilled in that month, and the press is counted.
 */

test.describe("plan a place from a month's guide", () => {
  test.beforeEach(async ({ page }) => {
    await isolate(page);
  });

  test("the link under a place opens the planner on it, in that month", async ({ page }) => {
    // The planner pencils in the next March at least a week away.
    await page.clock.setFixedTime(new Date("2026-11-21T10:00:00"));
    await page.route("**/api/funnel-event", (route) => route.fulfill({ status: 204, body: "" }));
    // A country typed for five days or more may be offered a route: not this test's question.
    await page.route("**/api/wizard/route-plan", (route) => route.fulfill({ status: 503, body: "" }));

    await page.goto("/blog/where-to-go-in-march");
    await expect(page.getByRole("link", { name: "Plan this trip for March" })).toHaveCount(12);
    const underJapan = page.locator("h2[id^='1-japan'] + p.plan-place a");
    await expect(underJapan).toHaveText("Plan this trip for March");

    const counted = page.waitForRequest((r) => r.url().endsWith("/api/funnel-event") && r.method() === "POST");
    await underJapan.click();
    expect((await counted).postDataJSON()).toEqual({ event_type: "plan_own_clicked", destination: "Japan", surface: "article_place" });

    await expect(page).toHaveURL(/\/trips\/new\?destination=Japan&month=3&from=place$/);
    await expect(page.locator("input[role='combobox']").first()).toHaveValue("Japan");
    await expect(page.getByRole("button", { name: /: Mon, Mar 15 – Fri, Mar 19$/ })).toBeVisible();
    await expect(page.getByText("Flexible dates — you can fine-tune anytime")).toBeVisible();
  });

  test("in Spanish it opens the Spanish planner, on the place as the page names it", async ({ page }) => {
    await page.goto("/es/blog/where-to-go-in-march");
    const underJapan = page.locator("h2[id^='1-japon'] + p.plan-place a");
    await expect(underJapan).toHaveText("Planifica este viaje para marzo");
    await expect(underJapan).toHaveAttribute("href", "/es/trips/new?destination=Jap%C3%B3n&month=3&from=place");
  });

  test("a list of places with no month links each one, with no month, and counts the press", async ({ page }) => {
    await page.route("**/api/funnel-event", (route) => route.fulfill({ status: 204, body: "" }));
    await page.goto("/blog/where-to-spend-christmas");
    const links = page.locator("p.plan-place a");
    expect(await links.count()).toBeGreaterThanOrEqual(13);
    const first = links.first();
    await expect(first).toHaveText("Plan this trip");
    const href = (await first.getAttribute("href")) ?? "";
    expect(href).toMatch(/^\/trips\/new\?destination=[^&]+&from=place$/);
    const counted = page.waitForRequest((r) => r.url().endsWith("/api/funnel-event") && r.method() === "POST");
    await first.click();
    expect((await counted).postDataJSON()).toMatchObject({ event_type: "plan_own_clicked", surface: "article_place" });
  });

  test("the planner links around the guide open on its month too, and a guide to one city has none", async ({ page }) => {
    await page.goto("/blog/where-to-go-in-october");
    const months = await page.locator("a[href*='/trips/new?']").evaluateAll((links) =>
      links.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get("month")),
    );
    expect(months.length).toBeGreaterThan(12);
    expect(new Set(months)).toEqual(new Set(["10"]));

    await page.goto("/blog/bangkok-5-day-itinerary");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("p.plan-place")).toHaveCount(0);
  });
});
