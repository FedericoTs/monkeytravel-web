/**
 * The save-click-to-account step must leave a consent-free trail.
 *
 * Measured over the 30 days to 2026-09-02: 186 sessions clicked Save while
 * signed out, 87 ended signed in, 77 reached `saved` — and the 99 that never
 * signed in left NO trace of why. The only steps their sessions carried were
 * pre-auth ones, so "closed the modal without typing an address", "asked for a
 * link that never arrived" and "opened the link and still got nothing" — three
 * different problems with three different fixes — were one number.
 *
 * Three steps split it, and this proves each one is actually written:
 *
 *   auth_modal_shown  fired by AuthPromptModal when the ask is put on screen
 *   otp_requested     fired when a magic link is successfully requested
 *   otp_link_opened   written SERVER-SIDE by the auth callback on redemption
 *
 * No real auth email is sent: the OTP request is intercepted and fulfilled in
 * the browser, and the callback is exercised with an admin-minted token_hash,
 * which generateLink returns without mailing anything. This matters — the
 * Supabase auth-email cap is low and project-wide, and burning it would take
 * down confirmation for real signups.
 *
 * Costs one generation. Creates and deletes its own account.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-auth-funnel-steps.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

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
const SHOTS = process.env.SHOTS || ".probe-shots/auth-funnel-steps";
mkdirSync(SHOTS, { recursive: true });
const { url, key } = creds();
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stepsFor(sessionId, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const { data } = await db.from("wizard_step_events").select("step").eq("session_id", sessionId);
    const steps = (data ?? []).map((r) => r.step);
    if (steps.length) return steps;
    await sleep(1500);
  }
  return [];
}

const email = `mt-probe+authsteps-${Date.now()}@test.local`;
const password = "Probe!" + Math.random().toString(36).slice(2, 12);
const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: false });
if (error) { console.error("could not create probe user:", error.message); process.exit(1); }
const uid = created.user.id;

// A session id only this probe uses, so the server-side assertion is exact.
const probeSession = `mt-probe-${randomUUID()}`;

const browser = await chromium.launch();
try {
  console.log("");
  console.log("=== 1. otp_link_opened is written by the callback, server-side ===");
  // generateLink RETURNS the token; it does not mail anything.
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "signup", email, password });
  if (linkErr || !link?.properties?.hashed_token) fail(`could not mint a signup link: ${linkErr?.message}`);
  else {
    const target = `${BASE}/auth/callback?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=signup&locale=en`;
    const res = await fetch(target, {
      redirect: "manual",
      headers: { cookie: `mt_session_id=${probeSession}`, "user-agent": UA },
    });
    note(`callback responded ${res.status} -> ${(res.headers.get("location") || "").replace(BASE, "")}`);
    const steps = await stepsFor(probeSession);
    note(`rows for the probe session: ${steps.join(", ") || "(none)"}`);
    if (!steps.includes("otp_link_opened")) fail("no otp_link_opened row — the callback did not record the redemption");
    else ok("otp_link_opened written, keyed to the session that opened the link");
  }

  console.log("");
  console.log("=== 2. the browser steps: auth_modal_shown and otp_requested ===");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "en-US", userAgent: UA });
  const page = await ctx.newPage();

  // Never send a real auth email: the Supabase auth-email cap is low and
  // project-wide, and exhausting it breaks confirmation for real signups.
  let otpIntercepted = false;
  await ctx.route(/\/auth\/v1\/otp/, async (route) => {
    otpIntercepted = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForSelector("h1", { timeout: 120000 });
  await page.waitForTimeout(2600);
  const ess = page.getByRole("button", { name: /essential only/i });
  if (await ess.isVisible().catch(() => false)) { await ess.click(); await page.waitForTimeout(500); }

  const sid = (await ctx.cookies()).find((c) => c.name === "mt_session_id")?.value ?? null;
  note(`browser session ${sid ? sid.slice(0, 8) + "…" : "(none — a dev server does not mint one)"}`);

  const chip = page.locator('main [role="group"] button').first();
  if (!(await chip.count())) fail("no one-tap picks rendered");
  else {
    const box = await chip.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1200);
  }
  const cont = page.getByRole("button", { name: /^continue/i }).first();
  if (!(await cont.isEnabled().catch(() => false))) fail("Continue not enabled");
  await cont.click();
  await page.waitForTimeout(1500);
  const vibe = page.getByText(/foodie|cultural|adventure/i).first();
  if (await vibe.isVisible().catch(() => false)) await vibe.click().catch(() => {});
  await page.waitForTimeout(400);
  const gen = page.getByRole("button", { name: /generate/i }).first();
  if (!(await gen.isEnabled().catch(() => false))) fail("Generate not enabled");
  await gen.click();
  const rendered = await page
    .waitForFunction(() => /\bday 1\b/i.test(document.body.innerText), null, { timeout: 120000 })
    .then(() => true).catch(() => false);
  if (!rendered) { fail("no itinerary rendered"); throw new Error("stop"); }
  ok("itinerary rendered");
  await page.waitForTimeout(1500);

  // Save, signed out -> the auth wall.
  const save = page.getByRole("button", { name: /^save trip$/i }).first();
  if (!(await save.count())) fail("no Save button on the result view");
  else {
    await save.click();
    const dialog = await page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
    if (!dialog) fail("the auth prompt did not open on Save");
    else ok("auth prompt opened");
    await page.screenshot({ path: `${SHOTS}/auth-modal.png` });
  }

  // Ask for the magic link (intercepted, so nothing is mailed).
  const emailField = page.getByRole("dialog").locator('input[type="email"]').first();
  if (!(await emailField.count())) fail("no email field in the auth prompt");
  else {
    await emailField.fill(`mt-probe+otp-${Date.now()}@test.local`);
    await emailField.press("Enter");
    await page.waitForTimeout(3000);
    if (!otpIntercepted) note("the OTP request was not intercepted — check the route pattern");
    else ok("magic-link request intercepted (no real auth email sent)");
  }

  console.log("");
  console.log("=== 3. both browser steps reached the consent-free funnel ===");
  if (!sid) note("no session cookie on this server — skipping (run against production for this assertion)");
  else {
    const steps = await stepsFor(sid);
    note(`rows for the browser session: ${[...new Set(steps)].join(", ")}`);
    if (!steps.includes("auth_modal_shown")) fail("no auth_modal_shown row");
    else ok("auth_modal_shown written");
    if (!steps.includes("otp_requested")) fail("no otp_requested row");
    else ok("otp_requested written");
    if (!steps.includes("save_blocked_anon")) note("no save_blocked_anon row (the wall may have been reached another way)");
  }

  await ctx.close();
} catch (err) {
  if (err.message !== "stop") fail(`unexpected error: ${err.message}`);
} finally {
  await browser.close();
  try { await db.from("wizard_step_events").delete().eq("session_id", probeSession); } catch { /* best effort */ }
  try { await db.from("trips").delete().eq("user_id", uid); } catch { /* best effort */ }
  try { await db.auth.admin.deleteUser(uid); } catch { /* best effort */ }
  note("probe session rows, trips and account deleted");
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
