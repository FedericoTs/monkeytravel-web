/**
 * The two activation fixes, verified against the real mechanisms.
 *
 * 1. EMAIL CONFIRMATION MUST WORK FROM ANY DEVICE
 *
 * The confirmation email used to link to GoTrue's /auth/v1/verify, which
 * stamps email_confirmed_at and then redirects with a PKCE ?code= that only
 * the browser holding the code_verifier can redeem. Confirm on your phone
 * after signing up on your laptop and you are confirmed with no session.
 *
 * Measured over 60 days before the fix: email signup lost 41.3% of users
 * before their first session (92 signups, 20 never confirmed, 18
 * confirmed-then-stuck) against 0.5% for Google. Of those 18, 18 requested
 * another confirmation link, 5 tried signing up again, 3 tried a password
 * reset.
 *
 * This test mints a REAL token_hash with admin.generateLink and redeems it in
 * a browser that has never seen the signup — i.e. exactly the cross-device
 * case — then asserts a session actually exists afterwards.
 *
 * 2. THE ANONYMOUS TRIP CLAIM MUST ACTUALLY FIRE
 *
 * claimPendingTrip was gated on the SIGNED_IN auth event, which auth-js emits
 * only when the CLIENT performs the sign-in. Email confirmation and Google
 * OAuth both establish the session in a server route handler, so the client
 * sees INITIAL_SESSION instead and the claim never ran: 54 trips born
 * anonymous in 60 days, ZERO claimed.
 *
 * This test creates a real anonymous trip, plants its claim token the way the
 * share button does, loads the app with a session, and asserts the trip
 * changes owner.
 *
 *   BASE_URL=http://localhost:3001 node scripts/probe-activation-fixes.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

const BASE = process.env.BASE_URL || "http://localhost:3001";
const { url, key } = creds();
if (!url || !key) {
  console.error("missing supabase credentials");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);

const browser = await chromium.launch();
const cleanup = [];

// ───────────────────────────── 1. cross-device email confirmation
console.log("\n=== 1. a confirmation link must work on a device that never saw the signup ===");
{
  const email = `mt-probe+confirm-${Date.now()}@test.local`;
  const password = "Probe!" + Math.random().toString(36).slice(2, 12);

  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email, password, email_confirm: false,
  });
  if (cErr) { fail(`could not create probe user: ${cErr.message}`); }
  else {
    cleanup.push(() => db.auth.admin.deleteUser(created.user.id));

    // The same token_hash the send-email hook receives.
    const { data: link, error: lErr } = await db.auth.admin.generateLink({
      type: "signup", email, password,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (lErr || !tokenHash) {
      fail(`could not generate a signup link: ${lErr?.message ?? "no hashed_token"}`);
    } else {
      // A brand-new browser context = no code_verifier anywhere. This is the
      // exact condition that used to dead-end.
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const target = `${BASE}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=signup&locale=en`;
      // Warm the route on a throwaway page: a cold dev server compiles
      // /auth/callback on first hit and the real navigation would time out,
      // which reads as "the link did not work" when nothing is wrong.
      const warm = await ctx.newPage();
      await warm.goto(`${BASE}/auth/callback`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
      await warm.close();

      const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 90000 });
      if (!resp) fail("navigation to the callback produced no response");
      await page.waitForTimeout(3000);

      const landed = page.url();
      const bouncedToLogin = /\/auth\/login/.test(landed);

      // The real assertion is a SESSION, not a URL: an auth cookie must exist.
      const cookies = await ctx.cookies();
      const hasAuthCookie = cookies.some((c) => /^sb-.*-auth-token/.test(c.name));

      const { data: after } = await db.auth.admin.getUserById(created.user.id);
      const confirmed = Boolean(after?.user?.email_confirmed_at);

      console.log(`     landed on: ${landed.replace(BASE, "")}`);
      if (!confirmed) fail("the link did not confirm the address at all");
      else ok("address confirmed");

      if (bouncedToLogin) fail("confirmed but bounced to /auth/login - the dead end is still there");
      else ok("not bounced to the login dead end");

      if (!hasAuthCookie) fail("NO SESSION COOKIE after confirming - user is confirmed but locked out");
      else ok("session cookie present - the user is actually signed in");

      await ctx.close();
    }
  }
}

// ───────────────────────────── 2. the anonymous claim actually fires
console.log("\n=== 2. an anonymous trip must be claimed when a session appears ===");
{
  const email = `mt-probe+claim-${Date.now()}@test.local`;
  const password = "Probe!" + Math.random().toString(36).slice(2, 12);
  // email_confirm FALSE: we need to complete confirmation through the real
  // server callback, because that is the path that emits INITIAL_SESSION.
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email, password, email_confirm: false,
  });
  if (cErr) { fail(`could not create probe user: ${cErr.message}`); }
  else {
    cleanup.push(() => db.auth.admin.deleteUser(created.user.id));

    const claimToken = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data: trip, error: tErr } = await db
      .from("trips")
      .insert({
        title: "Probe anonymous trip (safe to delete)",
        description: "Automated probe. Safe to delete.",
        status: "planning",
        user_id: null,
        claim_token: claimToken,
        claim_expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
        itinerary: [],
        trip_meta: { destination: "Lisbon" },
        start_date: "2027-05-01",
        end_date: "2027-05-05",
      })
      .select("id")
      .single();

    if (tErr || !trip) {
      fail(`could not create the anonymous trip: ${tErr?.message}`);
    } else {
      cleanup.push(() => db.from("trips").delete().eq("id", trip.id));

      const { data: link, error: lErr } = await db.auth.admin.generateLink({
        type: "signup", email, password,
      });
      const tokenHash = link?.properties?.hashed_token;
      if (lErr || !tokenHash) {
        fail(`could not generate a signup link: ${lErr?.message ?? "no hashed_token"}`);
      } else {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();

        // Plant the token the way the share button does, before any session.
        await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.evaluate((t) => localStorage.setItem("mt_pending_claim_token", t), claimToken);

        // THE PATH THAT MATTERS. Confirming through the server callback means
        // the session is created in a route handler and the browser is
        // redirected into an app that already has one - so auth-js emits
        // INITIAL_SESSION, never SIGNED_IN.
        //
        // Signing in through the login form instead would emit SIGNED_IN and
        // pass against the OLD code too, which is exactly the false pass this
        // test had on its first run.
        await page.goto(
          `${BASE}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=signup&locale=en`,
          { waitUntil: "domcontentloaded", timeout: 120000 },
        );
        await page.waitForTimeout(6000);

        const { data: owned } = await db.from("trips").select("user_id").eq("id", trip.id).single();
        if (owned?.user_id === created.user.id) ok("anonymous trip claimed after a SERVER-established session");
        else fail(`trip still unowned (user_id=${owned?.user_id ?? "null"}) - the claim did not fire on INITIAL_SESSION`);

        await ctx.close();
      }
    }
  }
}

await browser.close();
for (const fn of cleanup) { try { await fn(); } catch {} }
console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
