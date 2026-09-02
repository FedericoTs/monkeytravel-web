/**
 * A signed-in generation must become a trip row without anyone clicking Save.
 *
 * Activation priority #3 (2026-09-02): six signed-in users in 30 days reached
 * a rendered itinerary and no save was ever attempted. This probe does what
 * they did — sign in, one-tap a destination, continue, generate — and then
 * asks the database, not the UI, whether the trip exists. It also asserts the
 * consent-free funnel row `saved` was written and no `save_failed` was.
 *
 * Costs one real generation (~30s, ~$0.002). Creates and deletes its own
 * account and trip; each cleanup step is isolated so neither can skip the other.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-auto-save.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, mkdirSync } from "node:fs";

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
const SHOTS = process.env.SHOTS || ".probe-shots/auto-save";
mkdirSync(SHOTS, { recursive: true });
const { url, key } = creds();
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);

async function dismissCookies(page) {
  const ess = page.getByRole("button", { name: /essential only/i });
  if (await ess.isVisible().catch(() => false)) { await ess.click(); await page.waitForTimeout(400); }
}

const email = `mt-probe+autosave-${Date.now()}@test.local`;
const password = "Probe!" + Math.random().toString(36).slice(2, 12);
const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error("could not create probe user:", error.message); process.exit(1); }
const uid = created.user.id;

const browser = await chromium.launch();
const consoleErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 160)); });

  console.log("\n=== 1. sign in ===");
  await page.goto(`${BASE}/en/auth/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);
  await dismissCookies(page);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').first().press("Enter");
  await page.waitForFunction(() => !location.pathname.includes("/auth/login"), null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (page.url().includes("/auth/login")) fail("sign-in did not complete");
  else ok(`signed in, landed on ${new URL(page.url()).pathname}`);

  console.log("\n=== 2. one-tap a destination, continue, generate ===");
  // Warm the route on a throwaway page: a cold dev server compiles the wizard
  // on first hit and that alone can exceed a minute, which would read as
  // "no heading" when nothing is wrong.
  const warm = await ctx.newPage();
  await warm.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 180000 }).catch(() => {});
  await warm.close();
  await page.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForSelector("h1", { timeout: 120000 });
  await page.waitForTimeout(2600);
  await dismissCookies(page);
  const chip = page.locator('main [role="group"] button').first();
  if (!(await chip.count())) fail("no one-tap picks rendered");
  else {
    const box = await chip.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1200);
    ok(`tapped "${(await page.locator('input[role="combobox"]').first().inputValue().catch(() => "?"))}"`);
  }
  const cont = page.getByRole("button", { name: /^continue/i }).first();
  if (!(await cont.isEnabled().catch(() => false))) fail("Continue not enabled after the one-tap");
  await cont.click();
  await page.waitForTimeout(1200);
  // Step 2 needs at least one vibe; pick one if the seasonal seed left it empty.
  const vibe = page.getByText(/foodie|cultural|adventure/i).first();
  if (await vibe.isVisible().catch(() => false)) await vibe.click().catch(() => {});
  await page.waitForTimeout(400);
  const gen = page.getByRole("button", { name: /generate/i }).first();
  if (!(await gen.isEnabled().catch(() => false))) fail("Generate not enabled on step 2");
  const t0 = Date.now();
  await gen.click();
  ok("generation started");

  // The result view: wait for an itinerary day to render (up to 100s).
  const rendered = await page
    // "Day 1" only — the generating screen already says "itinerary".
    .waitForFunction(() => /\bday 1\b/i.test(document.body.innerText), null, { timeout: 100000 })
    .then(() => true)
    .catch(() => false);
  note(`result rendered=${rendered} after ${Math.round((Date.now() - t0) / 1000)}s`);
  if (!rendered) fail("no itinerary rendered within 100s");
  await page.screenshot({ path: `${SHOTS}/result.png` });

  console.log("\n=== 3. the database, not the UI ===");
  let trip = null;
  for (let i = 0; i < 15 && !trip; i++) {
    const { data } = await db.from("trips").select("id, title, trip_meta, deleted_at").eq("user_id", uid).limit(1);
    if (data && data.length) trip = data[0];
    else await new Promise((r) => setTimeout(r, 3000));
  }
  if (!trip) fail("NO trip row for the probe user 45s after the result rendered - the auto-save did not persist");
  else {
    ok(`trip row exists: ${trip.id} "${trip.title}" save_arm=${trip.trip_meta?.save_arm ?? "?"}`);
    if (trip.trip_meta?.save_arm !== "auto") fail(`expected save_arm=auto, got ${trip.trip_meta?.save_arm}`);
  }
  // The `saved` row is a fire-and-forget keepalive POST from the browser; it
  // can land a beat after the trips row is visible. Poll briefly.
  let steps = [];
  for (let i = 0; i < 8; i++) {
    const { data: ev } = await db.from("wizard_step_events").select("step").eq("user_id", uid);
    steps = (ev ?? []).map((r) => r.step);
    if (steps.includes("saved") || steps.includes("save_failed")) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  note(`wizard_step_events for the probe user: ${[...new Set(steps)].join(", ")}`);
  if (!steps.includes("saved")) fail("no `saved` funnel row was written");
  else ok("`saved` funnel row written");
  if (steps.includes("save_failed")) fail("a `save_failed` row was written");
  else ok("no `save_failed` row");

  const pill = await page.getByText(/^not saved$/i).first().isVisible().catch(() => false);
  if (pill) fail("the 'Not saved' pill is still showing after the auto-save");
  else ok("no 'Not saved' pill in the result view");

  const authErrors = consoleErrors.filter((e) => /auto-save|useAutoSaveTrip/i.test(e));
  if (authErrors.length) fail(`auto-save console errors: ${authErrors.join(" | ")}`);
  else ok("no auto-save console errors");

  await ctx.close();
} finally {
  await browser.close();
  try { await db.from("trips").delete().eq("user_id", uid); } catch { /* best effort */ }
  try { await db.auth.admin.deleteUser(uid); } catch { /* best effort */ }
  note("probe user + trip deleted");
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
