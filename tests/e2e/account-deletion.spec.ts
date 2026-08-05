import { test, expect } from "@playwright/test";

/**
 * Account deletion — the regression that 4caffc0 fixed.
 *
 * THIS SPEC PERMANENTLY DESTROYS THE ACCOUNT IT RUNS AS. Read the guards
 * below before setting any env var.
 *
 * What it reproduces
 * ------------------
 * delete_user_account() cleared four tables. Four other columns REFERENCE
 * auth.users(id) with no ON DELETE clause, so Postgres applied NO ACTION —
 * which BLOCKS the delete rather than leaving the row behind:
 *
 *   trip_invites.created_by       <- written by POST /api/trips/[id]/invites
 *   trip_collaborators.invited_by
 *   activity_proposals.resolved_by
 *   mcp_itineraries.claimed_by
 *
 * /api/profile/delete runs in two phases: the RPC over the public schema,
 * then adminClient.auth.admin.deleteUser(). For a user whose id sat in one
 * of those columns, phase 2 raised a foreign-key violation and the route
 * returned "Account data deleted but auth record removal failed" — trips
 * destroyed, email still in auth.users.
 *
 * Measured 2026-08-04: 0 accounts had ever hit this. Only 5 rows total sit
 * in those columns and all 5 belong to live users, so no deletion had yet
 * been performed by anyone who had created an invite. The bug was real but
 * latent, which is exactly why it needs a test — the natural data will not
 * reproduce it, and it gets more likely as the crew loop gets used.
 *
 * So the spec MANUFACTURES the trigger: create an invite (landing this
 * user's id in trip_invites.created_by), THEN delete the account, then
 * assert the delete fully succeeded.
 *
 * Why it is not just skipped-by-default like share-prompt.spec.ts
 * --------------------------------------------------------------
 * That spec is read-only. This one is destructive and irreversible, so a
 * single "is the env var set" gate is not enough — a stray
 * DELETE_FLOW_AUTH_STATE pointing at a real session would delete a real
 * account. Three independent gates, all required:
 *
 *   DELETE_FLOW_AUTH_STATE   storageState for the throwaway account
 *   DELETE_FLOW_EMAIL        that account's email, which MUST match the
 *                            session's own email — forces the operator to
 *                            name the account being destroyed
 *   DELETE_FLOW_PASSWORD     required by the route's step-up auth
 *
 * Plus a runtime tripwire: the spec refuses to run against an account that
 * owns more than MAX_TRIPS trips, on the theory that a real account has
 * accumulated more than a throwaway. A mismatch FAILS loudly rather than
 * skipping, because a silent skip on a safety check reads as "passed".
 *
 * Setup, once:
 *   1. Register a throwaway account (a real human does this — not the agent).
 *   2. Give it one trip: fork any trip from /explore, or run the wizard.
 *   3. Export the three vars and run:
 *
 *      BASE_URL=https://monkeytravel.app \
 *      DELETE_FLOW_AUTH_STATE=$HOME/.mt-throwaway-auth.json \
 *      DELETE_FLOW_EMAIL=throwaway+delete@example.com \
 *      DELETE_FLOW_PASSWORD=... \
 *      npx playwright test account-deletion
 *
 *   4. UNSET DELETE_FLOW_PASSWORD afterwards. Do not put it in .env.
 *      The account is gone after a successful run; re-running needs a new one.
 */

const AUTH_STATE = process.env.DELETE_FLOW_AUTH_STATE;
const EMAIL = process.env.DELETE_FLOW_EMAIL;
const PASSWORD = process.env.DELETE_FLOW_PASSWORD;

/** A throwaway has one or two trips. A real account has more. */
const MAX_TRIPS = 3;

/** Exact string the route demands; a typo here reads as a 400, not a bug. */
const CONFIRMATION = "delete my account";

test.describe("account deletion completes for a user who created an invite", () => {
  test.skip(
    !AUTH_STATE || !EMAIL || !PASSWORD,
    "destructive: needs DELETE_FLOW_AUTH_STATE + DELETE_FLOW_EMAIL + DELETE_FLOW_PASSWORD for a THROWAWAY account (see file header)"
  );

  test.use({ storageState: AUTH_STATE });

  // Serial: the account ceases to exist partway through.
  test.describe.configure({ mode: "serial" });

  test("invite → delete → both auth and public rows are gone", async ({
    page,
  }) => {
    // ---- Gate 1: the session must BE the account the operator named -------
    // GET /api/profile, not /api/auth/session — the latter does not exist
    // (it 404'd; see task #312, resolved by removing the dependency rather
    // than adding the route). Pointing a SAFETY gate at a 404 would make it
    // fail closed, which is safe, but it would also mean this test could
    // never run at all.
    const meRes = await page.request.get("/api/profile");
    expect(
      meRes.ok(),
      "could not read the profile — is DELETE_FLOW_AUTH_STATE stale?"
    ).toBeTruthy();
    const me = await meRes.json();
    const sessionEmail = String(
      me?.email ?? me?.profile?.email ?? me?.user?.email ?? ""
    ).toLowerCase();

    expect(
      sessionEmail,
      "session has no email — refusing to delete an account I cannot identify"
    ).toBeTruthy();
    expect(
      sessionEmail,
      `REFUSING TO RUN: the session belongs to ${sessionEmail}, but ` +
        `DELETE_FLOW_EMAIL names ${EMAIL!.toLowerCase()}. This spec deletes ` +
        `the account it runs as — the mismatch means the auth state is not ` +
        `the throwaway you think it is.`
    ).toBe(EMAIL!.toLowerCase());

    // ---- Gate 2: tripwire on account size --------------------------------
    await page.goto("/trips");
    await page.waitForLoadState("networkidle");
    const tripIds: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href*="/trips/"]'))
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")
        .map((h) => h.match(/\/trips\/([0-9a-f-]{36})(?:[/?#]|$)/i)?.[1] || "")
        .filter((v, i, arr) => v && arr.indexOf(v) === i)
    );

    expect(
      tripIds.length,
      "throwaway account owns no trips — give it one (fork from /explore) so an invite can be created"
    ).toBeGreaterThan(0);
    expect(
      tripIds.length,
      `REFUSING TO RUN: account owns ${tripIds.length} trips (max ${MAX_TRIPS}). ` +
        `That looks like a real account, not a throwaway.`
    ).toBeLessThanOrEqual(MAX_TRIPS);

    // ---- Manufacture the trigger -----------------------------------------
    // This is the whole point: put this user's id into trip_invites.created_by,
    // the NO ACTION reference that used to block auth.admin.deleteUser().
    const inviteRes = await page.request.post(
      `/api/trips/${tripIds[0]}/invites`,
      { data: { role: "editor" } }
    );
    expect(
      inviteRes.ok(),
      `invite creation failed (${inviteRes.status()}) — without it this test ` +
        `proves nothing, because the FK that used to block deletion is never set`
    ).toBeTruthy();

    // ---- The act under test ----------------------------------------------
    const delRes = await page.request.post("/api/profile/delete", {
      data: { confirmationText: CONFIRMATION, password: PASSWORD },
    });

    const delBody = await delRes.json().catch(() => ({}));

    // The pre-4caffc0 failure mode, called out by name so a regression is
    // self-describing rather than a bare status mismatch.
    expect(
      String(delBody?.error ?? ""),
      "REGRESSION: phase 2 (auth.admin.deleteUser) failed — a NO ACTION " +
        "foreign key is blocking the delete again. The account is now " +
        "half-deleted: public data gone, auth row and email still present."
    ).not.toContain("auth record removal failed");

    expect(delRes.ok(), `delete returned ${delRes.status()}`).toBeTruthy();

    // ---- Confirm the account is actually gone ----------------------------
    // The session should no longer resolve; /trips must bounce to login.
    await page.goto("/trips");
    await page.waitForLoadState("networkidle");
    expect(
      page.url(),
      "account reported deleted but the session still resolves"
    ).toContain("/auth/login");
  });
});
