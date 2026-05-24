import { test, expect } from "@playwright/test";

/**
 * Notification preferences + unsubscribe — public contract checks.
 *
 * The preference center is auth-gated (page redirects, API returns
 * empty for anonymous). We can verify:
 *   - /api/notifications/email-log returns empty 200 for anonymous
 *   - /api/unsubscribe rejects malformed tokens with 400
 *   - /api/unsubscribe tampering detection (HMAC mismatch → 400)
 *   - /unsubscribe page renders without crash for invalid tokens
 *
 * What requires a seeded user (defer):
 *   - End-to-end opt-out via tokenized link → DB flip → re-send is skipped
 *   - Preference center toggles round-trip via PATCH /api/profile
 */

test.describe("Email log API — anonymous contract @prod", () => {
  test("GET /api/notifications/email-log returns empty list for anonymous", async ({
    request,
  }) => {
    const res = await request.get("/api/notifications/email-log");
    expect(res.status()).toBe(200);
    const body = await res.json();
    const payload = body?.data ?? body;
    expect(payload).toHaveProperty("entries");
    expect(Array.isArray(payload.entries)).toBe(true);
    expect(payload.entries.length).toBe(0);
  });
});

test.describe("Unsubscribe API — token validation @prod", () => {
  test("POST /api/unsubscribe without token returns 400", async ({
    request,
  }) => {
    const res = await request.post("/api/unsubscribe", { data: {} });
    expect(res.status()).toBe(400);
  });

  test("POST /api/unsubscribe with malformed token returns 400", async ({
    request,
  }) => {
    const res = await request.post("/api/unsubscribe", {
      data: { token: "not.a.valid.token" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/unsubscribe with tampered HMAC returns 400", async ({
    request,
  }) => {
    // Plausible-looking but unsigned payload — `eyJ` is base64url for
    // `{"...`. The signature half is random; HMAC verification must
    // fail since we don't have the secret.
    const res = await request.post("/api/unsubscribe", {
      data: {
        token:
          "eyJ1IjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIiwiayI6ImFsbCIsImUiOjk5OTk5OTk5OTl9.dGFtcGVyZWQtaG1hYy12YWx1ZQ",
      },
    });
    expect(res.status()).toBe(400);
  });

  test("GET /api/unsubscribe without token returns 400", async ({
    request,
  }) => {
    const res = await request.get("/api/unsubscribe");
    expect(res.status()).toBe(400);
  });

  test("/unsubscribe page renders for invalid token (no crash)", async ({
    page,
  }) => {
    await page.goto("/unsubscribe?token=invalid");
    // The page should show the "Couldn't verify" UI, not 500.
    await expect(page.locator("body")).toContainText(
      /verify|expired|notification settings/i
    );
  });
});

test.describe("Preference center page — gating @prod", () => {
  test("/profile/notifications redirects anonymous to login", async ({
    page,
  }) => {
    const response = await page.goto("/profile/notifications", {
      waitUntil: "domcontentloaded",
    });
    // Either an explicit redirect status, or Next's middleware-side
    // server redirect lands us on /auth/login. Accept both.
    const url = page.url();
    expect(
      url.includes("/auth/login") || (response?.status() ?? 0) >= 300,
      `expected login redirect; landed on ${url} (status ${response?.status()})`
    ).toBeTruthy();
  });
});
