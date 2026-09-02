/**
 * A visit counts; a drive-by does not.
 *
 * `page_views.is_bot` is a user-agent regex, and the traffic that doubled the
 * wizard denominator on 2026-08-17 defeats it: 629 localized step-1 sessions
 * from CN/SG/HK sharing 29 rotating user agents (Chrome 145-151), 0.0%
 * flagged, and six sessions across those three regions that ever had an
 * account. Identity cannot separate them, and neither can page-view timing —
 * a candidate rule ("2+ page views inside 5s") caught 34% of them while
 * catching 23.9% of real ES/IT/BR/MX sessions.
 *
 * Time-on-page can. This asserts the two halves of that claim:
 *
 *   1. a page kept VISIBLE past the threshold posts /api/page-engaged
 *   2. a load that leaves before the threshold posts NOTHING
 *
 * and, where a session cookie exists (production; a dev server does not mint
 * one), that exactly one row lands per session no matter how many pages are
 * visited.
 *
 * Honest limit, asserted nowhere because it cannot be: a headless browser that
 * simply waits would be counted. Chrome reports visibilityState "visible" when
 * headless. This filters prefetch, non-JS fetchers and render-and-exit
 * traffic — which is what the observed traffic does — not a patient one.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-engagement-beacon.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
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
const { url, key } = creds();
const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sessions = [];

async function run(label, dwellMs, extraPaths = []) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", userAgent: UA });
  const page = await ctx.newPage();
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/page-engaged")) posts++;
  });
  await page.goto(`${BASE}/en`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await sleep(dwellMs);
  for (const p of extraPaths) {
    await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
    await sleep(dwellMs);
  }
  const sid = (await ctx.cookies()).find((c) => c.name === "mt_session_id")?.value ?? null;
  if (sid) sessions.push(sid);
  await ctx.close();
  note(`${label}: ${posts} beacon post(s)${sid ? `, session ${sid.slice(0, 8)}…` : ", no session cookie"}`);
  return { posts, sid };
}

const browser = await chromium.launch();
try {
  console.log("");
  console.log("=== 1. a drive-by (leaves before the threshold) is NOT counted ===");
  const fast = await run("1s visit", 1000);
  if (fast.posts > 0) fail("a 1s visit posted a beacon — the threshold is not holding");
  else ok("no beacon for a visit that leaves in 1s");

  console.log("");
  console.log("=== 2. a real visit IS counted ===");
  const slow = await run("6s visit", 6000);
  if (slow.posts === 0) fail("a 6s visible visit posted nothing — the beacon never fires");
  else ok(`beacon posted after the threshold (${slow.posts})`);

  console.log("");
  console.log("=== 3. once per session, however many pages ===");
  const multi = await run("6s on three pages", 6000, ["/en/about", "/en/explore"]);
  if (multi.posts === 0) fail("no beacon across three pages");
  else if (multi.posts > 1) fail(`${multi.posts} beacons in one session — it should fire once`);
  else ok("exactly one beacon across three pages");

  console.log("");
  console.log("=== 4. the row landed, once ===");
  if (!db) note("no service-role creds — skipping the database assertion");
  else if (!sessions.length) note("no session cookie on this server (dev does not mint one) — run against production for this");
  else {
    await sleep(2500);
    const { data } = await db.from("session_engagement").select("session_id, first_path, locale").in("session_id", sessions);
    const rows = data ?? [];
    note(`rows for ${sessions.length} probe session(s): ${rows.length}`);
    const fastRow = rows.find((r) => r.session_id === fast.sid);
    if (fast.sid && fastRow) fail("the 1s drive-by produced a row");
    else if (fast.sid) ok("the 1s drive-by produced NO row");
    const slowRow = rows.find((r) => r.session_id === slow.sid);
    if (slow.sid && !slowRow) fail("the 6s visit produced no row");
    else if (slow.sid) ok(`the 6s visit produced a row (path ${slowRow.first_path}, locale ${slowRow.locale})`);
    const multiRows = rows.filter((r) => r.session_id === multi.sid);
    if (multi.sid && multiRows.length > 1) fail(`${multiRows.length} rows for one session`);
    else if (multi.sid && multiRows.length === 1) ok("exactly one row for the three-page session");
  }
} catch (err) {
  fail(`unexpected error: ${err.message}`);
} finally {
  await browser.close();
  if (db && sessions.length) {
    try { await db.from("session_engagement").delete().in("session_id", sessions); note("probe rows deleted"); } catch { /* best effort */ }
  }
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
