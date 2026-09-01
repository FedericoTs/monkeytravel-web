/**
 * Do the analytics and affiliate tags actually honour the cookie banner?
 *
 * The banner offers "Essential Only". If a tag fires before any choice is made,
 * or keeps firing after that choice, the banner is decorative with respect to
 * that tag — which is a worse position than having no banner, because it tells
 * the visitor something untrue.
 *
 * Measures three windows against a FRESH profile (no cookies, no storage):
 *   1. before any consent choice, with the banner on screen
 *   2. immediately after clicking "Essential Only"
 *   3. after a further navigation, to catch tags that re-fire per page
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-consent-respected.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL || "https://monkeytravel.app";

const TRACKERS = [
  ["GA4", /google-analytics\.com|googletagmanager\.com|analytics\.google\.com/i],
  ["DoubleClick", /doubleclick\.net/i],
  ["Travelpayouts", /emrldco\.com|travelpayouts|tp\.media/i],
  ["PostHog", /posthog/i],
  ["Sentry", /sentry\.io|ingest\.sentry/i],
];

function classify(url) {
  // Only count requests that actually LEAVE for a third party. Otherwise the
  // app's own bundle chunks match — /_next/static/chunks/node_modules_posthog-js
  // reads as a PostHog tracking hit and the probe reports a violation that is
  // just webpack doing its job. Loading a vendor chunk sets no cookie and sends
  // no data; only the ingestion call does.
  try {
    if (new URL(url).origin === new URL(BASE).origin) return null;
  } catch {
    return null;
  }
  for (const [name, re] of TRACKERS) if (re.test(url)) return name;
  return null;
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const hits = [];
page.on("request", (r) => {
  const kind = classify(r.url());
  if (kind) hits.push({ kind, url: r.url() });
});

function tally(from) {
  const slice = hits.slice(from);
  const counts = {};
  for (const h of slice) counts[h.kind] = (counts[h.kind] || 0) + 1;
  return counts;
}

// ---- window 1: before any consent choice -----------------------------------
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000); // banner mounts after 1.5s; let tags settle

const consentBefore = await page.evaluate(() => {
  try { return localStorage.getItem("mt_cookie_consent"); } catch { return "unreadable"; }
});
const bannerVisible = await page
  .getByRole("button", { name: /essential only/i })
  .isVisible()
  .catch(() => false);

console.log("\n=== 1. BEFORE any consent choice ===");
console.log("  stored consent      :", consentBefore);
console.log("  banner on screen    :", bannerVisible);
console.log("  tracker requests    :", JSON.stringify(tally(0)));

const cookiesBefore = (await ctx.cookies()).filter((c) => /^_ga|^_gid|^_gcl/.test(c.name));
console.log("  GA cookies written  :", cookiesBefore.map((c) => c.name).join(", ") || "none");

const dl = await page.evaluate(() => {
  const d = window.dataLayer;
  if (!Array.isArray(d)) return "no dataLayer";
  return d.map((a) => (Array.isArray(a) ? a[0] : typeof a)).join(", ");
});
console.log("  dataLayer commands  :", dl);
console.log("  has consent default :", /consent/i.test(String(dl)));

// ---- window 2: after choosing Essential Only -------------------------------
const mark2 = hits.length;
if (bannerVisible) {
  await page.getByRole("button", { name: /essential only/i }).click();
  await page.waitForTimeout(4000);
}
const stored = await page.evaluate(() => {
  try { return localStorage.getItem("mt_cookie_consent"); } catch { return "unreadable"; }
});
console.log("\n=== 2. AFTER clicking \"Essential Only\" ===");
console.log("  stored consent      :", stored);
console.log("  NEW tracker requests:", JSON.stringify(tally(mark2)));

// ---- window 3: a further navigation ----------------------------------------
const mark3 = hits.length;
await page.goto(`${BASE}/en/destinations`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
console.log("\n=== 3. AFTER a further navigation ===");
console.log("  NEW tracker requests:", JSON.stringify(tally(mark3)));

const cookiesAfter = (await ctx.cookies()).filter((c) => /^_ga|^_gid|^_gcl/.test(c.name));
console.log("  GA cookies present  :", cookiesAfter.map((c) => c.name).join(", ") || "none");

// Sentry is exempt BY DESIGN: instrumentation-client.ts documents error
// tracking as essential functionality, and already gates performance sampling
// on analytics consent and session replay on explicit sessionRecording
// consent. Flagging it here would train the reader to ignore this output.
const EXEMPT = new Set(["Sentry"]);

console.log("\n=== VERDICT ===");
// Count each window from its own slice. Recomputing tally(0) at the end would
// fold every later hit into "before" and overstate the pre-consent number.
const before = {};
for (const h of hits.slice(0, mark2)) before[h.kind] = (before[h.kind] || 0) + 1;
const after = {};
for (const h of hits.slice(mark2)) after[h.kind] = (after[h.kind] || 0) + 1;

let violations = 0;
for (const [name] of TRACKERS) {
  const pre = before[name] || 0;
  const post = after[name] || 0;
  if (!pre && !post) continue;
  const exempt = EXEMPT.has(name);
  if (!exempt) violations += pre + post;
  console.log(
    `  ${name.padEnd(13)} before=${String(pre).padStart(2)}  after-declining=${String(post).padStart(2)}  ` +
      (exempt ? "exempt (documented essential)" : "*** IGNORES CONSENT ***")
  );
}
console.log(
  violations === 0
    ? "\n  PASS — no non-exempt tag fired before or after declining."
    : `\n  FAIL — ${violations} non-exempt tracker request(s).`
);

await browser.close();
