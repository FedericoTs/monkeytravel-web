import { test, expect } from "@playwright/test";

/**
 * Invite-acceptance flow — RLS-lockdown coverage (task #186).
 *
 * Context
 * -------
 * Commit f769dc4 (task #170) closed a P0 security hole: the trip_invites
 * table was readable by anon via `USING (true)` policies. The fix dropped
 * those policies and routed both the public invite-preview page and
 * /api/invites/[token] through a SECURITY DEFINER RPC
 * (`get_invite_by_token`) that returns at most one row, and only for
 * invites that are still usable (is_active=true, expires_at>now(),
 * use_count<max_uses). The POST path additionally enforces a
 * recipient_email match against the authenticated user's email
 * (RECIPIENT_MISMATCH, status 403) — the bug-bounty fix from 2026-05-24.
 *
 * What this spec verifies (contract-level, no DB seeding required):
 *   1. /invite/[bogus-token] renders the invalid-invite shell, not a 500
 *      (the RPC collapses "not found", "revoked", "expired", and
 *       "exhausted" all to the same NOT_FOUND result — the page must
 *       render the error UI cleanly).
 *   2. GET /api/invites/[token] never 500s for malformed input — it must
 *      return 400 (format check) or 404 (RPC miss).
 *   3. POST /api/invites/[token] never 500s, even with no body. It should
 *      400 (format check fires before parsing) or 401 (auth check fires
 *      first). 500 here would indicate either an unhandled JSON parse
 *      throw OR an RPC mis-call — both are regression bugs.
 *   4. POST with a well-formed but bogus token returns 401 (auth gate
 *      fires before RPC lookup, so we don't leak token existence).
 *
 * What requires seeded fixtures (and is therefore SKIPPED unless the
 * env vars are present):
 *   - VALID_INVITE_TOKEN: a real, active, unexpired token to test the
 *     anon preview render + RECIPIENT_MISMATCH path. Provide when running
 *     a deeper sweep after manually creating one in dev/staging.
 *   - EXPIRED_INVITE_TOKEN: a real token whose expires_at < now() — the
 *     RPC will return no row, so the page should render the invalid
 *     state (NOT a dedicated "expired" panel — see migration comment).
 *
 * This spec is intentionally contract-shaped (HTTP status assertions,
 * not pixel diffs) so it can run against prod (@prod) without seeding
 * users or burning quota.
 */

// A token shaped to satisfy the format check (alphanumeric + `-_`, ≥8 chars)
// but vanishingly unlikely to collide with a real invite row. We don't use
// the prod RNG here — the point is the RPC returns no row, not that the
// token is cryptographically novel.
const BOGUS_TOKEN = "bogus_token_for_e2e_does_not_exist_zzzzzzzz";

// A token that FAILS format validation (too short, < 8 chars). Used to
// hit the pre-RPC branch and confirm we return 400, not 500 or 404.
const MALFORMED_TOKEN = "short";

test.describe("invite RLS lockdown — public surface @prod", () => {
  test("GET /api/invites/[bogus-token] returns 404 (not 500)", async ({
    request,
  }) => {
    const res = await request.get(`/api/invites/${BOGUS_TOKEN}`);
    // The RPC filters out non-usable invites; an unknown token collapses
    // to NOT_FOUND. The hard requirement is NOT 500 — that would mean the
    // RPC path threw unhandled.
    expect(res.status(), "RPC miss must surface as 404, never 500").toBe(404);

    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test("GET /api/invites/[malformed] returns 400 (format check)", async ({
    request,
  }) => {
    const res = await request.get(`/api/invites/${MALFORMED_TOKEN}`);
    expect(res.status()).toBe(400);
  });

  test("POST /api/invites/[bogus-token] with no body returns 400 or 401 (NEVER 500)", async ({
    request,
  }) => {
    // CRITICAL CHECK (task brief): the POST handler reads context.params
    // and runs format + auth gates BEFORE attempting to parse a body, so
    // sending no body should never reach a parser. If this test starts
    // returning 500, someone reordered the handler and broke the contract.
    const res = await request.post(`/api/invites/${BOGUS_TOKEN}`);
    expect(
      [400, 401],
      `POST without body must not 500; got ${res.status()}`
    ).toContain(res.status());
  });

  test("POST /api/invites/[malformed] returns 400 (format check)", async ({
    request,
  }) => {
    // Format check runs before auth — so a too-short token should 400
    // even unauthenticated. This protects the RPC from junk input AND
    // saves an auth round-trip.
    const res = await request.post(`/api/invites/${MALFORMED_TOKEN}`);
    expect(res.status()).toBe(400);
  });

  test("POST /api/invites/[well-formed-bogus] anon returns 401", async ({
    request,
  }) => {
    // Auth gate fires before the RPC lookup. This is the correct order
    // because (a) it doesn't leak token existence to anon and (b) it
    // avoids a needless DB round-trip for unauth'd requests.
    const res = await request.post(`/api/invites/${BOGUS_TOKEN}`, {
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test("UI: /invite/[bogus-token] renders the invalid-state page, not a crash", async ({
    page,
  }) => {
    // The page uses the same RPC. A NOT_FOUND result must render the
    // invalid-invite shell with the CTA back to homepage — NOT a 500
    // Next.js error boundary, NOT a blank page.
    const response = await page.goto(`/invite/${BOGUS_TOKEN}`);
    // The page itself should render 200 — the error state is part of
    // normal rendering, not an HTTP failure.
    expect(response?.status()).toBe(200);

    // Should show the "Create Your Own Trip" CTA that lives in the
    // error branch of app/[locale]/invite/[token]/page.tsx. Match the
    // English copy; the page resolves to /en for the default locale.
    await expect(
      page.getByRole("link", { name: /create your own trip/i })
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("invite RLS lockdown — seeded fixtures (skipped without env)", () => {
  // These tests only run when the caller provides real tokens against a
  // staging DB. They cover the seeded paths that prove the SECURITY
  // DEFINER + recipient_email enforcement work end-to-end. Without
  // these env vars we skip — never fail — because the workflow doesn't
  // assume a fixture-seeding helper is available yet.
  test.skip(
    !process.env.VALID_INVITE_TOKEN,
    "set VALID_INVITE_TOKEN to a real active token to run this suite"
  );

  const VALID_TOKEN = process.env.VALID_INVITE_TOKEN || "";

  test("GET /api/invites/[valid-token] as anon returns invite preview", async ({
    request,
  }) => {
    const res = await request.get(`/api/invites/${VALID_TOKEN}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.invite).toBeDefined();
    expect(body.invite.token).toBe(VALID_TOKEN);
    expect(body.trip).toBeDefined();
    expect(body.trip.title).toBeTruthy();
    // The RPC is the only public read path now. If this 200s, the RPC is
    // wired AND the table's row-level lockdown didn't accidentally block
    // the function (SECURITY DEFINER bypasses RLS for its own SELECT).
  });

  test("UI: /invite/[valid-token] renders preview without auth errors", async ({
    page,
  }) => {
    const response = await page.goto(`/invite/${VALID_TOKEN}`);
    expect(response?.status()).toBe(200);
    // Should NOT show the invalid-invite error CTA. Instead, should show
    // either the "Join Trip" button or the sign-in CTA — both are
    // preview-page elements, not error-page elements.
    await expect(
      page.getByRole("link", { name: /create your own trip/i })
    ).toHaveCount(0);
  });

  // RECIPIENT_MISMATCH path requires an authenticated session with an
  // email that differs from the invite's recipient_email. That needs
  // either a Supabase test-user helper or a stored auth state file. We
  // describe the assertion shape so a future iteration can wire it up
  // when those fixtures land.
  test.skip(
    !process.env.MISMATCHED_AUTH_STATE,
    "set MISMATCHED_AUTH_STATE=path/to/storageState.json with a logged-in user whose email != invite recipient"
  );

  test("POST /api/invites/[recipient-scoped-token] as mismatched user returns 403 RECIPIENT_MISMATCH", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      storageState: process.env.MISMATCHED_AUTH_STATE,
    });
    const res = await ctx.request.post(`/api/invites/${VALID_TOKEN}`, {
      data: {},
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("RECIPIENT_MISMATCH");
    await ctx.close();
  });
});

test.describe("invite RLS lockdown — expired-token fixture (skipped without env)", () => {
  test.skip(
    !process.env.EXPIRED_INVITE_TOKEN,
    "set EXPIRED_INVITE_TOKEN to a real expired token to run this check"
  );

  const EXPIRED_TOKEN = process.env.EXPIRED_INVITE_TOKEN || "";

  test("GET /api/invites/[expired-token] returns 404 (RPC filters expired)", async ({
    request,
  }) => {
    // Important architectural detail from the migration: the RPC filters
    // expires_at > now() INSIDE the function, so an expired invite
    // returns ZERO rows — the route sees `notFound`, not a custom
    // "expired" error code. This is the safer default per the migration
    // comment (anonymous callers see the same NOT_FOUND for unknown,
    // revoked, expired, and exhausted). If this assertion ever fires as
    // 410 or some other code, the RPC contract has loosened.
    const res = await request.get(`/api/invites/${EXPIRED_TOKEN}`);
    expect(res.status()).toBe(404);
  });

  test("UI: /invite/[expired-token] renders invalid-state page", async ({
    page,
  }) => {
    const response = await page.goto(`/invite/${EXPIRED_TOKEN}`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("link", { name: /create your own trip/i })
    ).toBeVisible({ timeout: 10_000 });
  });
});
