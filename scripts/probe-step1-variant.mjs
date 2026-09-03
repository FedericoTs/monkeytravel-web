/**
 * The step-1 arm reaches the database, for both arms.
 *
 * WHY
 * ---
 * FLAG_WIZARD_STEP1_EDITORIAL is reviewed 2026-09-09, and until 2026-09-03 the
 * arm a session saw existed ONLY as a PostHog property. PostHog captures ~59%
 * of sessions and skews toward converters, so the single number the review
 * turns on was missing for roughly four sessions in ten, non-randomly.
 *
 * `step1_variant` now rides the two events the review query groups on. This
 * asserts it actually lands, which is not a given: the wizard-event route
 * validates with zod, and zod STRIPS keys it does not declare. That is exactly
 * how `failure_code` was dropped on its first attempt — every client sent it,
 * the column stayed NULL, and nothing errored. A permanently-NULL column looks
 * identical to a feature nobody uses.
 *
 * TWO HALVES, EACH ATTRIBUTABLE
 * -----------------------------
 * The first version of this probe asserted on whatever rows landed inside a
 * timestamp window. A dev server mints no `mt_session_id`, so it could not
 * attribute rows to itself and read REAL production traffic instead — rows
 * that were legitimately NULL because production did not have the code yet.
 * It reported a failure that was not there. Never assert on a row you cannot
 * prove is yours.
 *
 *   A. the CLIENT sends it — intercept the real /api/wizard-event bodies the
 *      wizard posts, for both arms, via the ?step1= override that
 *      resolveEditorialStep1 honours. Independent of PostHog's rollout.
 *
 *   B. the SERVER stores it — POST directly under a session id this probe
 *      generates, so the row is unambiguously ours, and read it back.
 *
 *   BASE_URL=https://monkeytravel.app node scripts/probe-step1-variant.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

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
      if ((q === String.fromCharCode(34) || q === String.fromCharCode(39)) && v.slice(-1) === q) {
        v = v.slice(1, -1);
      }
      if (k === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (k === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

const BASE = process.env.BASE_URL || "http://localhost:3001";
const { url, key } = creds();
const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let failures = 0;
const fail = (m) => { console.log(`  *** FAIL - ${m}`); failures++; };
const ok = (m) => console.log(`  ok   ${m}`);
const note = (m) => console.log(`  ..   ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const probeSessions = [];

try {
  // ------------------------------------------------------------------ A
  console.log("");
  console.log("=== A. the wizard SENDS the arm on the review query's rows ===");
  for (const arm of ["editorial", "classic"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", userAgent: UA });
    const page = await ctx.newPage();
    const posted = [];
    page.on("request", (r) => {
      if (!r.url().includes("/api/wizard-event")) return;
      try {
        posted.push(JSON.parse(r.postData() ?? "{}"));
      } catch {
        posted.push({ unparseable: true });
      }
    });

    await page.goto(`${BASE}/en/trips/new?step1=${arm}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    // Stay VISIBLE past one heartbeat (10s) — the heartbeat deliberately skips
    // a hidden tab, and it is the review query's dwell qualifier.
    await sleep(13000);
    // Capture the session BEFORE closing the context: in production the
    // middleware mints a real mt_session_id, so these rows land in the step-1
    // funnel that `npm run flags:review` reads. A probe must not leave fake
    // sessions in the metric it exists to protect.
    const sid = (await ctx.cookies()).find((c) => c.name === "mt_session_id")?.value ?? null;
    if (sid) probeSessions.push(sid);
    else note(`${arm}: no session cookie (dev) — nothing to clean up`);
    await ctx.close();

    const denom = posted.filter((b) => b.step === "step_1_destination_dates");
    const beats = posted.filter((b) => b.step === "step1_heartbeat");

    if (denom.length === 0) {
      fail(`${arm}: the wizard never posted step_1_destination_dates`);
    } else if (denom.every((b) => b.step1_variant === arm)) {
      ok(`${arm}: denominator row sent step1_variant='${arm}'`);
    } else {
      fail(`${arm}: denominator sent ${JSON.stringify(denom.map((b) => b.step1_variant))}`);
    }

    if (beats.length === 0) {
      note(`${arm}: no heartbeat in 13s — dwell qualifier not exercised`);
    } else if (beats.every((b) => b.step1_variant === arm)) {
      ok(`${arm}: dwell qualifier (step1_heartbeat) sent step1_variant='${arm}'`);
    } else {
      fail(`${arm}: heartbeat sent ${JSON.stringify(beats.map((b) => b.step1_variant))}`);
    }
  }

  // ------------------------------------------------------------------ B
  console.log("");
  console.log("=== B. the SERVER stores it (zod does not strip it) ===");
  if (!db) {
    note("no service-role creds — skipping the database assertion");
  } else {
    for (const arm of ["editorial", "classic"]) {
      // Our own session id, so the row we read back is provably ours.
      const sid = `probe-step1-${randomUUID()}`;
      probeSessions.push(sid);
      const ctx = await browser.newContext({ userAgent: UA });
      await ctx.addCookies([{ name: "mt_session_id", value: sid, url: BASE }]);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/en`, { waitUntil: "domcontentloaded", timeout: 120000 });

      const res = await page.evaluate(async ({ variant }) => {
        const r = await fetch("/api/wizard-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            step: "step_1_destination_dates",
            locale: "en",
            step1_variant: variant,
          }),
        });
        return { status: r.status };
      }, { variant: arm });
      await ctx.close();

      if (res.status !== 204 && res.status !== 200) {
        fail(`${arm}: POST rejected with HTTP ${res.status}`);
        continue;
      }

      await sleep(1200);
      const { data, error } = await db
        .from("wizard_step_events")
        .select("session_id, step, step1_variant")
        .eq("session_id", sid);
      if (error) {
        fail(`${arm}: read-back failed: ${error.message}`);
        continue;
      }
      const rows = data ?? [];
      if (rows.length === 0) {
        fail(`${arm}: nothing stored for our own session id — the insert did not land`);
      } else if (rows.every((r) => r.step1_variant === arm)) {
        ok(`${arm}: stored as step1_variant='${arm}'`);
      } else {
        fail(
          `${arm}: stored as ${JSON.stringify(rows.map((r) => r.step1_variant))} — ` +
          `NULL here means zod stripped the key (declare it in BodySchema)`
        );
      }
    }

    // The CHECK constraint is the guard that keeps the column groupable.
    console.log("");
    console.log("=== C. the vocabulary stays closed ===");
    const sid = `probe-step1-${randomUUID()}`;
    const { error: badErr } = await db
      .from("wizard_step_events")
      .insert({ session_id: sid, step: "step_1_destination_dates", step1_variant: "not-an-arm" });
    if (!badErr) {
      probeSessions.push(sid);
      fail("an arbitrary step1_variant was accepted — the CHECK constraint is missing");
    } else {
      ok(`an out-of-vocabulary arm is rejected (${badErr.code ?? "error"})`);
    }
  }
} catch (err) {
  fail(`unexpected error: ${err.message}`);
} finally {
  await browser.close();
  if (db && probeSessions.length) {
    try {
      await db.from("wizard_step_events").delete().in("session_id", probeSessions);
      note(`cleaned up ${probeSessions.length} probe session(s)`);
    } catch {
      note("cleanup failed — probe rows may remain");
    }
  }
}

console.log(failures === 0 ? "\n  PASS\n" : `\n  *** ${failures} FAILURE(S) ***\n`);
process.exit(failures === 0 ? 0 : 2);
