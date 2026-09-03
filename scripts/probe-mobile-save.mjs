/**
 * What a signed-out planner meets when they tap Save on a phone.
 *
 * WHY
 * ---
 * Measured 2026-09-03 over 30 days, sessions that reached `result`:
 *
 *     desktop   115 clicked save -> 78 ended up with a trip   67.8% [58.8-75.7]
 *     mobile     74 clicked save -> 29 ended up with a trip   39.2% [28.9-50.6]
 *
 * A 28.6-point gap, p=0.000106, non-overlapping intervals. Click rates are
 * IDENTICAL (20.5% desktop / 22.1% mobile) — mobile planners want to keep
 * their trip just as much, and then don't get one. 45 of them a month.
 *
 * It is not the stranded-account bug: signup -> got-in runs 85-94% weekly and
 * `confirmed_never_signed_in` is 1-4/week, far too small. So the loss happens
 * BEFORE an account exists, somewhere between the tap and a submitted email.
 * The server-side auth steps that would localise it (`auth_modal_shown`,
 * `otp_requested`) only went live 2026-09-02 and need ~2 weeks of mobile
 * volume.
 *
 * This looks at the surface directly instead of waiting: drive the real
 * wizard at 375x812, tap the Save in the fixed bottom bar, and record exactly
 * what appears — and whether anything about it is broken.
 *
 *   BASE_URL=http://localhost:3001 node scripts/probe-mobile-save.mjs
 */
import { chromium, devices } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const OUT = process.env.OUT_DIR || ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`  ${m}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["iPhone 13"],
  locale: "en-US",
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
});

try {
  console.log("");
  console.log("=== driving the wizard at 390x844 (iPhone 13) ===");
  await page.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await sleep(4000);

  // Consent, if it is in the way of the tap targets.
  const essential = page.getByRole("button", { name: /essential only/i });
  if (await essential.count()) {
    await essential.first().click().catch(() => {});
    await sleep(800);
    log("dismissed the consent banner (essential only)");
  }

  const dest = page.getByPlaceholder(/Paris, Tokyo/i).first();
  await dest.click();
  await dest.fill("Lisbon");
  await sleep(2500);
  // First suggestion in the listbox.
  const opt = page.locator('[role="option"], li').filter({ hasText: /Lisbon/i }).first();
  if (await opt.count()) {
    await opt.click({ timeout: 15000 }).catch(() => {});
  } else {
    await page.keyboard.press("Enter");
  }
  await sleep(1500);
  log("destination set");

  const weekend = page.getByRole("button", { name: /^weekend$/i });
  if (await weekend.count()) {
    await weekend.first().click();
    await sleep(1200);
    log("dates set (Weekend preset)");
  }

  for (const label of [/continue/i, /generate itinerary/i]) {
    const b = page.getByRole("button", { name: label }).first();
    if (await b.count()) {
      await b.click({ timeout: 20000 }).catch(() => {});
      await sleep(2500);
      log(`clicked ${label}`);
    }
  }

  // The result view. Generation is cached for a repeated destination.
  console.log("");
  console.log("=== waiting for the result view ===");
  const savedShot = `${OUT}/mobile-01-result.png`;
  let reached = false;
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const hasCards = await page.locator("[data-activity-name]").count();
    if (hasCards > 0) { reached = true; break; }
  }
  if (!reached) {
    log("*** never reached the result view — cannot test the save tap");
    await page.screenshot({ path: savedShot, fullPage: false });
    log(`screenshot: ${savedShot}`);
  } else {
    log(`result view rendered (${await page.locator("[data-activity-name]").count()} activity cards)`);
    await page.screenshot({ path: savedShot, fullPage: false });
    log(`screenshot: ${savedShot}`);

    // ---- the bottom bar: is the Save actually reachable? ----
    console.log("");
    console.log("=== the fixed bottom bar ===");
    const bar = page.locator("div.fixed.bottom-0").first();
    const barBox = await bar.boundingBox().catch(() => null);
    const vp = page.viewportSize();
    if (!barBox) {
      log("*** no fixed bottom bar found on the result view");
    } else {
      log(`bar at y=${Math.round(barBox.y)}..${Math.round(barBox.y + barBox.height)}, viewport height ${vp.height}`);
      if (barBox.y + barBox.height > vp.height + 2) {
        log("*** the bar extends BELOW the viewport — part of it is unreachable");
      } else {
        log("bar sits fully inside the viewport");
      }
    }

    const save = page.getByRole("button", { name: /^save( trip)?$/i }).first();
    const saveCount = await save.count();
    log(`save buttons matching /^save( trip)?$/i: ${saveCount}`);

    if (saveCount === 0) {
      // Fall back to whatever the bar actually holds, and say so.
      const barText = barBox ? (await bar.innerText()).replace(/\n+/g, " | ") : "(no bar)";
      log(`*** no Save button matched. Bottom bar reads: ${barText}`);
    } else {
      const box = await save.boundingBox();
      log(`save button ${Math.round(box.width)}x${Math.round(box.height)} at y=${Math.round(box.y)}`);
      if (box.height < 44) log(`*** tap target is ${Math.round(box.height)}px tall — under the 44px minimum`);

      console.log("");
      console.log("=== tapping Save ===");
      const before = page.url();
      await save.click({ timeout: 20000 });
      await sleep(4000);

      const after = page.url();
      if (after !== before) log(`navigated: ${before} -> ${after}`);
      else log("stayed on the page (modal expected)");

      await page.screenshot({ path: `${OUT}/mobile-02-after-save.png`, fullPage: false });
      log(`screenshot: ${OUT}/mobile-02-after-save.png`);

      // What actually appeared?
      const dialog = page.locator('[role="dialog"], [aria-modal="true"]').first();
      if (await dialog.count()) {
        const dbox = await dialog.boundingBox().catch(() => null);
        const dtext = (await dialog.innerText()).replace(/\n+/g, " | ").slice(0, 220);
        log(`dialog present: ${dtext}`);
        if (dbox) {
          log(`dialog at y=${Math.round(dbox.y)}..${Math.round(dbox.y + dbox.height)} (viewport ${vp.height})`);
          if (dbox.y + dbox.height > vp.height + 2) {
            log("*** the dialog runs past the bottom of the viewport");
          }
          if (barBox && dbox.y + dbox.height > barBox.y && (await bar.isVisible())) {
            log("*** the fixed bottom bar overlaps the dialog — it may cover the submit control");
          }
        }
        const email = dialog.getByRole("textbox").first();
        if (await email.count()) {
          const ebox = await email.boundingBox();
          log(`email field at y=${Math.round(ebox.y)}, ${Math.round(ebox.height)}px tall`);
          await email.click();
          await email.fill("probe@example.com");
          await sleep(1200);
          await page.screenshot({ path: `${OUT}/mobile-03-email-typed.png`, fullPage: false });
          log(`screenshot with the field focused: ${OUT}/mobile-03-email-typed.png`);
          // Deliberately NOT submitting: that would send a real auth email and
          // the project-wide cap is only a couple per hour.
          log("(not submitting — the auth-email cap is project-wide and tiny)");
        } else {
          log("no text field inside the dialog");
        }
      } else {
        log("*** no dialog appeared after tapping Save");
        const body = (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 300);
        log(`page reads: ${body}`);
      }
    }
  }

  if (consoleErrors.length) {
    console.log("");
    console.log("=== console errors ===");
    for (const e of [...new Set(consoleErrors)].slice(0, 6)) log(e);
  }
} catch (err) {
  console.log(`  *** probe error: ${err.message}`);
  await page.screenshot({ path: `${OUT}/mobile-error.png` }).catch(() => {});
} finally {
  await browser.close();
}
console.log("");
