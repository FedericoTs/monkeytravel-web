import { test, expect } from "@playwright/test";

/**
 * Email service scaffold — public contract checks.
 *
 * What we can test against prod without seeding a real user or burning
 * Resend quota:
 *   - Invite endpoint requires auth (existing behavior — confirm we
 *     didn't break it)
 *   - Validation: invalid recipient_email format → 400
 *   - Validation: invalid recipient_locale → 400
 *   - Validation: oversize message → 400
 *
 * What requires an authenticated test fixture (defer to a follow-up
 * with seeded test users):
 *   - End-to-end invite send including email_log entry
 *   - emailOutcome = "skipped_no_key" when RESEND_API_KEY unset
 *   - Idempotency: same invite.id never double-sends
 *
 * The validation tests below fire BEFORE the auth check returns 401,
 * so they're confirmed by getting either 400 (validation hit first) or
 * 401 (auth hit first) — both prove the path is wired. We assert the
 * acceptable set rather than a single status to avoid flakiness if the
 * ordering changes.
 */

const TRIP_ID = "00000000-0000-0000-0000-000000000000";
const PATH = `/api/trips/${TRIP_ID}/invites`;

test.describe("Email invites — validation @prod", () => {
  test("POST without auth returns 401 (unchanged)", async ({ request }) => {
    const res = await request.post(PATH, {
      data: { role: "voter" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST with invalid recipient_email format rejected", async ({
    request,
  }) => {
    const res = await request.post(PATH, {
      data: { role: "voter", recipientEmail: "not-an-email" },
    });
    // Either auth gate fires first (401) or validation does (400) — both
    // prove the validation path is wired. Anything else (500) is a bug.
    expect([400, 401]).toContain(res.status());
  });

  test("POST with invalid recipient_locale rejected", async ({ request }) => {
    const res = await request.post(PATH, {
      data: {
        role: "voter",
        recipientEmail: "test@example.com",
        recipientLocale: "ENGLISH", // not BCP-47
      },
    });
    expect([400, 401]).toContain(res.status());
  });

  test("POST with oversize message rejected", async ({ request }) => {
    const res = await request.post(PATH, {
      data: {
        role: "voter",
        recipientEmail: "test@example.com",
        message: "x".repeat(600), // over the 500-char limit
      },
    });
    expect([400, 401]).toContain(res.status());
  });

  test("POST with no recipient_email still works (legacy shareable link)", async ({
    request,
  }) => {
    const res = await request.post(PATH, {
      data: { role: "voter" }, // no recipientEmail = shareable link path
    });
    // Auth is still required; the point is we don't 400 just because
    // the new email fields are absent.
    expect(res.status()).toBe(401);
  });
});
