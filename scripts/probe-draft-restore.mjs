/**
 * A signed-out itinerary must survive EVERY path into an account — not just
 * the Save modal.
 *
 * Until 2026-09-02 the wizard auto-restored the localStorage draft only when
 * `pendingTripGeneration` was set, and that flag is written in exactly four
 * places, all inside AuthPromptModal. So a planner who generated signed-out
 * and then signed in through the header, the login page or a magic link came
 * back to a blank wizard with their itinerary sitting unread beside it.
 * Measured: of 96 signed-out result sessions in 30 days that end with a
 * signed-in user on the same session cookie, 13 finished with no trip at all.
 *
 * Two passes:
 *   A. the path that was broken — sign in via /auth/login, never touching
 *      Save, with pendingTripGeneration provably absent.
 *   B. the legacy Save-modal path — same draft, with the flag seeded exactly
 *      as AuthPromptModal writes it. Seeded rather than driven through the
 *      modal so the probe costs one generation, not two; the branch under
 *      test is the wizard's, not the modal's.
 *
 * Both must end with EXACTLY ONE trip row: the duplicate risk is real, since
 * auto-save, the #93 claim adoption and the redemption effect all persist.
 *
 * Costs one real generation (~30s, ~$0.002). Creates and deletes its own
 * account and trips; each cleanup step is isolated.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-draft-restore.mjs
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
const SHOTS = process.env.SHOTS || ".probe-shots/draft-restore";
mkdirSync(SHOTS, { recursive: true });
const { url, key } = creds();
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const DRAFT_KEY = "monkeytravel-itinerary-draft";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissCookies(page) {
  const b = page.getByRole("button", { name: /essential only/i });
  if (await b.isVisible().catch(() => false)) { await b.click(); await page.waitForTimeout(400); }
}
async function tripsFor(uid) {
  const { data } = await db.from("trips").select("id, title, trip_meta").eq("user_id", uid).is("deleted_at", null);
  return data ?? [];
}
async function pollTrips(uid, want, ms = 14000) {
  const until = Date.now() + ms;
  let rows = [];
  while (Date.now() < until) {
    rows = await tripsFor(uid);
    if (rows.length >= want) return rows;
    await sleep(1500);
  }
  return rows;
}
async function signIn(page, email, password) {
  await page.goto(`${BASE}/en/auth/login?redirect=${encodeURIComponent("/trips/new")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);
  await dismissCookies(page);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').first().press("Enter");
  await page.waitForFunction(() => !location.pathname.includes("/auth/login"), null, { timeout: 90000 }).catch(() => {});
}

const email = `mt-probe+draft-${Date.now()}@test.local`;
const password = "Probe!" + Math.random().toString(36).slice(2, 12);
const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error("could not create probe user:", error.message); process.exit(1); }
const uid = created.user.id;

const browser = await chromium.launch();
let draftJson = null;
let destination = "";
let dayCount = 0;
try {
  // ---------------------------------------------------------------- pass A
  console.log("\n=== A1. signed out: generate an itinerary ===");
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", userAgent: UA });
  const page = await ctxA.newPage();
  const warm = await ctxA.newPage();
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
  }
  destination = await page.locator('input[role="combobox"]').first().inputValue().catch(() => "");
  const cont = page.getByRole("button", { name: /^continue/i }).first();
  if (!(await cont.isEnabled().catch(() => false))) fail("Continue not enabled");
  await cont.click();
  await page.waitForTimeout(1200);
  const vibe = page.getByText(/foodie|cultural|adventure/i).first();
  if (await vibe.isVisible().catch(() => false)) await vibe.click().catch(() => {});
  await page.waitForTimeout(400);
  const gen = page.getByRole("button", { name: /generate/i }).first();
  if (!(await gen.isEnabled().catch(() => false))) fail("Generate not enabled");
  const t0 = Date.now();
  await gen.click();
  const rendered = await page
    .waitForFunction(() => /\bday 1\b/i.test(document.body.innerText), null, { timeout: 100000 })
    .then(() => true).catch(() => false);
  note(`destination "${destination}", rendered=${rendered} after ${Math.round((Date.now() - t0) / 1000)}s`);
  if (!rendered) fail("no itinerary rendered within 100s");

  console.log("\n=== A2. the draft holds the itinerary, and the Save flag is absent ===");
  await page.waitForTimeout(1500);
  const storage = await page.evaluate((k) => ({
    draft: localStorage.getItem(k),
    pending: localStorage.getItem("pendingTripGeneration"),
  }), DRAFT_KEY);
  draftJson = storage.draft;
  if (!draftJson) fail(`no ${DRAFT_KEY} in localStorage`);
  else {
    const parsed = JSON.parse(draftJson);
    dayCount = parsed.generatedItinerary?.days?.length ?? 0;
    if (!parsed.generatedItinerary) fail("the draft carries no generatedItinerary");
    else ok(`draft holds ${dayCount} days for "${parsed.destination}"`);
  }
  if (storage.pending === "true") fail("pendingTripGeneration is already set — this would not test the broken path");
  else ok("pendingTripGeneration is absent, so only the new code path can restore");

  console.log("\n=== A3. sign in via the LOGIN PAGE, never the Save button ===");
  await signIn(page, email, password);
  note(`landed on ${new URL(page.url()).pathname}`);
  if (!page.url().includes("/trips/new")) {
    await page.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 120000 });
  }
  await page.waitForSelector("h1", { timeout: 60000 }).catch(() => {});

  console.log("\n=== A4. the itinerary is back with ZERO clicks ===");
  const back = await page
    .waitForFunction(() => /\bday 1\b/i.test(document.body.innerText), null, { timeout: 30000 })
    .then(() => true).catch(() => false);
  if (!back) fail("the itinerary did NOT come back on its own after signing in");
  else ok("result view rendered without any interaction");
  // The destination lives in the hero, which paints only after its cover
  // image loads — asserting on body text alone tests timing, not the product.
  // Give it a moment, report what is on screen, and keep the hard assertion
  // for the persisted trip below, which is the guarantee that matters.
  const city = destination.split(",")[0].trim();
  const onScreen = await page
    .waitForFunction((c) => !c || document.body.innerText.toLowerCase().includes(c.toLowerCase()), city, { timeout: 15000 })
    .then(() => true).catch(() => false);
  const body = await page.evaluate(() => document.body.innerText);
  // Count the "Day N" headings with a plain split rather than a regex: the
  // escape sequences in a pattern have been mangled by tooling on the way
  // into this file before, and a silently-broken regex would make this
  // assertion pass or fail for the wrong reason.
  const daysOnScreen = body.split("Day ").length - 1;
  note(`day headings visible: ${daysOnScreen} (draft had ${dayCount}); destination on screen: ${onScreen}`);
  if (daysOnScreen === 0) fail("the result view rendered no day headings");
  else ok(`${daysOnScreen} day headings restored`);
  await page.screenshot({ path: `${SHOTS}/restored.png` });

  console.log("\n=== A5. exactly one trip row ===");
  const rowsA = await pollTrips(uid, 1);
  if (rowsA.length === 0) fail("no trip row after the restore — the itinerary was restored but never persisted");
  else if (rowsA.length > 1) fail(`${rowsA.length} trip rows — the restore duplicated the trip`);
  else {
    ok(`exactly one trip row (${rowsA[0].id})`);
    // The real guarantee: the saved trip IS the one drafted before sign-in,
    // not a fresh or different itinerary.
    const saved = `${rowsA[0].title ?? ""} ${rowsA[0].trip_meta?.destination ?? ""}`.toLowerCase();
    if (city && !saved.includes(city.toLowerCase())) fail(`the saved trip is not the drafted one: "${saved.trim()}" lacks "${city}"`);
    else if (city) ok(`the saved trip is the drafted "${city}" one`);
  }
  await sleep(8000);
  const rowsA2 = await tripsFor(uid);
  if (rowsA2.length !== 1) fail(`8s later the account has ${rowsA2.length} trips`);
  else ok("still exactly one trip 8s later");

  console.log("\n=== A6. the restore is visible in the consent-free funnel ===");
  const sid = (await ctxA.cookies()).find((c) => c.name === "mt_session_id")?.value ?? null;
  if (!sid) note("no mt_session_id cookie (filtered visitor) — skipping the funnel assertion");
  else {
    let steps = [];
    for (let i = 0; i < 8; i++) {
      const { data } = await db.from("wizard_step_events").select("step").eq("session_id", sid);
      steps = (data ?? []).map((r) => r.step);
      if (steps.includes("draft_restored")) break;
      await sleep(2000);
    }
    note(`steps for this session: ${[...new Set(steps)].join(", ")}`);
    if (!steps.includes("draft_restored")) fail("no draft_restored row — all three copies of the step list must be in lockstep");
    else ok("draft_restored row written");
    if (steps.includes("save_failed")) fail("a save_failed row was written");
    else ok("no save_failed row");
  }
  await ctxA.close();

  // ---------------------------------------------------------------- pass B
  console.log("\n=== B. the legacy Save-modal path still works, and still makes ONE trip ===");
  for (const t of await tripsFor(uid)) await db.from("trips").delete().eq("id", t.id);
  note("cleared the account's trips so pass B counts only its own");
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", userAgent: UA });
  const pageB = await ctxB.newPage();
  // Seed exactly what AuthPromptModal writes before it sends someone to auth.
  await pageB.goto(`${BASE}/en`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pageB.evaluate(([k, d]) => {
    localStorage.setItem(k, d);
    localStorage.setItem("pendingTripGeneration", "true");
  }, [DRAFT_KEY, draftJson]);
  await signIn(pageB, email, password);
  if (!pageB.url().includes("/trips/new")) {
    await pageB.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 120000 });
  }
  const backB = await pageB
    .waitForFunction(() => /\bday 1\b/i.test(document.body.innerText), null, { timeout: 30000 })
    .then(() => true).catch(() => false);
  if (!backB) fail("the legacy flag path no longer restores the itinerary");
  else ok("legacy path restored the itinerary");
  const rowsB = await pollTrips(uid, 1);
  if (rowsB.length !== 1) fail(`legacy path produced ${rowsB.length} trip rows, expected exactly 1`);
  else ok("exactly one trip row on the legacy path too");
  await sleep(8000);
  const rowsB2 = await tripsFor(uid);
  if (rowsB2.length !== 1) fail(`8s later the legacy path has ${rowsB2.length} trips`);
  else ok("still exactly one trip 8s later");
  await ctxB.close();
} catch (err) {
  fail(`unexpected error: ${err.message}`);
} finally {
  await browser.close();
  try { await db.from("trips").delete().eq("user_id", uid); } catch { /* best effort */ }
  try { await db.auth.admin.deleteUser(uid); } catch { /* best effort */ }
  note("probe user and trips deleted");
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
