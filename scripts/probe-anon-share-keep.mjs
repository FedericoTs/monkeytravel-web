/**
 * A signed-out planner who shares and then signs in must end up with ONE trip:
 * the one they shared, claimed, not a second auto-saved copy.
 *
 * Activation item #2 (2026-09-02): 56 signed-out shares in 30 days, 0 claims.
 * This probe walks the loop the way a planner does, on the real site:
 *
 *   1. signed out: generate, "Share this trip", the link + "Keep this trip" row
 *   2. the database: an ownerless trip row, and share_link_created carrying
 *      the sharer's session
 *   3. "Keep this trip" opens the sign-up door
 *   4. back on /trips/new signed out: the "your trip is still here" reminder
 *   5. sign in (password login, same browser): the trip is claimed, stamped,
 *      and there is exactly one trip for the account, still one 20s later
 *
 * Costs one real generation (~30s, ~$0.002). Creates and deletes its own
 * account, trip and funnel rows; each cleanup step is isolated.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-anon-share-keep.mjs
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
const SHOTS = process.env.SHOTS || ".probe-shots/anon-share-keep";
mkdirSync(SHOTS, { recursive: true });
const { url, key } = creds();
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissCookies(page) {
  const ess = page.getByRole("button", { name: /essential only/i });
  if (await ess.isVisible().catch(() => false)) { await ess.click(); await page.waitForTimeout(400); }
}
async function poll(fn, { tries = 10, delay = 2000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(delay);
  }
  return null;
}

const email = `mt-probe+anonkeep-${Date.now()}@test.local`;
const password = "Probe!" + Math.random().toString(36).slice(2, 12);
const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error("could not create probe user:", error.message); process.exit(1); }
const uid = created.user.id;

let anonTripId = null;
const browser = await chromium.launch();
const consoleErrors = [];
try {
  // A normal desktop user agent: the middleware's crawler filter matches
  // "headless", and a filtered visitor never gets an mt_session_id cookie,
  // which would make the share_link_created session check fail for the
  // probe alone.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 160)); });

  console.log("\n=== 1. signed out: generate, then share ===");
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
  }
  const destination = await page.locator('input[role="combobox"]').first().inputValue().catch(() => "");
  note(`destination "${destination}"`);
  const cont = page.getByRole("button", { name: /^continue/i }).first();
  if (!(await cont.isEnabled().catch(() => false))) fail("Continue not enabled after the one-tap");
  await cont.click();
  await page.waitForTimeout(1200);
  const vibe = page.getByText(/foodie|cultural|adventure/i).first();
  if (await vibe.isVisible().catch(() => false)) await vibe.click().catch(() => {});
  await page.waitForTimeout(400);
  const gen = page.getByRole("button", { name: /generate/i }).first();
  if (!(await gen.isEnabled().catch(() => false))) fail("Generate not enabled on step 2");
  const t0 = Date.now();
  await gen.click();
  const rendered = await page
    .waitForFunction(() => /\bday 1\b/i.test(document.body.innerText), null, { timeout: 100000 })
    .then(() => true).catch(() => false);
  note(`result rendered=${rendered} after ${Math.round((Date.now() - t0) / 1000)}s`);
  if (!rendered) fail("no itinerary rendered within 100s");

  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/result.png`, fullPage: true });
  const shareBtn = page.getByRole("button", { name: /share this trip/i }).first();
  if (!(await shareBtn.isVisible().catch(() => false))) {
    fail("no 'Share this trip' button for the signed-out planner");
    const names = await page.locator("button:visible").evaluateAll((els) => els.map((e) => (e.textContent || "").trim().slice(0, 40)).filter(Boolean));
    note(`visible buttons: ${JSON.stringify(names.slice(0, 40))}`);
    note(`console errors so far: ${JSON.stringify(consoleErrors.slice(0, 8))}`);
    note(`url ${page.url()} | has Regenerate=${await page.getByRole("button", { name: /regenerate/i }).first().isVisible().catch(() => false)}`);
  } else {
    await shareBtn.click();
    const keepRow = page.locator("[data-anon-share-keep]").first();
    const keepVisible = await keepRow.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
    if (!keepVisible) fail("the share link was minted but the 'Keep this trip' row did not appear");
    else ok("share link minted and the keep row is showing");
    const keepBtn = page.getByRole("button", { name: /keep this trip/i }).first();
    if (!(await keepBtn.isVisible().catch(() => false))) fail("no 'Keep this trip' button in the keep row");
    await page.screenshot({ path: `${SHOTS}/share-ready.png` });
  }
  const shareUrl = await page.locator("input[readonly]").first().inputValue().catch(() => "");
  const shareToken = shareUrl.split("/shared/")[1]?.split(/[?#]/)[0] ?? null;
  if (!shareToken) fail(`could not read the share URL (got "${shareUrl}")`);
  else note(`share token ${shareToken}`);

  console.log("\n=== 2. the database ===");
  if (shareToken) {
    const row = await poll(async () => {
      const { data } = await db.from("trips").select("id, user_id, claim_token, trip_meta").eq("share_token", shareToken).maybeSingle();
      return data ?? null;
    }, { tries: 8, delay: 1500 });
    if (!row) fail("no trip row for the share token");
    else {
      anonTripId = row.id;
      if (row.user_id !== null) fail("the shared trip already has an owner");
      if (!row.claim_token) fail("the shared trip has no claim token");
      else ok(`ownerless trip ${row.id} with a claim token`);
    }
    if (anonTripId) {
      const ev = await poll(async () => {
        const { data } = await db.from("funnel_events").select("session_id, metadata").eq("trip_id", anonTripId).eq("event_type", "share_link_created").maybeSingle();
        return data ?? null;
      }, { tries: 6, delay: 1500 });
      if (!ev) fail("no share_link_created funnel row for the anonymous share");
      else if (!ev.session_id) fail("share_link_created was logged without the sharer's session_id");
      else ok(`share_link_created carries session ${ev.session_id.slice(0, 8)}… (anonymous=${ev.metadata?.anonymous})`);
    }
  }

  console.log("\n=== 3. 'Keep this trip' opens the sign-up door ===");
  const keepBtn = page.getByRole("button", { name: /keep this trip/i }).first();
  if (await keepBtn.isVisible().catch(() => false)) {
    await keepBtn.click();
    const door = await page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    if (!door) fail("clicking 'Keep this trip' did not open the auth prompt");
    else ok("auth prompt opened");
    await page.screenshot({ path: `${SHOTS}/keep-auth-prompt.png` });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(600);
  }

  console.log("\n=== 4. back on /trips/new, still signed out: the reminder ===");
  await page.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("h1", { timeout: 60000 });
  const banner = page.locator("[data-pending-claim-banner]").first();
  const bannerVisible = await banner.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
  if (!bannerVisible) fail("no 'your trip is still here' banner for a browser holding a claim token");
  else {
    const text = (await banner.textContent()) ?? "";
    const dest = destination.split(",")[0].trim();
    if (dest && !text.toLowerCase().includes(dest.toLowerCase())) fail(`banner does not name the destination "${dest}": "${text.slice(0, 80)}"`);
    else ok(`reminder banner names ${dest || "the trip"}`);
    await page.screenshot({ path: `${SHOTS}/pending-banner.png` });
  }

  console.log("\n=== 5. sign in: claimed, stamped, exactly one trip ===");
  await page.goto(`${BASE}/en/auth/login?redirect=${encodeURIComponent("/trips/new")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);
  await dismissCookies(page);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').first().press("Enter");
  await page.waitForFunction(() => !location.pathname.includes("/auth/login"), null, { timeout: 90000 }).catch(() => {});
  if (page.url().includes("/auth/login")) fail("sign-in did not complete");
  else note(`signed in, landed on ${new URL(page.url()).pathname}`);
  if (!page.url().includes("/trips/new")) {
    await page.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 120000 });
  }
  await page.waitForSelector("h1", { timeout: 60000 }).catch(() => {});
  // If the draft-recovery banner offers to restore the itinerary, take it: that
  // is the path where auto-save and the claim would have collided.
  await page.screenshot({ path: `${SHOTS}/after-signin-landing.png` });
  const restore = page.getByRole("button", { name: /restore trip|restore|resume|continue where/i }).first();
  if (await restore.isVisible({ timeout: 8000 }).catch(() => false)) {
    await restore.click().catch(() => {});
    note("restored the draft (adoption path: auto-save must adopt, not insert)");
  } else note("no draft-restore offer (claim-only path)");

  const claimed = await poll(async () => {
    const { data } = await db.from("trips").select("id, claim_token, trip_meta").eq("user_id", uid).is("deleted_at", null);
    const rows = data ?? [];
    return rows.length ? rows : null;
  }, { tries: 20, delay: 2000 });
  if (!claimed) fail("no trip for the account 40s after sign-in: the claim never happened");
  else {
    const mine = claimed.find((r) => r.id === anonTripId);
    if (!mine) fail(`the shared trip ${anonTripId} was not claimed (account has ${claimed.map((r) => r.id).join(", ")})`);
    else {
      if (mine.claim_token !== null) fail("claim_token not cleared");
      if (!mine.trip_meta?.claimed_at) fail("trip_meta.claimed_at not stamped");
      else ok(`shared trip claimed and stamped (${mine.trip_meta.claimed_at})`);
    }
    if (claimed.length !== 1) fail(`expected exactly one trip for the account, found ${claimed.length} (a duplicate auto-save)`);
    else ok("exactly one trip for the account");
  }
  await sleep(20000);
  const { data: later } = await db.from("trips").select("id").eq("user_id", uid).is("deleted_at", null);
  if ((later ?? []).length !== 1) fail(`20s later the account has ${(later ?? []).length} trips: a late auto-save duplicated the claimed trip`);
  else ok("still exactly one trip 20s later");

  const claimedEv = await poll(async () => {
    if (!anonTripId) return null;
    const { data } = await db.from("funnel_events").select("user_id").eq("trip_id", anonTripId).eq("event_type", "trip_claimed").maybeSingle();
    return data ?? null;
  }, { tries: 5, delay: 1500 });
  if (!claimedEv) fail("no trip_claimed funnel row");
  else if (claimedEv.user_id !== uid) fail("trip_claimed logged with the wrong user");
  else ok("trip_claimed funnel row carries the account");

  const claimedBanner = await page.locator("[data-claimed-trip-banner]").first().isVisible().catch(() => false);
  const notSaved = await page.getByText(/^not saved$/i).first().isVisible().catch(() => false);
  note(`ui: claimed banner=${claimedBanner}, 'Not saved' pill=${notSaved}`);
  if (notSaved) fail("the result view still says 'Not saved' after the claim");
  await page.screenshot({ path: `${SHOTS}/after-signin.png` });

  const relevant = consoleErrors.filter((e) => /auto-save|claim|pending/i.test(e));
  if (relevant.length) fail(`console errors: ${relevant.join(" | ")}`);
  else ok("no claim/auto-save console errors");

  await ctx.close();
} finally {
  await browser.close();
  if (anonTripId) { try { await db.from("funnel_events").delete().eq("trip_id", anonTripId); } catch { /* best effort */ } }
  try { await db.from("trips").delete().eq("user_id", uid); } catch { /* best effort */ }
  if (anonTripId) { try { await db.from("trips").delete().eq("id", anonTripId); } catch { /* best effort */ } }
  try { await db.auth.admin.deleteUser(uid); } catch { /* best effort */ }
  note("probe user, trip and funnel rows deleted");
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
