/**
 * A pasted prompt must be refused by the CLIENT, before it costs a round-trip.
 *
 * lib/gemini.ts validateTripParams rejects a destination over 100 characters,
 * and the wizard's own gate mirrored every other rule in that function except
 * this one. So a prompt pasted into the destination box passed step 1, fired a
 * `generating` row, and bounced back with an untranslated "Destination name
 * too long" behind a Retry button that resent the identical text.
 *
 * Measured over the 30 days to 2026-09-02:
 *
 *   destination <= 60 chars   907 sessions   98.5% reached a result
 *   destination 61-100 chars   19 sessions  100.0% reached a result
 *   destination  > 100 chars   12 sessions   33.3% reached a result
 *
 * That is also why the bound is 100 and not the friendlier-sounding 60 the
 * original spec suggested: 61-100 works perfectly and warning there would nag
 * 19 succeeding sessions a month.
 *
 * Costs NO generation: the whole point is that nothing is sent.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-long-destination.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, existsSync } from "node:fs";

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
const SHOTS = process.env.SHOTS || ".probe-shots/long-destination";
mkdirSync(SHOTS, { recursive: true });
const { url: SB_URL, key: SB_KEY } = creds();
const db = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);

// A real one of these, from the shape the logs show: a whole request typed
// into the place field. 178 characters.
const PROMPT = "I want to visit Rome and then Florence and then Venice over about two weeks in the spring with my family including two teenagers who like food and history and not too much walking";
const SHORT = "Rome, Italy";

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "en-US", userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/en/trips/new`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForSelector("h1", { timeout: 120000 });
  await page.waitForTimeout(2600);
  const ess = page.getByRole("button", { name: /essential only/i });
  if (await ess.isVisible().catch(() => false)) { await ess.click(); await page.waitForTimeout(500); }

  const sid = (await ctx.cookies()).find((c) => c.name === "mt_session_id")?.value ?? null;
  note(`session ${sid ? sid.slice(0, 8) + "…" : "(none — dev server does not mint one)"}`);
  note(`pasted destination is ${PROMPT.length} characters`);

  console.log("");
  console.log("=== 1. the wizard refuses it, and says why ===");
  const input = page.locator('input[role="combobox"]').first();
  await input.fill(PROMPT);
  await page.waitForTimeout(1200);
  const alert = page.locator('p[role="alert"]').filter({ hasText: /request rather than a place|100 characters/i });
  if (!(await alert.count())) fail("no inline alert for a destination over 100 characters");
  else ok(`inline alert shown: "${(await alert.first().textContent())?.trim().slice(0, 70)}…"`);

  const cont = page.getByRole("button", { name: /^continue/i }).first();
  const enabled = await cont.isEnabled().catch(() => false);
  if (enabled) fail("Continue is ENABLED for a destination the server will reject");
  else ok("Continue is disabled");
  await page.screenshot({ path: `${SHOTS}/too-long.png` });

  console.log("");
  console.log("=== 2. nothing was sent ===");
  // The doomed attempt must cost no round-trip and leave no phantom
  // `generating` row — that phantom is what made this a dead end in the funnel.
  if (!sid || !db) note("no session cookie or service-role creds — skipping the funnel check (run against production for it)");
  else {
    const { data } = await db.from("wizard_step_events").select("step").eq("session_id", sid);
    const steps = (data ?? []).map((r) => r.step);
    note(`steps for this session: ${[...new Set(steps)].join(", ") || "(none)"}`);
    if (steps.includes("generating")) fail("a `generating` row was written for an attempt that was never sent");
    else ok("no phantom `generating` row");
  }

  console.log("");
  console.log("=== 3. a normal destination is unaffected ===");
  await input.fill(SHORT);
  await page.waitForTimeout(1200);
  const stillAlerting = await page.locator('p[role="alert"]').filter({ hasText: /request rather than a place|100 characters/i }).count();
  if (stillAlerting) fail("the alert persists for a valid destination");
  else ok("alert clears for a valid destination");

  console.log("");
  console.log("=== 4. the boundary is the server's, not a friendlier guess ===");
  // 61-100 characters converts at 100%, so warning there would nag people who
  // are succeeding. Assert the wizard agrees.
  const NINETY = "A".repeat(90);
  await input.fill(NINETY);
  await page.waitForTimeout(900);
  const alertAt90 = await page.locator('p[role="alert"]').filter({ hasText: /request rather than a place|100 characters/i }).count();
  if (alertAt90) fail("a 90-character destination is flagged — the bound is too tight");
  else ok("90 characters is accepted");

  await input.fill("B".repeat(101));
  await page.waitForTimeout(900);
  const alertAt101 = await page.locator('p[role="alert"]').filter({ hasText: /request rather than a place|100 characters/i }).count();
  if (!alertAt101) fail("a 101-character destination is NOT flagged — the bound is missing");
  else ok("101 characters is refused — the bound sits exactly where the server's does");

  await ctx.close();
} catch (err) {
  fail(`unexpected error: ${err.message}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
