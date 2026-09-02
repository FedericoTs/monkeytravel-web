/**
 * /trips/new step 1 — entry-experience probe (real browser, real account).
 *
 * MODE=before  documents the defects a cold visitor met before 2026-09-02.
 * MODE=after   asserts the editorial entry fixed each one, and that the
 *              ?step1=classic holdout still renders the old step 1.
 *
 *   BASE_URL=http://localhost:3001 MODE=after node scripts/probe-wizard-entry.mjs
 *
 * Raw-coordinate checks (elementFromPoint, boundingBox) are used on purpose:
 * Playwright's .click() auto-scrolls and hides "the banner covers the
 * heading" — the class of bug this page has had before.
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
const OLD_H1 = "Where and when?";
const NEW_H1 = "Your trip, planned day by day.";
const FIRST_RUN_H1 = "You're in. Let's plan your first trip.";

async function dismissCookies(page) {
  const ess = page.getByRole("button", { name: /essential only|solo essenziali/i });
  if (await ess.isVisible().catch(() => false)) { await ess.click(); await page.waitForTimeout(400); }
}

async function openWizard(page, query = "") {
  await page.goto(`${BASE}/en/trips/new${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("h1", { timeout: 60000 });
  // CookieConsentBanner mounts behind a 1.5s timer; wait past it so the
  // banner is present when its position is checked.
  await page.waitForTimeout(2600);
}

/** The popular picks: the editorial grid, or the classic comma chips. */
function chips(page) {
  return MODE === "after" && !page.__classic
    ? page.locator('main [role="group"] button')
    : page.locator("main button").filter({ hasText: /,/ });
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/en/auth/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);
  await dismissCookies(page);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').first().press("Enter");
  await page.waitForFunction(() => !location.pathname.includes("/auth/login"), null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return !page.url().includes("/auth/login");
}

const browser = await chromium.launch();
try {
  // ───────────── 1. anonymous, desktop
  console.log("\n=== 1. anonymous cold visitor, desktop ===");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    await openWizard(page);
    await page.screenshot({ path: `${SHOTS}/${MODE}-anon-desktop-banner.png` });
    await dismissCookies(page);
    await page.screenshot({ path: `${SHOTS}/${MODE}-anon-desktop.png` });

    const h1 = (await page.locator("h1").first().innerText()).trim();
    note(`h1 = "${h1}"`);
    expect("exactly one h1", await page.locator("h1").count(), { before: 1, after: 1 });
    expect("heading names the output, not the form", h1 === NEW_H1, { before: false, after: true });

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
    expect("value proposition visible above the input", /itinerary|day-by-day|day by day|30 seconds/.test(aboveInput), { before: false, after: true });
    expect("free + no-account promise visible before typing", /free[^.]{0,80}account/.test(aboveInput), { before: false, after: true });

    // DOM order: does the multi-city switch precede the destination input?
    const switchFirst = await page.evaluate((sel) => {
      const sw = document.querySelector('[role="switch"]');
      const input = document.querySelector(sel);
      if (!sw || !input) return null;
      return Boolean(sw.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, INPUT);
    expect("multi-city switch precedes the destination input", switchFirst, { before: true, after: false });

    // Popular picks: count, accessible names, no flag emoji, 44px targets
    const picks = chips(page);
    const nChips = await picks.count();
    let unnamed = 0, emoji = 0, short = 0;
    for (let i = 0; i < nChips; i++) {
      const c = picks.nth(i);
      const name = (await c.getAttribute("aria-label")) || "";
      if (!name.trim()) unnamed++;
      if (/[\u{1F1E6}-\u{1F1FF}]/u.test(await c.innerText())) emoji++;
      const box = await c.boundingBox();
      if (!box || box.height < 44) short++;
    }
    note(`${nChips} picks: ${unnamed} without aria-label, ${emoji} with flag emoji, ${short} under 44px`);
    expect("six popular picks", nChips, { before: 6, after: 6 });
    expect("every pick has an explicit accessible name", unnamed === 0, { before: false, after: true });
    expect("no flag emoji in the picks (renders as 'IT' on Windows)", emoji === 0, { before: false, after: true });
    expect("every pick is a 44px target", short === 0, { before: false, after: true });

    // What ONE tap does
    if (nChips > 0) {
      const box = await picks.first().boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1200);
      const dest = await page.locator(INPUT).first().inputValue().catch(() => "");
      const stepLabel = (await page.locator("header").innerText().catch(() => "")).match(/(\d)\s*\/\s*(\d)/);
      const advanced = Boolean(stepLabel && stepLabel[1] === "2");
      const dateTrigger = page.locator('button[aria-haspopup="dialog"]').first();
      const dateLabel = (await dateTrigger.getAttribute("aria-label")) || "";
      const datesFilled = /\d/.test(dateLabel) && !/add (trip )?dates/i.test(dateLabel);
      const focusOnDate = await page.evaluate(() => document.activeElement?.getAttribute("aria-haspopup") === "dialog");
      const noteVisible = await page.getByText(/pencilled in/i).first().isVisible().catch(() => false);
      const continueBtn = page.getByRole("button", { name: /continue/i });
      const continueEnabled = (await continueBtn.count()) > 0 && (await continueBtn.first().isEnabled());
      note(`after one tap: destination="${dest}", advanced=${advanced}, dates="${dateLabel.slice(0, 60)}", focusOnDate=${focusOnDate}, note=${noteVisible}, continue=${continueEnabled}`);
      expect("one tap sets the destination", dest.length > 0, { before: true, after: true });
      expect("one tap does NOT auto-advance", advanced, { before: false, after: false });
      expect("one tap pencils in dates", datesFilled, { before: false, after: true });
      expect("one tap lights Continue", continueEnabled, { before: false, after: true });
      expect("one tap moves focus to the date field", focusOnDate, { before: false, after: true });
      expect("the pencilled-dates note is shown", noteVisible, { before: false, after: true });
      // What the repo's e2e specs select. Name every match so a second one
      // is diagnosable (a raw-coordinate tap can land on the date trigger as
      // the chips collapse and open the calendar, whose "Next month" matches).
      const likeContinue = page.getByRole("button", { name: /continue|next/i });
      const names = [];
      for (let i = 0; i < (await likeContinue.count()); i++) names.push(((await likeContinue.nth(i).getAttribute("aria-label")) || (await likeContinue.nth(i).innerText())).trim());
      note(`buttons matching /continue|next/i: ${JSON.stringify(names)}`);
      expect("exactly one footer Continue", names.filter((n) => /^continue/i.test(n)).length, { before: 1, after: 1 });
      await page.screenshot({ path: `${SHOTS}/${MODE}-anon-desktop-after-tap.png` });

      // A preset tap replaces the pencilled dates and clears the note
      const weekend = page.getByRole("button", { name: /^weekend$/i }).first();
      if (await weekend.isVisible().catch(() => false)) {
        await weekend.click();
        await page.waitForTimeout(500);
        const noteGone = !(await page.getByText(/pencilled in/i).first().isVisible().catch(() => false));
        expect("choosing a length clears the pencilled note", noteGone, { after: true });
      }
    }
    await ctx.close();
  }

  // ───────────── 2. typed destination → footer state B
  console.log("\n=== 2. typed destination, no dates (footer state B) ===");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    await openWizard(page);
    await dismissCookies(page);
    await page.locator(INPUT).first().fill("Rome");
    await page.keyboard.press("Escape");
    // Close the suggestions dropdown by clicking somewhere inert; it otherwise
    // sits over the dates block and intercepts the click below.
    await page.locator("h1").first().click();
    await page.waitForTimeout(800);
    // Exact name: the old "Not sure about dates yet? Use flexible dates" text
    // link under the picker also CONTAINS the phrase.
    const flexBtn = page.getByRole("button", { name: /^use flexible dates$/i });
    const hasFlex = (await flexBtn.count()) > 0 && (await flexBtn.first().isEnabled());
    const continueDisabled = await page.getByRole("button", { name: /continue/i }).first().isDisabled().catch(() => null);
    note(`typed 'Rome': useFlexibleDates=${hasFlex}, continueDisabled=${continueDisabled}`);
    expect("an ENABLED 'Use flexible dates' replaces the disabled Continue", hasFlex, { before: false, after: true });
    if (hasFlex) {
      await flexBtn.first().click();
      await page.waitForTimeout(800);
      const cont = page.getByRole("button", { name: /continue/i }).first();
      expect("after it, Continue is enabled", await cont.isEnabled().catch(() => false), { after: true });
      expect("and the reassurance line reads the anonymous copy", await page.getByText(/before signing up/i).first().isVisible().catch(() => false), { after: true });
    }
    await ctx.close();
  }

  // ───────────── 3. anonymous, mobile: banner vs heading, input in the fold
  for (const height of [812, 667]) {
    console.log(`\n=== 3. anonymous cold visitor, 375x${height} mobile ===`);
    const ctx = await browser.newContext({ viewport: { width: 375, height }, locale: "en-US", isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await openWizard(page);
    await page.screenshot({ path: `${SHOTS}/${MODE}-anon-mobile-${height}-banner.png` });
    const geo = await page.evaluate((sel) => {
      const h1 = document.querySelector("h1");
      const input = document.querySelector(sel);
      const banner = [...document.querySelectorAll("div")].find(
        (d) => /essential only|accept all/i.test(d.innerText || "") && getComputedStyle(d).position === "fixed"
      );
      const footer = [...document.querySelectorAll("div")].find(
        (d) => getComputedStyle(d).position === "fixed" && /continue|use flexible dates/i.test(d.innerText || "")
      );
      const r = (el) => el ? el.getBoundingClientRect() : null;
      const hb = r(h1), ib = r(input), bb = r(banner), fb = r(footer);
      const cx = hb ? hb.left + hb.width / 2 : 0, cy = hb ? hb.top + hb.height / 2 : 0;
      const hit = document.elementFromPoint(cx, cy);
      return {
        hasBanner: Boolean(banner),
        headingCovered: hb && bb ? !(hb.bottom <= bb.top || hb.top >= bb.bottom) : null,
        headingHitIsHeading: Boolean(hit && (hit === h1 || h1?.contains(hit))),
        inputInFold: ib ? ib.top >= 0 && ib.bottom <= innerHeight : false,
        inputBottom: ib ? Math.round(ib.bottom) : null,
        bannerTop: bb ? Math.round(bb.top) : null,
        // How many px of the input the banner's top edge covers (0 = none).
        inputOverlapPx: ib && bb ? Math.max(0, Math.round(Math.min(ib.bottom, bb.bottom) - Math.max(ib.top, bb.top))) : null,
        bannerAboveFooter: bb && fb ? bb.bottom <= fb.top + 1 : null,
      };
    }, INPUT);
    note(JSON.stringify(geo));
    expect("cookie banner present", geo.hasBanner, { before: true, after: true });
    expect("banner covers the heading", geo.headingCovered, { before: true, after: false });
    expect("the heading is what you hit at its centre", geo.headingHitIsHeading, { before: false, after: true });
    expect("destination input inside the first viewport", geo.inputInFold, { before: true, after: true });
    // 812: the banner (~170-220px card above the ~96px footer) clears the input
    // entirely. 667 (SE/8 class): its top edge may graze the bottom of the
    // 48px input by a few px until answered; the heading and the top of the
    // input stay clear and the primary action is never covered. Allow up to
    // 24px there, none on 812.
    expect("banner overlap with the input is within budget", geo.inputOverlapPx !== null && geo.inputOverlapPx <= (height === 812 ? 0 : 24), { after: true });
    expect("banner sits above the wizard footer", geo.bannerAboveFooter, { after: true });
    await dismissCookies(page);
    await page.screenshot({ path: `${SHOTS}/${MODE}-anon-mobile-${height}.png` });
    await ctx.close();
  }

  // ───────────── 4. classic holdout via ?step1=classic
  if (MODE === "after") {
    console.log("\n=== 4. the 10% holdout (?step1=classic) still gets the old step 1 ===");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    page.__classic = true;
    await openWizard(page, "?step1=classic");
    await dismissCookies(page);
    const h1 = (await page.locator("h1").first().innerText()).trim();
    expect("classic heading", h1 === OLD_H1, { after: true });
    const switchFirst = await page.evaluate((sel) => {
      const sw = document.querySelector('[role="switch"]');
      const input = document.querySelector(sel);
      return sw && input ? Boolean(sw.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
    }, INPUT);
    expect("classic keeps the relocated switch (the move is not flag-gated)", switchFirst, { after: false });
    // Anchored: the pre-existing "Not sure about dates yet? Use flexible dates"
    // text link legitimately contains the phrase in both variants.
    expect("classic has no footer 'Use flexible dates' button", await page.getByRole("button", { name: /^use flexible dates$/i }).count(), { after: 0 });
    await page.screenshot({ path: `${SHOTS}/${MODE}-classic-desktop.png` });
    await ctx.close();
  }

  // ───────────── 5. fresh signup / returning login / claimed trip
  console.log("\n=== 5. fresh signup landing ===");
  {
    const email = `mt-probe+entry-${Date.now()}@test.local`;
    const password = "Probe!" + Math.random().toString(36).slice(2, 12);
    const { data: created, error } = await db.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: "Probe Person" },
    });
    if (error) fail(`could not create probe user: ${error.message}`);
    else {
      let tripId = null;
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
        const page = await ctx.newPage();
        if (!(await signIn(page, email, password))) fail("sign-in did not complete");
        else ok("signed in");

        // 5a. the value the callback emits for a FIRST confirmation
        await openWizard(page, "?auth_event=signup_email");
        await dismissCookies(page);
        await page.screenshot({ path: `${SHOTS}/${MODE}-fresh-signup.png` });
        let h1 = (await page.locator("h1").first().innerText()).trim();
        note(`signup_email h1 = "${h1}"`);
        expect("fresh signup sees the first-run heading", h1 === FIRST_RUN_H1, { before: false, after: true });
        expect("no 'Welcome back' for a fresh signup", await page.getByText(/welcome back/i).count(), { after: 0 });
        await page.waitForTimeout(3000);
        expect("the auth_event param is stripped after mount", !page.url().includes("auth_event"), { after: true });
        expect("…and the heading does NOT swap afterwards", (await page.locator("h1").first().innerText()).trim() === h1, { after: true });
        const picks = chips(page);
        if ((await picks.count()) > 0) {
          const box = await picks.first().boundingBox();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(1000);
          expect("signed-in reassurance copy after a one-tap", await page.getByText(/ready to save in one tap/i).first().isVisible().catch(() => false), { after: true });
        }

        // 5b. a returning magic-link login is NOT a first run
        await openWizard(page, "?auth_event=email_confirmed");
        await dismissCookies(page);
        h1 = (await page.locator("h1").first().innerText()).trim();
        expect("email_confirmed (returning) gets the cold heading", h1 === (MODE === "after" ? NEW_H1 : OLD_H1), { before: true, after: true });
        await openWizard(page, "?auth_event=login_google");
        await dismissCookies(page);
        h1 = (await page.locator("h1").first().innerText()).trim();
        expect("login_google gets the cold heading", h1 === (MODE === "after" ? NEW_H1 : OLD_H1), { before: true, after: true });

        // 5c. the claimed trip surfaces (storage path + live event path)
        const { data: trip, error: tErr } = await db
          .from("trips")
          .insert({
            title: "Probe claimed trip (safe to delete)",
            description: "Automated probe. Safe to delete.",
            status: "planning",
            user_id: created.user.id,
            itinerary: [],
            trip_meta: { destination: "Lisbon" },
            start_date: "2027-05-01",
            end_date: "2027-05-05",
          })
          .select("id")
          .single();
        if (tErr || !trip) fail(`could not create the probe trip: ${tErr?.message}`);
        else {
          tripId = trip.id;
          // Planted ONCE in the tab's sessionStorage (it persists across
          // same-origin navigations). An addInitScript would re-plant it on
          // every reload and make the "stays cleared" check meaningless.
          await page.evaluate((id) => sessionStorage.setItem("mt_claimed_trip_id", id), tripId);
          await openWizard(page, "?auth_event=signup_email");
          await dismissCookies(page);
          const banner = page.locator("[data-claimed-trip-banner]");
          const shown = await banner.isVisible().catch(() => false);
          expect("'Your trip came with you' renders for a claimed trip", shown, { before: false, after: true });
          if (shown) {
            const href = await banner.getByRole("link", { name: /open my trip/i }).getAttribute("href");
            expect("'Open my trip' points at the trip", Boolean(href && href.endsWith(`/trips/${tripId}`)), { after: true });
            expect("no 'Welcome back' beside the claimed banner", await page.getByText(/welcome back/i).count(), { after: 0 });
            await page.screenshot({ path: `${SHOTS}/${MODE}-fresh-signup-claimed.png` });
            await banner.getByRole("button", { name: /dismiss/i }).click();
            await page.waitForTimeout(400);
            expect("dismiss clears it", await banner.isVisible().catch(() => false), { after: false });
            await page.reload({ waitUntil: "domcontentloaded" });
            await page.waitForTimeout(2000);
            expect("…and it stays cleared on reload", await page.locator("[data-claimed-trip-banner]").isVisible().catch(() => false), { after: false });
            // live path: a claim that arrives after mount
            await page.evaluate((id) => window.dispatchEvent(new CustomEvent("mt:trip-claimed", { detail: { tripId: id } })), tripId);
            await page.waitForTimeout(500);
            expect("a claim announced after mount also surfaces", await page.locator("[data-claimed-trip-banner]").isVisible().catch(() => false), { after: true });
          }
        }
        await ctx.close();
      } finally {
        // PostgREST builders are thenables without .catch — an earlier
        // version threw HERE and skipped the user deletion, leaving a probe
        // account in production. Each step is isolated so neither can stop
        // the other.
        if (tripId) {
          try { await db.from("trips").delete().eq("id", tripId); } catch { /* best effort */ }
        }
        try { await db.auth.admin.deleteUser(created.user.id); } catch { /* best effort */ }
        note("probe user + trip deleted");
      }
    }
  }

  // ───────────── 6. blog prefill
  console.log("\n=== 6. blog prefill (?destination=paris&days=3) ===");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    await openWizard(page, "?destination=paris&days=3");
    await dismissCookies(page);
    const h1 = (await page.locator("h1").first().innerText()).trim();
    note(`prefill h1 = "${h1}"`);
    expect("prefill heading names the destination", /Let's plan Paris\./.test(h1), { before: false, after: true });
    expect("destination prefilled", await page.locator(INPUT).first().inputValue(), { before: "Paris", after: "Paris" });
    expect("no one-tap picks when the destination is set", await chips(page).count(), { before: 0, after: 0 });
    expect("Continue enabled with zero typing", await page.getByRole("button", { name: /continue/i }).first().isEnabled().catch(() => false), { before: true, after: true });
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failures === 0 ? `\n  PASS (${MODE})\n` : `\n  *** ${failures} FAILURE(S) (${MODE}) ***\n`);
process.exit(failures === 0 ? 0 : 2);
