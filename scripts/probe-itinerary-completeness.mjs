/**
 * Does a long trip come back with all the days the user asked for?
 *
 * Measured on production 2026-09-01 across 428 saved trips: 93 (21.7%) hold
 * FEWER days than their own date range, 0 hold more — strictly one-directional,
 * so it is truncation, not noise. It scales with length:
 *
 *     7 days   6% short
 *     8 days  26%
 *     9 days  32%
 *    10 days  70%    <- the "10 days" one-tap preset
 *    14 days  90%    <- the "2 weeks" one-tap preset
 *
 * Two of the wizard's five duration presets therefore fail most of the time,
 * and the result header still shows the full requested date range beside the
 * smaller day count, so nobody notices.
 *
 * Runs AUTHENTICATED on purpose: the 40/IP/day anon backstop is gated on
 * isAnonymous, so a signed-in request measures the generator rather than the
 * rate limiter.
 *
 *   BASE_URL=http://localhost:3001 node scripts/probe-itinerary-completeness.mjs
 *   BASE_URL=... DAYS=14 STREAM=1 node scripts/probe-itinerary-completeness.mjs
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const DAYS = parseInt(process.env.DAYS || "14", 10);
const USE_STREAM = process.env.STREAM === "1";
const STATE = ".auth/owner.json";

if (!existsSync(STATE)) {
  console.error("run: BASE_URL=... npx tsx scripts/e2e-login.mts");
  process.exit(1);
}

function iso(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const start = iso(60);
const end = iso(60 + DAYS - 1);

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: STATE });

const body = {
  destination: process.env.DEST || "Valencia, Spain",
  startDate: start,
  endDate: end,
  vibes: ["cultural", "foodie"],
  budgetTier: "balanced",
  pace: "moderate",
};

const path = USE_STREAM ? "/api/ai/generate/stream" : "/api/ai/generate";
console.log(`\n  ${path}`);
console.log(`  requested: ${DAYS} days  (${start} -> ${end})`);

const t0 = Date.now();
const res = await ctx.request.post(`${BASE}${path}`, {
  data: body,
  timeout: 180_000,
});
const ms = Date.now() - t0;
console.log(`  status ${res.status()}  in ${(ms / 1000).toFixed(1)}s`);

if (!res.ok()) {
  console.log("  body:", (await res.text()).slice(0, 300));
  await browser.close();
  process.exit(1);
}

let days = null;
let meta = null;

if (USE_STREAM) {
  // SSE: the final "complete" event carries the whole itinerary.
  const text = await res.text();
  const events = text
    .split("\n\n")
    .map((chunk) => {
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) return null;
      try { return JSON.parse(line.slice(5).trim()); } catch { return null; }
    })
    .filter(Boolean);
  const complete = [...events].reverse().find((e) => e?.itinerary || e?.days);
  const it = complete?.itinerary ?? complete;
  days = it?.days?.length ?? null;
  const metaEvent = events.find((e) => e?.totalDays != null || e?.mode);
  meta = metaEvent ?? null;
} else {
  const json = await res.json();
  const payload = json.data ?? json;
  days = payload?.itinerary?.days?.length ?? null;
  meta = payload?.meta ?? null;
}

console.log(`  days returned: ${days}`);
if (meta) {
  console.log(
    "  meta:",
    JSON.stringify({
      isPartial: meta.isPartial,
      generatedDays: meta.generatedDays,
      totalDays: meta.totalDays,
      hasMoreDays: meta.hasMoreDays,
      remainingDays: meta.remainingDays,
      cached: meta.cached,
      mode: meta.mode,
    })
  );
}

const ok = days === DAYS;
console.log(
  ok
    ? `\n  PASS — all ${DAYS} days returned.`
    : `\n  *** SHORT — asked for ${DAYS}, got ${days}. ${DAYS - (days ?? 0)} day(s) missing. ***`
);

await browser.close();
process.exit(ok ? 0 : 2);
