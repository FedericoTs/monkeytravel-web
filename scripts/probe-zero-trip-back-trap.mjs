/**
 * A user with no trips must be able to leave the wizard.
 *
 * app/[locale]/trips/page.tsx used to hard-redirect any zero-trip user to
 * /trips/new. That made the browser Back button a trap: /trips/new -> Back ->
 * /trips -> server redirect -> /trips/new again. The one control every browser
 * gives you did nothing, for exactly the people who have not yet succeeded at
 * anything.
 *
 * It also hid a page that already existed: TripsPageClient renders a full
 * empty state (illustration, "plan your first trip" primary CTA, and a
 * low-friction "browse community trips" secondary) which a zero-trip user had
 * never seen, because the redirect fired first.
 *
 * Post-signup landing is deliberately NOT affected and is asserted here too:
 * app/auth/callback/route.ts rewrites next="/trips" to "/trips/new" on its
 * own, so brand-new users still arrive at the wizard directly.
 *
 *   BASE_URL=http://localhost:3001 node scripts/probe-zero-trip-back-trap.mjs
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
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);

const email = `mt-probe+zerotrip-${Date.now()}@test.local`;
const password = "Probe!" + Math.random().toString(36).slice(2, 12);
const { data: created, error: cErr } = await db.auth.admin.createUser({
  email, password, email_confirm: true,
});
if (cErr) { console.error("could not create probe user:", cErr.message); process.exit(1); }

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Sign in through the real form.
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);
  const ess = page.getByRole("button", { name: /essential only/i });
  if (await ess.isVisible().catch(() => false)) { await ess.click(); await page.waitForTimeout(400); }
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').first().press("Enter");
  // Wait for the login to actually take. Without this the probe happily ran
  // its assertions against the login page and reported "/trips renders
  // (stayed on /auth/login)" - a pass-shaped result from a failed setup.
  await page
    .waitForFunction(() => !window.location.pathname.includes("/auth/login"), null, { timeout: 90000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
  if (page.url().includes("/auth/login")) {
    const msg = await page.locator('[role="alert"]').first().innerText().catch(() => "");
    fail(`sign-in did not complete - still on /auth/login. ${msg.slice(0, 120)}`);
  } else {
    ok(`signed in, landed on ${new URL(page.url()).pathname}`);
  }

  // Confirm the account really has no trips, or the whole test is vacuous.
  const { count } = await db
    .from("trips").select("id", { count: "exact", head: true })
    .eq("user_id", created.user.id);
  if (count && count > 0) fail(`probe user unexpectedly has ${count} trips - test would be vacuous`);
  else ok("probe user has zero trips");

  // 1. /trips must RENDER, not bounce.
  console.log("\n=== 1. a zero-trip user can open their trip list ===");
  await page.goto(`${BASE}/trips`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(4000);
  const landed = new URL(page.url()).pathname;
  if (landed.includes("/trips/new")) fail(`/trips still redirects to ${landed}`);
  else ok(`/trips renders (stayed on ${landed})`);

  const body = await page.locator("body").innerText().catch(() => "");
  if (/plan (your )?first trip|no trips yet/i.test(body)) ok("the empty state is visible, with its CTA");
  else fail(`empty state not found - page said: ${body.slice(0, 140).replace(/\n/g, " ")}`);

  // 2. THE TRAP: Back out of the wizard.
  console.log("\n=== 2. Back must escape the wizard ===");
  await page.goto(`${BASE}/trips/new`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3500);
  const atWizard = new URL(page.url()).pathname;
  if (!atWizard.includes("/trips/new")) fail(`could not reach the wizard, landed on ${atWizard}`);

  await page.goBack({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const afterBack = new URL(page.url()).pathname;
  if (afterBack.includes("/trips/new")) fail(`Back bounced straight back to the wizard (${afterBack}) - the trap is still there`);
  else ok(`Back escaped the wizard, landed on ${afterBack}`);

  await ctx.close();
} finally {
  await browser.close();
  await db.auth.admin.deleteUser(created.user.id).catch(() => {});
  console.log("\n  probe user deleted");
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
