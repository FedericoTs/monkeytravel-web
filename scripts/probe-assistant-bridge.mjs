/**
 * A question-only conversation with the anonymous assistant must end with an
 * offer — and that offer must include the plan itself, not just an account ask.
 *
 * The bridge used to live inside the edit-preview card, gated on
 * `editState === "applied"`, so a session that only ASKED questions was never
 * offered anything. Measured over the 30 days to 2026-09-02 by joining
 * anon_assistant_logs to wizard_step_events on session_id:
 *
 *   edit proposed  70 sessions  saw a bridge   57.1% clicked Save
 *   Q&A only       50 sessions  saw NOTHING    34.0% clicked Save
 *
 * This drives the Q&A-only half specifically: generate signed out, ask one
 * question that is NOT an edit request, and assert the bridge appears in
 * qa_only mode carrying the share affordance (a deliverable needing no
 * account) alongside the save ask. Also asserts the value banner no longer
 * advertises the AI assistant as a post-save unlock while the assistant is
 * live on the same screen.
 *
 * Costs one generation plus one assistant reply. Section 6 mints ONE real
 * ownerless trip row to prove a second mint is unreachable; the probe deletes
 * it, because that row would otherwise be counted as a genuine anonymous share
 * by get_anonymous_loop on the /admin panel.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-assistant-bridge.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, existsSync } from "node:fs";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    // Parsed without a regex on purpose: escape sequences in this file have
    // been mangled by tooling, and a broken pattern here would silently mean
    // "no credentials" and skip the cleanup.
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
const SHOTS = process.env.SHOTS || ".probe-shots/assistant-bridge";
mkdirSync(SHOTS, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const { url: SB_URL, key: SB_KEY } = creds();
const db = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
let mintedToken = null;

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "en-US", userAgent: UA });
  const page = await ctx.newPage();

  console.log("\n=== 1. signed out: generate an itinerary ===");
  const warm = await ctx.newPage();
  await warm.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 180000 }).catch(() => {});
  await warm.close();
  await page.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForSelector("h1", { timeout: 120000 });
  await page.waitForTimeout(2600);
  const ess = page.getByRole("button", { name: /essential only/i });
  if (await ess.isVisible().catch(() => false)) { await ess.click(); await page.waitForTimeout(500); }

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
  if (!(await gen.isEnabled().catch(() => false))) fail("Generate not enabled on step 2");
  await gen.click();
  const rendered = await page
    .waitForFunction(() => /\bday 1\b/i.test(document.body.innerText), null, { timeout: 120000 })
    .then(() => true).catch(() => false);
  if (!rendered) { fail("no itinerary rendered"); throw new Error("stop"); }
  ok("itinerary rendered");
  await page.waitForTimeout(2000);

  console.log("\n=== 2. the value banner no longer advertises the live assistant as locked ===");
  const bannerLies = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("div")];
    const banner = nodes.find((n) => /save to unlock more|unlock/i.test(n.textContent || "") && n.querySelector("button"));
    if (!banner) return null;
    return /ai assistant/i.test(banner.textContent || "");
  });
  if (bannerLies === null) note("value banner not rendered at this viewport — skipping");
  else if (bannerLies) fail("the value banner still lists the AI Assistant as a post-save unlock");
  else ok("value banner no longer claims the AI Assistant is locked");

  console.log("\n=== 3. before asking: no bridge ===");
  if ((await page.locator("[data-assistant-bridge]").count()) > 0) fail("a bridge is showing before the assistant has answered");
  else ok("no bridge before the conversation starts");

  console.log("\n=== 4. ask ONE question that is not an edit request ===");
  const box = page.locator('input[placeholder*="Make day"], input[placeholder*="packed"]').first();
  if (!(await box.count())) {
    // Fall back to the assistant's own text input by proximity to its heading.
    const anyInput = page.locator('form input[type="text"]').last();
    if (!(await anyInput.count())) { fail("could not find the assistant input"); throw new Error("stop"); }
    await anyInput.scrollIntoViewIfNeeded();
    await anyInput.fill("Is this itinerary too packed for a first visit?");
    await anyInput.press("Enter");
  } else {
    await box.scrollIntoViewIfNeeded();
    await box.fill("Is this itinerary too packed for a first visit?");
    await box.press("Enter");
  }
  const answered = await page
    .waitForFunction(() => document.querySelectorAll("[data-assistant-bridge]").length > 0, null, { timeout: 90000 })
    .then(() => true).catch(() => false);
  if (!answered) {
    const err = await page.locator("text=/rate limit|too many|error/i").first().textContent().catch(() => null);
    fail(`no bridge appeared after the assistant answered${err ? ` (page says: ${err.trim().slice(0, 80)})` : ""}`);
  } else ok("the assistant answered and a bridge appeared");

  console.log("\n=== 5. it is the Q&A-only bridge, and it carries the deliverable ===");
  const bridge = page.locator("[data-assistant-bridge]").first();
  const mode = await bridge.getAttribute("data-bridge-mode").catch(() => null);
  if (mode !== "qa_only") fail(`bridge mode is "${mode}", expected "qa_only" for a question-only exchange`);
  else ok("bridge mode is qa_only — the half that previously saw nothing");
  const text = (await bridge.textContent()) ?? "";
  note(`bridge copy: ${text.replace(/\s+/g, " ").trim().slice(0, 120)}`);
  const shareInside = await bridge.getByRole("button", { name: /share this trip/i }).count();
  if (!shareInside) fail("the bridge offers no share affordance — it is still only an account ask");
  else ok("the bridge carries the share deliverable (no account needed)");
  const saveInside = await bridge.getByRole("button", { name: /save trip to keep|keep/i }).count();
  if (!saveInside) note("no save button inside the bridge (expected when the auto-save arm owns persistence)");
  else ok("the save ask is present as the secondary path");
  await bridge.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/qa-bridge.png` });

  console.log("");
  console.log("=== 6. minting the link once must disable every other mint ===");
  // Three share buttons can now be on screen (header, mobile bar, bridge) and
  // each mint creates a REAL ownerless trip row, while the browser keeps only
  // the last claim token. A second mint would strand the first trip and
  // inflate the anonymous-share counts the /admin panel reads.
  const beforeMint = await page.getByRole("button", { name: /share this trip/i }).count();
  note(`share buttons before minting: ${beforeMint}`);
  await bridge.getByRole("button", { name: /share this trip/i }).first().click();
  await page.waitForTimeout(4000);
  const stillMintable = await page.getByRole("button", { name: /share this trip/i }).count();
  if (stillMintable > 0) fail(`${stillMintable} share button(s) can still mint a SECOND anonymous trip`);
  else ok("no share button can mint again");
  const urls = await page.locator("input[readonly]").evaluateAll((els) =>
    [...new Set(els.map((e) => e.value).filter((v) => v && v.includes("/shared/")))]);
  note(`distinct share URLs on screen: ${urls.length}`);
  mintedToken = urls[0] ? urls[0].split("/shared/")[1]?.split(/[?#]/)[0] ?? null : null;
  if (urls.length > 1) fail(`instances minted different links: ${urls.join(" | ")}`);
  else if (urls.length === 1) ok("every instance shows the same single link");
  else note("no readonly link input visible at this width");

  console.log("\n=== 7. exactly one bridge, not one per message ===");
  const count = await page.locator("[data-assistant-bridge]").count();
  if (count !== 1) fail(`${count} bridges rendered; the old code stacked one per applied edit`);
  else ok("exactly one bridge below the conversation");

  await ctx.close();
} catch (err) {
  if (err.message !== "stop") fail(`unexpected error: ${err.message}`);
} finally {
  await browser.close();
  // The one real row this probe creates. Left behind it would be counted as a
  // genuine signed-out share by the activation panel.
  if (mintedToken && db) {
    try {
      const { data } = await db.from("trips").select("id").eq("share_token", mintedToken).maybeSingle();
      if (data?.id) {
        await db.from("funnel_events").delete().eq("trip_id", data.id);
        await db.from("trips").delete().eq("id", data.id);
        note(`minted trip ${data.id} deleted`);
      } else note("no trip row found for the minted token (nothing to clean)");
    } catch (e) {
      note(`cleanup failed for ${mintedToken}: ${e.message}`);
    }
  } else if (mintedToken) {
    note(`WARNING: minted ${mintedToken} but no service-role creds to clean it up`);
  }
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
