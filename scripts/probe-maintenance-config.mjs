/**
 * MaintenanceWrapper refetched /api/admin/config on every client-side
 * navigation. Prove that stopped, and that maintenance mode still works.
 *
 * WHY THE STUBBING
 * ----------------
 * site_config is a single shared row and .env.local points at the SAME Supabase
 * project as production. Flipping maintenance_mode to test it would take the
 * live site down. So the config response is stubbed per-test with Playwright
 * route interception; the real row is never touched.
 *
 * WHAT IS BEING CHECKED
 *   1. one config request across several client-side navigations, not one each
 *   2. maintenance mode still blocks an anonymous visitor
 *   3. the skip list still works - and now works on /es too, which it did not
 *      before (raw usePathname kept the locale prefix, so "/es/auth/login"
 *      never matched "/auth/login" and a Spanish admin could not reach the
 *      login page to turn maintenance off)
 *   4. a failing config request fails OPEN, never locking everyone out
 *
 *   BASE_URL=http://localhost:3001 node scripts/probe-maintenance-config.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const CONFIG_RE = /\/api\/admin\/config/;

const browser = await chromium.launch();
let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);

const OFF = {
  maintenance_mode: false,
  maintenance_title: "Under Maintenance",
  maintenance_message: "back soon",
};
const ON = { ...OFF, maintenance_mode: true };

async function newPage({ config = OFF, failConfig = false } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const hits = [];
  page.on("request", (r) => {
    if (CONFIG_RE.test(r.url())) hits.push(r.url());
  });
  await page.route(CONFIG_RE, async (route) => {
    if (failConfig) return route.abort("failed");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(config),
    });
  });
  return { ctx, page, hits };
}

// ---------------------------------------------- 1. requests per navigation
console.log("\n=== 1. one config fetch across several client-side navigations ===");
{
  const { ctx, page, hits } = await newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500); // let hydration + the effect settle

  const afterFirst = hits.length;

  // Client-side navigation only. A full page load remounts the module and
  // legitimately refetches, so goto() would not test anything.
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/"]'))
      .map((a) => a.getAttribute("href"))
      .filter((h) => h && !h.startsWith("//") && !h.includes("#"))
      .slice(0, 40)
  );
  const targets = [...new Set(hrefs)].filter((h) => h !== "/").slice(0, 4);

  let navs = 0;
  for (const href of targets) {
    const link = page.locator(`a[href="${href}"]`).first();
    if (!(await link.isVisible().catch(() => false))) continue;
    const before = page.url();
    await link.click({ timeout: 10000 }).catch(() => {});
    // A dev server COMPILES each route on first visit - that can take many
    // seconds, and a short wait here silently produced "0 navigations" and an
    // inconclusive result rather than a failure.
    await page
      .waitForFunction((prev) => window.location.href !== prev, before, { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(1200); // let the effect run post-navigation
    if (page.url() !== before) navs++;
  }

  console.log(`  navigations performed: ${navs}   config requests total: ${hits.length}`);
  if (navs === 0) {
    console.log("  *** could not perform client-side navigation - inconclusive");
    failures++;
  } else if (hits.length > afterFirst) {
    fail(`refetched on navigation: ${afterFirst} after load, ${hits.length} after ${navs} navigations`);
  } else {
    ok(`${hits.length} config request(s) for 1 load + ${navs} navigations (was 1 per navigation)`);
  }
  await ctx.close();
}

// ------------------------------------------- 2. maintenance still blocks
console.log("\n=== 2. maintenance mode still blocks an anonymous visitor ===");
{
  const { ctx, page } = await newPage({ config: ON });
  await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const text = await page.locator("body").innerText().catch(() => "");
  if (/under maintenance|back soon/i.test(text)) ok("maintenance page shown when maintenance_mode=true");
  else fail(`maintenance_mode=true did NOT block - page said: ${text.slice(0, 120).replace(/\n/g, " ")}`);
  await ctx.close();
}

// --------------------------------- 3. skip list, default AND prefixed locale
console.log("\n=== 3. skip list works on every locale (the /es bug) ===");
for (const path of ["/auth/login", "/es/auth/login", "/privacy", "/es/privacy"]) {
  const { ctx, page } = await newPage({ config: ON });
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const text = await page.locator("body").innerText().catch(() => "");
  const blocked = /under maintenance|back soon/i.test(text);
  if (blocked) fail(`${path} was BLOCKED during maintenance - it is on the skip list`);
  else ok(`${path} reachable during maintenance`);
  await ctx.close();
}

// ------------------------------------------------------- 4. fails open
console.log("\n=== 4. an unreadable config must fail OPEN ===");
{
  const { ctx, page } = await newPage({ failConfig: true });
  await page.goto(`${BASE}/explore`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const text = await page.locator("body").innerText().catch(() => "");
  if (/under maintenance|back soon/i.test(text)) fail("a failed config request locked the visitor out");
  else ok(`config request failed and the site stayed up (${text.length} chars rendered)`);
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
