import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * The flows that must not break: signup, login, password reset, invitation
 * links, share, voting, saving — plus the admin boundary.
 *
 * Written after the public.users lockdown (9ac2f6a / 27a1539 / 48013fc /
 * 597037b) because that change had two live regressions that shipped green:
 * Settle Up names, and the referral landing silently degrading to "A friend".
 * Both returned HTTP 200 while being wrong, so every assertion here is on
 * DATA — a token actually minted, a name actually resolved, a vote actually
 * persisted — never on a status code alone.
 *
 * SETUP
 *   npx tsx scripts/e2e-fixtures.mts --seed
 *   npx tsx scripts/e2e-login.mts
 *
 *   BASE_URL=https://monkeytravel.app \
 *   KEY_FLOWS_AUTH_STATE=.auth/owner.json \
 *   KEY_FLOWS_MATE_STATE=.auth/mate.json \
 *   KEY_FLOWS_TRIP_ID=<manifest tripId> \
 *   npx playwright test key-flows --project=chromium
 *
 * The signup test CREATES a real account and deletes it again, so it only
 * runs with KEY_FLOWS_ALLOW_SIGNUP=1 and SUPABASE_SERVICE_ROLE_KEY available
 * for the cleanup. Without those it skips rather than leaving orphans behind.
 */

const AUTH_STATE = process.env.KEY_FLOWS_AUTH_STATE;
const MATE_STATE = process.env.KEY_FLOWS_MATE_STATE;
const TRIP_ID = process.env.KEY_FLOWS_TRIP_ID;
const ACTIVITY_ID = process.env.KEY_FLOWS_ACTIVITY_ID ?? "e2e-act-1";
const ALLOW_SIGNUP = process.env.KEY_FLOWS_ALLOW_SIGNUP === "1";

/** Unwrap apiSuccess({...}) which may or may not nest under `data`. */
function payload(body: Record<string, unknown>): Record<string, unknown> {
  return (body.data as Record<string, unknown>) ?? body;
}

/** The consent banner overlays the form and blocks submits. Decline it —
 *  never remove the node, which crashes React (#185) and looks like a bug. */
async function declineConsent(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: /essential only/i });
  if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) await btn.click();
}

// ---------------------------------------------------------------------------
// Public auth surfaces
// ---------------------------------------------------------------------------

test.describe("auth pages render @prod", () => {
  for (const [name, path, field] of [
    ["login", "/auth/login", "#password"],
    ["signup", "/auth/signup", "#email"],
    ["forgot password", "/auth/forgot-password", "#email"],
    // Skipped here: it renders a text-free spinner until the recovery
    // fragment check resolves, so it gets its own test below.
  ] as const) {
    test(`${name} page renders its form`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), `${path} did not load`).toBeLessThan(400);
      await declineConsent(page);
      if (field) {
        await expect(
          page.locator(field),
          `${path} is missing ${field}`
        ).toBeVisible({ timeout: 15_000 });
      }
      // A client-side crash renders an empty body while still returning 200.
      const text = await page.locator("body").innerText();
      expect(text.trim().length, `${path} rendered an empty body`).toBeGreaterThan(40);
    });
  }
});

test.describe("password reset @prod", () => {
  // SHARED QUOTA WARNING. Supabase rate-limits auth emails per PROJECT, not
  // per caller, and real signups draw on the same budget. Two of these firing
  // within a couple of seconds is enough to get "Too many email requests" —
  // which is exactly what happened when they ran in parallel, and it can block
  // a real user's signup for minutes. Anything that sends mail runs serially
  // and opt-in.
  test.describe.configure({ mode: "serial", retries: 0 });

  test.skip(
    process.env.KEY_FLOWS_ALLOW_EMAIL !== "1",
    "sends a real recovery email on a project-wide quota: set KEY_FLOWS_ALLOW_EMAIL=1"
  );

  test("forgot-password accepts a submission without erroring", async ({ page }) => {
    await page.goto("/auth/forgot-password");
    await declineConsent(page);
    await page.fill("#email", "mt-e2e+test-owner@test.local");
    await page.click('button[type="submit"]');
    // Supabase answers identically for known and unknown addresses (no user
    // enumeration), so success here means "the request was accepted", not
    // "an account exists".
    await expect(
      page.locator("body"),
      "no confirmation after requesting a reset"
    ).toContainText(/check your (email|inbox)|email sent|sent you|controlla|revisa/i, {
      timeout: 20_000,
    });
  });

});

test.describe("password reset landing @prod", () => {
  // Sends no mail — safe to run any time, so it stays outside the quota gate.
  test("recovery redirect targets a CLIENT page, not a route handler", async ({
    page,
  }) => {
    // The bug that broke resets for ~10 months: Supabase returns the recovery
    // session in a URL FRAGMENT (#access_token=...), which never reaches the
    // server. If redirectTo points at a route handler the session is invisible
    // and the reset dies silently. /auth/reset-password must therefore be a
    // real client page that renders standalone.
    const res = await page.goto("/auth/reset-password");
    expect(res?.status()).toBeLessThan(400);
    await declineConsent(page);

    // First paint is a bare CSS spinner with no text, on purpose: the client
    // has to give detectSessionInUrl a beat to parse the fragment before it
    // can tell a good link from a dead one. Assert on the RESOLVED state.
    await expect(
      page.locator("body"),
      "reset page never resolved past its loading spinner — with no session and no error screen, a real recovery link would land nowhere"
    ).toContainText(/invalid|expired|link|password|richiedi|solicita/i, {
      timeout: 25_000,
    });

    // And it must be a client page, not a redirect to a route handler: the
    // recovery session arrives in the URL fragment, which never reaches the
    // server. This is the shape that broke resets for ~10 months.
    expect(
      new URL(page.url()).pathname,
      "reset-password navigated away — a fragment-carried session would be lost"
    ).toBe("/auth/reset-password");
  });
});

// ---------------------------------------------------------------------------
// Signup — creates and removes a real account
// ---------------------------------------------------------------------------

test.describe("signup", () => {
  // ---------------------------------------------------------------------
  // OFF BY DEFAULT, AND IT SHOULD USUALLY STAY OFF.
  //
  // Two real costs, both measured rather than assumed:
  //
  // 1. BOUNCES. Completing this form sends a confirmation email to an
  //    @test.local address, which is non-routable, so Resend records a HARD
  //    BOUNCE every single run (email_log: template 'unknown', status
  //    'bounced', source resend-webhook — one of those rows is this test).
  //    Bounce rate drives sender reputation, and this domain's SPF/DMARC was
  //    only just hardened. Do not run it in a loop.
  //
  // 2. A SHARED QUOTA. Supabase caps auth emails per PROJECT. Across 180
  //    hours of history this project has never exceeded 4 in a single hour,
  //    and two of these firing seconds apart was enough to trip "Too many
  //    email requests" — which real users hitting signup or password reset
  //    see too, for minutes.
  //
  // The username-collision behaviour this was written to cover is already
  // proven more cheaply and more strictly in SQL: run the insert as
  // `authenticated` inside a transaction with the trigger set to INVOKER and
  // it raises unique_violation; set it to DEFINER (as 20260820206000 does) and
  // it yields thisisnoki-2. That sends no mail and creates no account.
  // ---------------------------------------------------------------------
  test.describe.configure({ mode: "serial", retries: 0 });

  test.skip(
    !ALLOW_SIGNUP,
    "sends a bouncing email + burns the shared auth-email quota: set KEY_FLOWS_ALLOW_SIGNUP=1 only for a deliberate one-off"
  );

  test("a new account is created and gets a unique username", async ({ page }) => {
    // Directly exercises 20260820206000. mt_users_set_username scans
    // public.users for a free username; once that table was restricted to the
    // row owner, a SECURITY INVOKER scan saw nothing, handed out the base name,
    // and collided with users_username_lower_key. Both signup paths SWALLOW
    // that error, so the user would land with no profile row at all.
    const stamp = Date.now().toString(36);
    const email = `mt-e2e+test-signup-${stamp}@test.local`;
    const password = `E2e!signup-${stamp}-Aa1`;

    await page.goto("/auth/signup");
    await declineConsent(page);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');

    // Success is leaving the signup form (or an explicit confirmation).
    await page.waitForURL((u) => !u.pathname.includes("/auth/signup"), {
      timeout: 45_000,
    }).catch(async () => {
      const text = await page.locator("body").innerText();
      if (/too many|rate limit|try again later/i.test(text)) {
        throw new Error(
          "HARNESS, not the app: Supabase's project-wide auth-email quota was " +
            "exhausted. Space these runs out — real signups share this budget."
        );
      }
      expect(
        text,
        "signup neither navigated nor confirmed"
      ).toMatch(/check your email|confirm|welcome|success/i);
    });

    // Assert on the DATABASE, not the UI: the profile row is what actually
    // broke, and the UI never surfaces its absence.
    const { createClient } = await import("@supabase/supabase-js");
    const { readFileSync, existsSync } = await import("node:fs");
    let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if ((!url || !key) && existsSync(".env.local")) {
      for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
        if (!m) continue;
        const v = m[2].trim().replace(/^["']|["']$/g, "");
        if (m[1] === "NEXT_PUBLIC_SUPABASE_URL") url ||= v;
        if (m[1] === "SUPABASE_SERVICE_ROLE_KEY") key ||= v;
      }
    }
    test.skip(!url || !key, "no service credentials available to verify/clean up");
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: row } = await db
      .from("users")
      .select("id, email, username, display_name")
      .eq("email", email)
      .maybeSingle();

    expect(row, `no public.users row for ${email} — signup left the account without a profile`).toBeTruthy();
    expect(
      row!.username,
      "profile row exists but has no username — the trigger did not run"
    ).toBeTruthy();

    // Clean up: this is production.
    await db.auth.admin.deleteUser(row!.id as string).catch(() => {});
    const { data: gone } = await db
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    expect(gone, "cleanup failed — a test account was left in production").toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Signed-in flows
// ---------------------------------------------------------------------------

test.describe("signed-in trip flows", () => {
  test.skip(!AUTH_STATE || !TRIP_ID, "set KEY_FLOWS_AUTH_STATE and KEY_FLOWS_TRIP_ID");
  test.use({ storageState: AUTH_STATE });

  test("login session is real (not an anonymous state file)", async ({ request }) => {
    // Everything below is meaningless if the storageState carries no session.
    const res = await request.get("/api/profile");
    expect(res.status(), "session is not authenticated").toBe(200);
    const p = payload(await res.json());
    const profile = (p.profile as Record<string, unknown>) ?? p;
    expect(profile.email, "no email on own profile").toBeTruthy();
  });

  test("save and unsave a public trip", async ({ request }) => {
    // This endpoint is the /explore save flow and deliberately 404s anything
    // that is not visibility='public' — saving your OWN private trip is not a
    // thing. So pick a real public trip the same way a user would.
    const list = await request.get("/api/explore/trips?limit=1");
    expect(list.status(), "explore listing failed").toBe(200);
    const lp = payload(await list.json());
    const trips = (lp.trips as Array<{ id: string }>) ?? [];
    test.skip(trips.length === 0, "no public trips available to save");
    const publicTripId = trips[0].id;

    const on = await request.post(`/api/trips/${publicTripId}/save`);
    expect(
      on.status(),
      `save failed: ${(await on.text()).slice(0, 160)}`
    ).toBe(200);
    expect(payload(await on.json()).saved, "save did not report saved").toBe(true);

    const off = await request.delete(`/api/trips/${publicTripId}/save`);
    expect(off.status(), "unsave failed").toBe(200);
    expect(payload(await off.json()).saved, "unsave did not report unsaved").toBe(false);
  });

  test("share link mints and is readable by an anonymous visitor", async ({
    request,
    browser,
  }) => {
    const res = await request.post(`/api/trips/${TRIP_ID}/share`);
    expect(res.status(), "share mint failed").toBe(200);
    const p = payload(await res.json());
    const token = p.shareToken as string;
    expect(token, "no shareToken returned").toBeTruthy();

    // The point of a share link is that a signed-OUT person can open it.
    const anon = await browser.newContext();
    try {
      const page = await anon.newPage();
      const r = await page.goto(`/shared/${token}`);
      expect(r?.status(), "/shared/<token> did not load for anon").toBeLessThan(400);
      const text = await page.locator("body").innerText();
      expect(
        text.trim().length,
        "shared trip page rendered empty for an anonymous visitor"
      ).toBeGreaterThan(80);
      expect(text, "shared page shows a not-found state").not.toMatch(
        /not found|no longer available|non trovato/i
      );
    } finally {
      await anon.close();
    }
  });

  test("invitation link is created and previews for an anonymous visitor", async ({
    request,
    browser,
  }) => {
    const res = await request.post(`/api/trips/${TRIP_ID}/invites`, {
      data: { role: "voter", maxUses: 5, expiresInDays: 1 },
    });
    expect(res.status(), "invite creation failed").toBe(200);
    const p = payload(await res.json());
    const invite = (p.invite as Record<string, unknown>) ?? p;
    const token = (invite.token ?? invite.inviteToken) as string | undefined;
    const url = (invite.url ?? invite.inviteUrl ?? p.url) as string | undefined;
    expect(token || url, "no invite token or url returned").toBeTruthy();
    const path = token ? `/invite/${token}` : new URL(url!).pathname;

    const anon = await browser.newContext();
    try {
      const page = await anon.newPage();
      const r = await page.goto(path);
      // A 500 here is the regression f769dc4 fixed (invite preview routed
      // through a SECURITY DEFINER RPC); it must render, not explode.
      expect(r?.status(), `${path} errored for an anonymous visitor`).toBeLessThan(500);
      const text = await page.locator("body").innerText();
      expect(text.trim().length, "invite page rendered empty").toBeGreaterThan(60);
    } finally {
      await anon.close();
    }
  });

  test("anonymous voting works on a shared trip", async ({ request, browser }) => {
    const share = await request.post(`/api/trips/${TRIP_ID}/share`);
    const token = payload(await share.json()).shareToken as string;
    expect(token).toBeTruthy();

    const anon = await browser.newContext();
    try {
      const api: APIRequestContext = anon.request;
      // The field is vote_type, not vote. Sending the wrong name got a 400,
      // which the old <500 assertion happily accepted — the test passed
      // without ever casting a vote.
      const res = await api.post(`/api/shared/${token}/vote`, {
        data: { activity_id: ACTIVITY_ID, vote_type: "up", display_name: "E2E Anon" },
      });
      // Accept 200 (recorded) or a deliberate 4xx gate, but never a 5xx.
      expect(
        res.status(),
        `anonymous vote rejected: ${(await res.text()).slice(0, 200)}`
      ).toBe(200);
      const p = payload(await res.json());
      expect(p.activity_id, "vote response carried no activity_id").toBe(ACTIVITY_ID);
      expect(
        (p.up as number) + (p.down as number),
        "vote was accepted but no tally came back"
      ).toBeGreaterThan(0);
    } finally {
      await anon.close();
    }
  });
});

test.describe("crew voting as a second member", () => {
  test.skip(!MATE_STATE || !TRIP_ID, "set KEY_FLOWS_MATE_STATE and KEY_FLOWS_TRIP_ID");
  test.use({ storageState: MATE_STATE });

  test("a collaborator can vote and the vote is attributed", async ({ request }) => {
    const post = await request.post(
      `/api/trips/${TRIP_ID}/activities/${ACTIVITY_ID}/vote`,
      { data: { voteType: "love" } }
    );
    expect(
      post.status(),
      `vote POST failed: ${(await post.text()).slice(0, 200)}`
    ).toBe(200);

    const get = await request.get(
      `/api/trips/${TRIP_ID}/activities/${ACTIVITY_ID}/vote`
    );
    expect(get.status()).toBe(200);
    const p = payload(await get.json());
    const votes = (p.votes as Array<Record<string, unknown>>) ?? [];
    expect(votes.length, "no votes returned after voting").toBeGreaterThan(0);

    // Attribution is the part the lockdown could silently break.
    for (const v of votes) {
      const u = v.user as { display_name?: string } | undefined;
      expect(u?.display_name, "a vote has no voter name").toBeTruthy();
      expect(u!.display_name).not.toBe("Unknown");
    }
    const mine = votes.find((v) => v.user_id === (p.currentUserVote as Record<string, unknown> | null)?.user_id);
    expect(p.currentUserVote ?? mine, "the caller's own vote is missing").toBeTruthy();
  });
});
