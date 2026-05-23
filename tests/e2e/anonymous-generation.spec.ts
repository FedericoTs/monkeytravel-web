import { test, expect } from "@playwright/test";

/**
 * Anonymous trip generation — the critical conversion path.
 *
 * Pre-2026-05-23: clicking Generate forced a signup modal. 75% of users
 * dropped here. The fix: anonymous generation works end-to-end, auth wall
 * only fires at Save.
 *
 * These tests run against the live URL (BASE_URL) so they double as
 * post-deploy smoke checks. Tag @prod = safe to hit production.
 */

test.describe("anonymous trip generation @prod", () => {
  test("API: POST /api/ai/generate accepts anonymous + returns itinerary", async ({
    request,
  }) => {
    const res = await request.post("/api/ai/generate", {
      data: {
        destination: "Lisbon, Portugal",
        startDate: "2026-07-15",
        endDate: "2026-07-17",
        vibes: ["foodie"],
        budgetTier: "balanced",
        pace: "moderate",
      },
    });

    expect(res.status(), "anonymous generation must succeed").toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.itinerary).toBeDefined();
    expect(body.itinerary.destination.name).toMatch(/lisbon/i);
    expect(body.itinerary.days.length).toBeGreaterThanOrEqual(2);
    expect(body.itinerary.days[0].activities.length).toBeGreaterThanOrEqual(1);
  });

  test("API: sets mt_anon httpOnly cookie", async ({ request }) => {
    const res = await request.post("/api/ai/generate", {
      data: {
        destination: "Rome, Italy",
        startDate: "2026-08-01",
        endDate: "2026-08-02",
        vibes: ["cultural"],
      },
    });
    expect(res.status()).toBe(200);

    const setCookie = res.headers()["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/mt_anon/);
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  test("API: returns 400 on missing required fields", async ({ request }) => {
    const res = await request.post("/api/ai/generate", { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/destination|required/i);
  });

  test("API: returns 400 on invalid date range", async ({ request }) => {
    const res = await request.post("/api/ai/generate", {
      data: {
        destination: "Paris",
        startDate: "2026-08-10",
        endDate: "2026-08-05", // end before start
        vibes: ["foodie"],
      },
    });
    expect(res.status()).toBe(400);
  });

  test("UI: /trips/new renders the wizard for anonymous visitor", async ({
    page,
  }) => {
    await page.goto("/trips/new");
    // Wait for either the destination input or the form root
    await expect(
      page.getByRole("textbox").first()
    ).toBeVisible({ timeout: 15_000 });
    // The signup modal should NOT be present on initial load
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });
});

test.describe("anonymous rate limit @prod", () => {
  /**
   * 3rd generation in a fresh cookie window should be rejected with a
   * friendly message that points to /auth/signup. Use a brand-new
   * browser context so the cookie counter starts at 0.
   *
   * Skipped on prod by default to avoid burning AI quota. Enable with
   * RUN_RATE_LIMIT=1 npx playwright test --grep "rate limit"
   */
  test.skip(
    !process.env.RUN_RATE_LIMIT,
    "set RUN_RATE_LIMIT=1 to exercise the live AI quota"
  );

  test("3rd request returns 429 with signup CTA", async ({ browser }) => {
    const ctx = await browser.newContext();
    const req = ctx.request;
    const body = {
      destination: "Madrid",
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      vibes: ["foodie"],
    };
    const r1 = await req.post("/api/ai/generate", { data: body });
    const r2 = await req.post("/api/ai/generate", { data: body });
    const r3 = await req.post("/api/ai/generate", { data: body });

    expect(r1.status()).toBe(200);
    expect(r2.status()).toBe(200);
    expect(r3.status()).toBe(429);
    const body3 = await r3.json();
    expect(body3.error || body3.message).toMatch(/sign up|sign-up|signup/i);

    await ctx.close();
  });
});
