/**
 * Does the cookie banner swallow a real user's click on the homepage CTA?
 *
 * The banner is a full-width `fixed` container. On shorter desktop viewports
 * its card sits over the hero at the INITIAL scroll position. A person who
 * lands and immediately clicks the destination field hits the banner instead —
 * and nothing about the banner looks modal, so it reads as a broken site.
 *
 * Playwright's .click() auto-scrolls, which HIDES this: scrolling moves the
 * hero out from under a fixed banner, so a scripted click succeeds where a
 * human's first click fails. This probe therefore uses raw mouse events at the
 * initial scroll position and checks document.activeElement.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-consent-overlay.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL || "https://monkeytravel.app";
const browser = await chromium.launch();

const SIZES = [
  [1280, 800],
  [1440, 900],
  [1280, 720],
  [1366, 768],
];

for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const geom = await page.evaluate(() => {
    const input = document.querySelector(
      'input[role="combobox"], main input[type="text"]'
    );
    if (!input) return null;
    const r = input.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      cx,
      cy,
      scrollY: window.scrollY,
      topEl: top ? `${top.tagName}.${(top.className || "").toString().slice(0, 34)}` : "none",
      isTheInput: top === input,
    };
  });

  if (!geom) {
    console.log(`\n=== ${w}x${h} === hero input not found`);
    await ctx.close();
    continue;
  }

  // A raw click at the initial scroll position — no auto-scroll, no retry.
  await page.mouse.click(geom.cx, geom.cy);
  await page.keyboard.type("Lisbon");
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => {
    const input = document.querySelector(
      'input[role="combobox"], main input[type="text"]'
    );
    return {
      focused: document.activeElement === input,
      value: input ? input.value : "(no input)",
      scrollY: window.scrollY,
    };
  });

  const ok = after.value.includes("Lisbon");
  console.log(`\n=== ${w}x${h} ===`);
  console.log(`  what is under the field's centre : ${geom.topEl}`);
  console.log(`  that element IS the input        : ${geom.isTheInput}`);
  console.log(`  after a raw click + typing       : value="${after.value}" focused=${after.focused}`);
  console.log(`  VERDICT                          : ${ok ? "reaches the user" : "*** CLICK SWALLOWED ***"}`);

  await ctx.close();
}

await browser.close();
