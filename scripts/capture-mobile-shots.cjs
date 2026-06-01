/**
 * Capture true-mobile screenshots of the live public site for ad planning.
 * iPhone-13 device emulation (390x844, DPR 3). Anonymous context (no login),
 * so it captures the public marketing/feature surfaces.
 *
 *   node scripts/capture-mobile-shots.cjs
 *
 * Output: marketing/screenshots/<name>-screen.png (above-the-fold viewport)
 *         marketing/screenshots/<name>-full.png   (full scrolling page)
 */

const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "https://monkeytravel.app";
const OUT = path.join(process.cwd(), "marketing", "screenshots");

// name → path. Public, no-auth surfaces that showcase features.
const ROUTES = [
  ["01-landing", "/"],
  ["02-free-ai-planner", "/free-ai-trip-planner"],
  ["03-ai-itinerary-generator", "/ai-itinerary-generator"],
  ["04-explore", "/explore"],
  ["05-destinations", "/destinations"],
  ["06-templates", "/templates"],
  ["07-group-trip-planner", "/group-trip-planner"],
  ["08-budget-trip-planner", "/budget-trip-planner"],
  ["09-weekend-trip-planner", "/weekend-trip-planner"],
  ["10-from-chatgpt", "/from-chatgpt"],
];

async function dismissOverlays(page) {
  // Best-effort: click a cookie/consent dismiss button if present.
  const labels = [/reject/i, /decline/i, /accept/i, /got it/i, /^ok$/i, /agree/i];
  for (const re of labels) {
    try {
      const btn = page.getByRole("button", { name: re }).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click({ timeout: 1000 });
        await page.waitForTimeout(300);
        break;
      }
    } catch {
      /* none — continue */
    }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  const done = [];

  for (const [name, route] of ROUTES) {
    const url = `${BASE}${route}`;
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    } catch {
      // networkidle can hang on analytics; fall back to domcontentloaded.
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch (e) {
        console.log(`✗ ${name} (${route}): ${e.message.split("\n")[0]}`);
        continue;
      }
    }
    await page.waitForTimeout(1500);
    await dismissOverlays(page);
    // Nudge lazy images / animations to load, then return to top.
    await page.evaluate(async () => {
      await new Promise((r) => {
        let y = 0;
        const t = setInterval(() => {
          window.scrollBy(0, 600);
          y += 600;
          if (y > document.body.scrollHeight) {
            clearInterval(t);
            r();
          }
        }, 80);
      });
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);

    const screen = path.join(OUT, `${name}-screen.png`);
    const full = path.join(OUT, `${name}-full.png`);
    await page.screenshot({ path: screen });
    await page.screenshot({ path: full, fullPage: true });
    const title = await page.title();
    done.push({ name, route, title });
    console.log(`✓ ${name}  ${route}  — "${title}"`);
  }

  await browser.close();
  fs.writeFileSync(
    path.join(OUT, "_index.json"),
    JSON.stringify({ base: BASE, captured: done }, null, 2)
  );
  console.log(`\nSaved ${done.length} pages to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
