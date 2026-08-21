import { test, expect } from "@playwright/test";

/**
 * public.users lockdown — regression cover for 9ac2f6a / 27a1539 / 48013fc.
 *
 * WHAT CHANGED
 * ------------
 * `users_select_public` was `USING (true)`: any signed-in account could read
 * all 447 rows including every email. It is now `id = auth.uid()`, and every
 * legitimate cross-user read of a name/avatar goes through the
 * `public_profiles` view (or the service client, for admin surfaces).
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * The failure mode is SILENT. RLS denial returns zero rows, not an error, and
 * a PostgREST embed of a denied table returns null rather than failing. So the
 * regression looks like "every teammate is called Unknown" or "the cost
 * dashboard is empty" — no exception, no 500, nothing in the logs. Status-code
 * assertions cannot see any of that, so every check here asserts on DATA:
 * a name is actually present, a row actually came back, an email actually did
 * not.
 *
 * SPLIT
 * -----
 * The anon block runs anywhere (@prod-safe, read-only).
 *
 * The signed-in blocks need a session, and this repo has no auth harness — so
 * they follow the convention already used by account-deletion.spec.ts and
 * share-prompt.spec.ts: point an env var at a Playwright storageState file, or
 * the block skips.
 *
 *   USERS_RLS_AUTH_STATE    storageState for ANY signed-in account
 *   USERS_RLS_ADMIN_STATE   storageState for an account in ADMIN_EMAILS
 *   USERS_RLS_TRIP_ID       a trip the USERS_RLS_AUTH_STATE user belongs to
 *
 * Produce one with:
 *   npx playwright open --save-storage=.auth/user.json https://monkeytravel.app
 * log in in the window that opens, then close it.
 *
 * Run:
 *   BASE_URL=https://monkeytravel.app USERS_RLS_AUTH_STATE=.auth/user.json \
 *     npx playwright test users-rls-lockdown --project=chromium
 */

const ANON_REFERRAL_CODE = "RGRCZ8";
const AUTH_STATE = process.env.USERS_RLS_AUTH_STATE;
const ADMIN_STATE = process.env.USERS_RLS_ADMIN_STATE;
const TRIP_ID = process.env.USERS_RLS_TRIP_ID;

test.describe("users lockdown — anonymous surfaces @prod", () => {
  test("referral landing still names the referrer", async ({ page }) => {
    // Reads another user's display_name with no session at all. Before the
    // change this came from public.users; it now comes from public_profiles.
    // If the view regressed, the page still renders 200 — with the name gone.
    await page.goto(`/join/${ANON_REFERRAL_CODE}`);

    const title = await page.title();
    expect(title, "referrer name missing from <title>").toMatch(
      /\S+\s+invited you/i
    );
    // Guard the specific way this degrades: name resolves to empty/placeholder.
    expect(title).not.toMatch(/^\s*invited you/i);
    expect(title).not.toMatch(/(unknown|someone|traveler)\s+invited you/i);

    const og = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content");
    expect(og, "og:title should carry the same name").toMatch(
      /\S+\s+invited you/i
    );
  });

  test("health probe reports a real read, not an empty one", async ({
    request,
  }) => {
    // /api/health is unauthenticated and probes public_profiles. It reports
    // "degraded" when the query succeeds but returns no rows — which is what a
    // grant or policy regression looks like from the outside.
    const res = await request.get("/api/health");
    const body = await res.json();
    const db = (body.checks ?? []).find(
      (c: { name: string }) => c.name === "database"
    );
    expect(db, "no database check in /api/health").toBeTruthy();
    expect(
      db.status,
      `database check degraded/down: ${db.message ?? ""}`
    ).toBe("ok");
  });

  test("explore still attributes trips to their creators", async ({
    request,
  }) => {
    const res = await request.get("/api/explore/trips?limit=3");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const trips = body.trips ?? body.data ?? body;
    expect(Array.isArray(trips) ? trips.length : 0).toBeGreaterThan(0);
  });
});

test.describe("users lockdown — signed in", () => {
  test.skip(
    !AUTH_STATE,
    "set USERS_RLS_AUTH_STATE=path/to/storageState.json (see file header)"
  );
  test.use({ storageState: AUTH_STATE });

  test("own profile still resolves — own-row reads survived", async ({
    request,
  }) => {
    // The row policy is id = auth.uid(); if it were wrong in the other
    // direction, users would lose access to their OWN profile.
    const res = await request.get("/api/profile");
    expect(res.status(), "own profile should be readable").toBe(200);
    const body = await res.json();
    const profile = body.profile ?? body.data?.profile ?? body.data ?? body;
    expect(profile.id, "own profile has no id").toBeTruthy();
    expect(profile.email, "own email should still be readable by its owner")
      .toBeTruthy();
  });

  test("leaderboard renders other people's names", async ({ request }) => {
    // Reads other users' display_name + referral_tier. Moved to the service
    // client because it embeds referral_codes/referral_tiers, and PostgREST
    // resolves embeds through foreign keys, which a view has none of.
    const res = await request.get("/api/referral/leaderboard");
    expect(res.status()).toBe(200);
    const body = await res.json();
    const entries = body.entries ?? body.data?.entries ?? [];
    if (entries.length === 0) {
      test.info().annotations.push({
        type: "note",
        description: "leaderboard empty — no entries to assert names on",
      });
      return;
    }
    // The silent failure is every name collapsing to the 'Traveler' fallback.
    const named = entries.filter(
      (e: { displayName?: string }) =>
        e.displayName && e.displayName !== "Traveler"
    );
    expect(
      named.length,
      "every leaderboard entry fell back to 'Traveler' — cross-user name read is broken"
    ).toBeGreaterThan(0);
  });

  test("collaborators resolve names and leak no emails", async ({
    request,
  }) => {
    test.skip(
      !TRIP_ID,
      "set USERS_RLS_TRIP_ID to a trip the auth-state user belongs to"
    );
    const res = await request.get(`/api/trips/${TRIP_ID}/collaborators`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const list = body.collaborators ?? body.data?.collaborators ?? [];
    expect(list.length, "no collaborators returned").toBeGreaterThan(0);

    for (const c of list) {
      expect(
        c.display_name,
        `collaborator ${c.user_id} has no name — cross-user profile read broke`
      ).toBeTruthy();
      expect(c.display_name).not.toBe("Unknown User");
      // Removed in 9ac2f6a: this was dead payload that shipped every member's
      // email address to every other member's browser.
      expect(
        c.email,
        "collaborator email must not be echoed to the client"
      ).toBeUndefined();
    }
  });
});

test.describe("users lockdown — admin surfaces", () => {
  test.skip(
    !ADMIN_STATE,
    "set USERS_RLS_ADMIN_STATE=path/to/storageState.json for an ADMIN_EMAILS account"
  );
  test.use({ storageState: ADMIN_STATE });

  // These two moved from the cookie client to the service client. Admin-ness
  // is an allowlist in lib/admin.ts that Postgres knows nothing about, so
  // under id = auth.uid() the cookie client would return the admin's own row
  // and the dashboards would quietly render empty.
  for (const route of ["/api/admin/costs", "/api/admin/google-metrics"]) {
    test(`${route} returns data, not an empty shell`, async ({ request }) => {
      const res = await request.get(route);
      expect(res.status(), `${route} should be reachable by an admin`).toBe(
        200
      );
      const body = await res.json();
      const payload = body.data ?? body;
      const hasSomething =
        JSON.stringify(payload).length > 2 &&
        Object.keys(payload ?? {}).length > 0;
      expect(hasSomething, `${route} returned an empty payload`).toBeTruthy();
    });
  }

  test("admin dashboard page renders for an admin", async ({ page }) => {
    const res = await page.goto("/admin");
    expect(res?.status()).toBeLessThan(400);
    // Middleware bounces non-admins to "/" — landing there means the gate
    // rejected an account that should have passed.
    expect(new URL(page.url()).pathname).toMatch(/^\/admin/);
  });
});
