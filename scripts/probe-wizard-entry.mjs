/**
 * /trips/new step 1 — entry-experience probe (real browser, real account).
 *
 * MODE=before  documents the defects a cold visitor meets today.
 * MODE=after   asserts the redesigned entry fixed each one.
 *
 *   BASE_URL=http://localhost:3001 MODE=before node scripts/probe-wizard-entry.mjs
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
const MODE = process.env.MODE || "before";
const SHOTS = process.env.SHOTS || ".probe-shots";
mkdirSync(SHOTS, { recursive: true });
const { url, key } = creds();
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);
// expect(observed, {before, after}) — the same probe documents the old
// behaviour and asserts the new one, so before/after is one command apart.
const expect = (label, observed, exp) => {
  const want = exp[MODE];
  if (want === undefined) { note(`${label}: ${JSON.stringify(observed)} (no ${MODE} expectation)`); return; }
  if (observed === want) ok(`${label}: ${JSON.stringify(observed)}`);
  else fail(`${label}: got ${JSON.stringify(observed)}, ${MODE} expects ${JSON.stringify(want)}`);
};

const INPUT = 'input[role="combobox"], input[type="text"]';

async function dismissCookies(page) {
  const ess = page.getByRole("button", { name: /essential only|solo essenziali/i });
  if (await ess.isVisible().catch(() => false)) { await ess.click(); await page.waitForTimeout(400); }
}

async function openWizard(page, query = "") {
  await page.goto(`${BASE}/en/trips/new${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("h1", { timeout: 60000 });
  // CookieConsentBanner mounts behind a 1.5s timer; waiting exactly that long
  // made the mobile-cover check race it on localhost (prod's slower network
  // hid the race). Wait past the timer so the banner is present when checked.
  await page.waitForTimeout(2600);
}

const browser = await chromium.launch();
try {
  // ───────────── 1. anonymous, desktop
  console.log("\n=== 1. anonymous cold visitor, desktop ===");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    await openWizard(page);
    await dismissCookies(page);
    await page.screenshot({ path: `${SHOTS}/${MODE}-anon-desktop.png` });

    const h1 = (await page.locator("h1").first().innerText()).trim();
    note(`h1 = "${h1}"`);

    // Does anything ABOVE the destination input say what this page produces?
    const aboveInput = await page.evaluate((sel) => {
      const input = document.querySelector(sel);
      if (!input) return "";
      const r = input.getBoundingClientRect();
      let txt = "";
      for (const el of document.querySelectorAll("main h1, main h2, main p, main span")) {
        const b = el.getBoundingClientRect();
        if (b.bottom <= r.top && b.width > 0) txt += " " + (el.textContent || "");
      }
      return txt.toLowerCase();
    }, INPUT);
    const saysWhatYouGet = /itinerary|day-by-day|day by day|30 seconds/.test(aboveInput);
    expect("value proposition visible above the input", saysWhatYouGet, { before: false, after: true });

    // DOM order: does an advanced control (multi-city switch) precede the destination input?
    const switchFirst = await page.evaluate((sel) => {
      const sw = document.querySelector('[role="switch"]');
      const input = document.querySelector(sel);
      if (!sw || !input) return null;
      return Boolean(sw.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, INPUT);
    expect("multi-city switch precedes the destination input", switchFirst, { before: true, after: false });

    // The free/no-signup reassurance before the user has typed anything
    const reassuranceEarly = await page
      .locator("main")
      .innerText()
      .then((t) => /free[^.]{0,80}(sign(ing)? up|account)/i.test(t))
      .catch(() => false);
    expect("free-before-signup reassurance visible before typing", reassuranceEarly, { before: false, after: true });

    // Popular picks: accessible names, and what one tap does
    const chips = page.locator("main button").filter({ hasText: /,/ });
    const nChips = await chips.count();
    let unnamed = 0;
    for (let i = 0; i < nChips; i++) {
      const name = (await chips.nth(i).getAttribute("aria-label")) || (await chips.nth(i).innerText());
      if (!name || !name.trim()) unnamed++;
    }
    note(`${nChips} popular picks, ${unnamed} without an accessible name`);
    if (nChips > 0) {
      const before = page.url();
      await chips.first().click();
      await page.waitForTimeout(1200);
      const dest = await page.locator(INPUT).first().inputValue().catch(() => "");
      const header = await page.locator("header").innerText().catch(() => "");
      const stepLabel = header.match(/(\d)\s*\/\s*(\d)/);
      const advanced = Boolean(stepLabel && stepLabel[1] === "2") || page.url() !== before;
      const datesFilled = await page.evaluate(
        () => /\d{1,2}\s+[A-Z][a-z]{2}|[A-Z][a-z]{2}\s+\d{1,2}|20\d\d-\d\d-\d\d/.test(document.querySelector("main")?.innerText || "")
      );
      note(`after one tap: destination="${dest}", advanced=${advanced}, datesFilled=${datesFilled}`);
      expect("one tap on a pick sets the destination", dest.length > 0, { before: true, after: true });
      expect("one tap on a pick also resolves dates or advances", advanced || datesFilled, { before: false, after: true });
    }
    await ctx.close();
  }

  // ───────────── 2. anonymous, mobile: is the heading covered by the cookie banner?
  console.log("\n=== 2. anonymous cold visitor, 375px mobile ===");
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "en-US", isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await openWizard(page);
    await page.screenshot({ path: `${SHOTS}/${MODE}-anon-mobile-banner.png` });
    const covered = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const banner = [...document.querySelectorAll("div")].find(
        (d) => /essential only|accept all/i.test(d.innerText || "") && getComputedStyle(d).position === "fixed"
      );
      if (!h1) return "no-h1";
      if (!banner) return "no-banner";
      const a = h1.getBoundingClientRect(), b = banner.getBoundingClientRect();
      return !(a.bottom <= b.top || a.top >= b.bottom);
    });
    note(`heading vs banner: ${covered}`);
    expect("cookie banner covers the heading on mobile", covered === true, { before: true, after: false });
    await dismissCookies(page);
    const inputInView = await page.evaluate((sel) => {
      const input = document.querySelector(sel);
      if (!input) return false;
      const r = input.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }, INPUT);
    expect("destination input inside the first mobile viewport", inputInView, { before: true, after: true });
    await page.screenshot({ path: `${SHOTS}/${MODE}-anon-mobile.png` });
    await ctx.close();
  }

  // ───────────── 3. fresh signup landing (?auth_event=email_confirmed)
  console.log("\n=== 3. fresh signup landing ===");
  {
    const email = `mt-probe+entry-${Date.now()}@test.local`;
    const password = "Probe!" + Math.random().toString(36).slice(2, 12);
    const { data: created, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: "Probe Person" },
    });
    if (error) fail(`could not create probe user: ${error.message}`);
    else {
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/en/auth/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.waitForTimeout(2000);
        await dismissCookies(page);
        await page.locator('input[type="email"]').first().fill(email);
        await page.locator('input[type="password"]').first().fill(password);
        await page.locator('input[type="password"]').first().press("Enter");
        await page.waitForFunction(() => !location.pathname.includes("/auth/login"), null, { timeout: 90000 }).catch(() => {});
        await page.waitForTimeout(1500);
        if (page.url().includes("/auth/login")) fail("sign-in did not complete");
        else ok("signed in");

        await openWizard(page, "?auth_event=email_confirmed");
        await dismissCookies(page);
        await page.screenshot({ path: `${SHOTS}/${MODE}-fresh-signup.png` });
        const h1 = (await page.locator("h1").first().innerText()).trim();
        note(`fresh-signup h1 = "${h1}"`);
        expect("fresh signup sees something other than the anonymous heading", h1 !== "Where and when?", { before: false, after: true });
        const acknowledged = await page
          .locator("main")
          .innerText()
          .then((t) => /you're in|you’re in|welcome|first trip|all set|let's plan|let’s plan/i.test(t))
          .catch(() => false);
        expect("fresh signup is acknowledged", acknowledged, { before: false, after: true });
        await ctx.close();
      } finally {
        await db.auth.admin.deleteUser(created.user.id).catch(() => {});
        note("probe user deleted");
      }
    }
  }
} finally {
  await browser.close();
}
console.log(failures === 0 ? `\n  PASS (${MODE})\n` : `\n  *** ${failures} FAILURE(S) (${MODE}) ***\n`);
process.exit(failures === 0 ? 0 : 2);
