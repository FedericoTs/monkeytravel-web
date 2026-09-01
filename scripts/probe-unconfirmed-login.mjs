/**
 * What does a never-confirmed user actually see when they come back to log in?
 *
 * Measured 2026-09-01: 36 of 181 email signups (19.9%) have email_confirmed_at
 * IS NULL. All 36 had a confirmation email sent, none ever signed in, all hold
 * zero trips. They were shown "check your inbox for the confirmation email" —
 * a dead end when that message is weeks old and the link has expired — and the
 * only resend button in the app lived on the signup success screen, gone the
 * moment they navigated away.
 *
 * Creates ONE unconfirmed throwaway account, drives the real login form, and
 * asserts the resend affordance is offered. Deletes the account afterwards.
 *
 *   BASE_URL=http://localhost:3001 node scripts/probe-unconfirmed-login.mjs
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

const email = `mt-probe+unconfirmed-${Date.now()}@test.local`;
const password = "Probe!" + Math.random().toString(36).slice(2, 14);

const { data: created, error: createErr } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: false, // the whole point: never confirmed
});
if (createErr) {
  console.error("could not create the probe user:", createErr.message);
  process.exit(1);
}
console.log(`\n  created ${email} (email_confirm: false)`);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto(`${BASE}/en/auth/login`, { waitUntil: "domcontentloaded" });

// Wait for hydration before typing. Filling a controlled input pre-hydration
// looks like it worked and is then wiped by React's first render — which is
// exactly what happened here: the password stuck, the email silently did not,
// and the form failed client validation instead of reaching Supabase.
await page.waitForTimeout(3000);
const essential = page.getByRole("button", { name: /essential only/i });
if (await essential.isVisible().catch(() => false)) {
  await essential.click();
  await page.waitForTimeout(500);
}

await page.locator('input[type="email"]').first().fill(email);
await page.locator('input[type="password"]').first().fill(password);

// Assert the values actually landed, so a silent wipe fails loudly here
// rather than masquerading as "the app did not show the button".
const filledEmail = await page.locator('input[type="email"]').first().inputValue();
if (filledEmail !== email) {
  console.error(`  form not ready: email field holds "${filledEmail}"`);
  await browser.close();
  await db.auth.admin.deleteUser(created.user.id);
  process.exit(1);
}
// Submit via the form itself: the visible button label is localised and a
// name-based locator is brittle here.
await page.locator('input[type="password"]').first().press("Enter");
await page.waitForTimeout(6000);

if (process.env.DEBUG_PROBE) {
  await page.screenshot({ path: ".auth/unconfirmed-login.png" });
  const body = await page.locator("body").innerText();
  console.log("--- page text ---");
  console.log(body.slice(0, 700));
}

const alert = await page.locator('[role="alert"]').first().innerText().catch(() => "");
const resendBtn = page.getByRole("button", { name: /new confirmation link/i });
const offered = await resendBtn.isVisible().catch(() => false);

console.log("\n=== what the user sees ===");
console.log(alert.split("\n").map((l) => "  " + l).join("\n"));
console.log(`\n  resend button offered : ${offered ? "YES" : "*** NO ***"}`);

let afterClick = "";
if (offered) {
  await resendBtn.click();
  await page.waitForTimeout(6000);
  afterClick = await page.locator('[role="alert"]').first().innerText().catch(() => "");
  const sent = /sent\./i.test(afterClick);
  const surfaced = /too many|couldn't send/i.test(afterClick);
  console.log(`  after clicking        : ${sent ? "confirmed sent" : surfaced ? "error SURFACED (not swallowed)" : "no feedback"}`);
  console.log(afterClick.split("\n").map((l) => "    " + l).join("\n"));
}

await browser.close();
await db.auth.admin.deleteUser(created.user.id);
console.log(`\n  cleaned up ${email}`);

const pass = offered && (/sent\./i.test(afterClick) || /too many|couldn't send/i.test(afterClick));
console.log(
  pass
    ? "\n  PASS — the dead end now offers a fix, and its outcome is visible."
    : "\n  *** FAIL — no resend offered, or its result was silent. ***"
);
process.exit(pass ? 0 : 2);
