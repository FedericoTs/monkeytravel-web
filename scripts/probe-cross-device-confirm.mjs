/**
 * A signup confirmation opened on a DIFFERENT device must sign the user in.
 *
 * The original failure (#86): the emailed link pointed at GoTrue's
 * `/auth/v1/verify`, which completes a PKCE flow — and PKCE stores its
 * `code_verifier` in the browser that STARTED the signup. Open the link on
 * your phone after signing up on your laptop and there is no verifier to
 * redeem with, so the account is marked confirmed and the person never gets a
 * session. They are stranded: the account exists, they cannot get in, and
 * nothing tells them why. 27 accounts in the 90 days before the fix confirmed
 * and never once obtained a session.
 *
 * The fix routes VERIFY_OTP_SAFE types through our own /auth/callback with a
 * `token_hash`, which `verifyOtp` can redeem from ANY device.
 *
 * This is the manual check ("sign up, open the link in another browser") made
 * repeatable. The second device is a brand-new browser context with no
 * cookies and no storage — which is precisely what a phone is to a laptop.
 *
 * NO real auth email is sent: admin.generateLink returns the token without
 * mailing anything. That matters, because the Supabase auth-email cap is low
 * and project-wide and exhausting it breaks confirmation for real signups.
 *
 * Creates and deletes its own account.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-cross-device-confirm.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, existsSync } from "node:fs";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const rawLine of readFileSync(".env.local", "utf8").split(String.fromCharCode(10))) {
      const line = rawLine.trim();
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      const q = v.slice(0, 1);
      if ((q === String.fromCharCode(34) || q === String.fromCharCode(39)) && v.slice(-1) === q) v = v.slice(1, -1);
      if (k === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (k === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

const BASE = process.env.BASE_URL || "http://localhost:3001";
const SHOTS = process.env.SHOTS || ".probe-shots/cross-device-confirm";
mkdirSync(SHOTS, { recursive: true });
const { url, key } = creds();
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);

const email = `mt-probe+xdev-${Date.now()}@test.local`;
const password = "Probe!" + Math.random().toString(36).slice(2, 12);
const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: false });
if (error) { console.error("could not create probe user:", error.message); process.exit(1); }
const uid = created.user.id;

const browser = await chromium.launch();
try {
  console.log("");
  console.log("=== 1. device A starts the signup ===");
  // A real signup would POST from this browser and leave a PKCE code_verifier
  // in ITS storage. We only need device A to exist and to NOT be device B.
  const deviceA = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", userAgent: UA });
  const pageA = await deviceA.newPage();
  await pageA.goto(`${BASE}/en/auth/signup`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await pageA.waitForTimeout(1500);
  ok("device A (desktop) has the signup page open");

  console.log("");
  console.log("=== 2. the link that the confirmation email would carry ===");
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "signup", email, password });
  if (linkErr || !link?.properties?.hashed_token) { fail(`could not mint a signup link: ${linkErr?.message}`); throw new Error("stop"); }
  // Exactly the URL app/api/auth/send-email/route.ts builds for a
  // VERIFY_OTP_SAFE type. If that branch ever stops firing, this shape is what
  // regresses — which is why the route now alarms to Sentry when token_hash
  // is absent.
  const emailedUrl = `${BASE}/auth/callback?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=signup&locale=en`;
  note(`link: /auth/callback?token_hash=…&type=signup`);
  if (!link.properties.hashed_token) fail("no token_hash — the email would fall back to a PKCE link");
  else ok("a token_hash exists, so the email carries the any-device link");

  console.log("");
  console.log("=== 3. device B (a phone that never saw the signup) opens it ===");
  const deviceB = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US", userAgent: PHONE_UA });
  const pageB = await deviceB.newPage();
  await pageB.goto(emailedUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pageB.waitForTimeout(4000);
  const landed = new URL(pageB.url()).pathname;
  note(`landed on ${landed}`);
  const body = (await pageB.evaluate(() => document.body.innerText)).toLowerCase();
  if (/could not authenticate|link_wrong_device|expired|something went wrong/.test(body)) {
    fail(`device B saw an auth error: "${body.slice(0, 120).replace(/\s+/g, " ")}"`);
  } else ok("no auth error on device B");
  await pageB.screenshot({ path: `${SHOTS}/device-b.png` });

  console.log("");
  console.log("=== 4. and it is actually SIGNED IN, not merely 'confirmed' ===");
  // The whole failure mode is a confirmed account with no session, so asking
  // the page is not enough — ask for a page only a session can render.
  await pageB.goto(`${BASE}/en/trips`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pageB.waitForTimeout(3500);
  const onTrips = new URL(pageB.url()).pathname;
  if (/\/auth\/login/.test(onTrips)) fail("device B was bounced to /auth/login — it has no session");
  else ok(`device B can open ${onTrips} — it holds a session`);

  const { data: after } = await db.auth.admin.getUserById(uid);
  const confirmed = !!after?.user?.email_confirmed_at;
  const signedIn = !!after?.user?.last_sign_in_at;
  note(`auth.users: confirmed=${confirmed} last_sign_in_at=${signedIn}`);
  if (!confirmed) fail("the account is not confirmed");
  else ok("account confirmed");
  // This is the exact shape of the stranded cohort: confirmed, never a session.
  if (!signedIn) fail("STRANDED: confirmed but last_sign_in_at is still null — the #86 failure mode is back");
  else ok("last_sign_in_at is set — the cross-device confirmation produced a real session");

  await deviceA.close();
  await deviceB.close();
} catch (err) {
  if (err.message !== "stop") fail(`unexpected error: ${err.message}`);
} finally {
  await browser.close();
  try { await db.from("trips").delete().eq("user_id", uid); } catch { /* best effort */ }
  try { await db.auth.admin.deleteUser(uid); } catch { /* best effort */ }
  note("probe account deleted");
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
