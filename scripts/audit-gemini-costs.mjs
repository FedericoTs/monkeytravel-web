/**
 * Audit Gemini API costs from `api_request_logs` over the last 30 days.
 *
 * Usage:
 *   node scripts/audit-gemini-costs.mjs
 *
 * Reads from .env.local. Uses the Supabase anon key by default; if RLS
 * blocks reads, set SUPABASE_SERVICE_ROLE_KEY in .env.local and re-run.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE keys");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});
const usingServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("=".repeat(78));
console.log("API cost audit — last 30 days");
console.log(`Auth mode: ${usingServiceRole ? "SERVICE_ROLE (full access)" : "ANON (RLS may filter rows)"}`);
console.log("=".repeat(78));

const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

// 1) Find all distinct api_name values to see what's logged
console.log("\n1) Distinct api_name values across api_request_logs (last 30 days)\n");
const { data: distinctRows, error: distinctErr } = await supabase
  .from("api_request_logs")
  .select("api_name, cost_usd, cache_hit, timestamp")
  .gte("timestamp", since)
  .limit(50000);

if (distinctErr) {
  console.error("❌ api_request_logs read failed:", distinctErr.message);
  console.error("\nMost likely RLS blocks the anon key. Either:");
  console.error("  1. Add SUPABASE_SERVICE_ROLE_KEY to .env.local and re-run");
  console.error("  2. Run this in Supabase SQL Editor:\n");
  console.error("     SELECT DATE(timestamp) AS day, api_name, COUNT(*) AS calls,");
  console.error("            SUM(cost_usd) AS cost, AVG(CASE WHEN cache_hit THEN 1.0 ELSE 0.0 END) AS hit_rate");
  console.error("     FROM api_request_logs WHERE timestamp > NOW() - INTERVAL '30 days'");
  console.error("     GROUP BY DATE(timestamp), api_name ORDER BY day DESC, cost DESC;");
  process.exit(2);
}

const allRows = distinctRows ?? [];
const distinct = new Map();
for (const r of allRows) {
  const e = distinct.get(r.api_name) ?? { calls: 0, cost: 0, hits: 0 };
  e.calls += 1;
  e.cost += Number(r.cost_usd) || 0;
  if (r.cache_hit) e.hits += 1;
  distinct.set(r.api_name, e);
}

if (allRows.length === 0) {
  console.log("⚠ Zero rows in api_request_logs for the last 30 days.");
  console.log("  Either the table is empty, RLS is hiding everything (no error returned),");
  console.log("  or the API gateway logging is not running.");
  console.log("\n  Check the Supabase dashboard directly:");
  console.log("    https://supabase.com/dashboard → Table Editor → api_request_logs");
  process.exit(0);
}

console.log(`Total rows in api_request_logs: ${allRows.length}\n`);
console.log("  api_name                          calls    cost     cache_hit_rate");
for (const [name, v] of [...distinct.entries()].sort(([, a], [, b]) => b.calls - a.calls)) {
  const hitRate = v.calls > 0 ? (v.hits / v.calls) * 100 : 0;
  console.log(
    `  ${name.padEnd(33)}  ${String(v.calls).padStart(5)}   $${v.cost.toFixed(4).padStart(7)}  ${hitRate.toFixed(1)}%`
  );
}

// 2) Daily breakdown across ALL APIs (not just gemini)
console.log("\n2) Daily total cost (all APIs, USD)\n");
const byDay = new Map();
for (const r of allRows) {
  const day = r.timestamp.slice(0, 10);
  const e = byDay.get(day) ?? { cost: 0, calls: 0 };
  e.cost += Number(r.cost_usd) || 0;
  e.calls += 1;
  byDay.set(day, e);
}
const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
const maxCost = Math.max(...days.map(([, v]) => v.cost), 0.0001);

function bar(value, max, width = 40) {
  if (max <= 0) return "";
  const filled = Math.round((value / max) * width);
  return "█".repeat(filled) + "·".repeat(width - filled);
}

console.log("  date         calls    cost      bar");
for (const [day, v] of days) {
  console.log(`  ${day}  ${String(v.calls).padStart(5)}   $${v.cost.toFixed(4)}  ${bar(v.cost, maxCost)}`);
}

// 3) Inflection
console.log("\n3) Inflection points (>2× day-over-day cost increase)\n");
let foundInflection = false;
for (let i = 1; i < days.length; i++) {
  const prev = days[i - 1][1].cost;
  const cur = days[i][1].cost;
  if (prev > 0.01 && cur > prev * 2) {
    console.log(
      `  ${days[i][0]}: $${prev.toFixed(4)} → $${cur.toFixed(4)}  (${(cur / prev).toFixed(1)}×)`
    );
    foundInflection = true;
  }
}
if (!foundInflection) console.log("  none — costs are stable day over day");

// 4) 7-day vs previous-7 comparison
const recent7 = days.slice(-7).reduce((a, [, v]) => a + v.cost, 0);
const previous7 = days.slice(-14, -7).reduce((a, [, v]) => a + v.cost, 0);
const totalCost = allRows.reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);
console.log("\n4) Summary\n");
console.log(`  30-day total:          $${totalCost.toFixed(2)}`);
console.log(`  Last 7 days:           $${recent7.toFixed(2)}`);
console.log(`  Previous 7 days:       $${previous7.toFixed(2)}`);
if (previous7 > 0) {
  const wow = ((recent7 - previous7) / previous7) * 100;
  console.log(`  Week-over-week:        ${wow >= 0 ? "+" : ""}${wow.toFixed(1)}%`);
}

// 5) PostHog LLM events check (separate source — Gemini calls might be logged there too)
console.log("\n" + "=".repeat(78));
console.log("Note: lib/posthog/llm-analytics.ts also captures Gemini metadata.");
console.log("If api_request_logs has 0 gemini rows but actual Gemini cost is going up,");
console.log("the calls are bypassing the api-gateway logger. Check:");
console.log("  • lib/gemini.ts — does it call logApiCall()?");
console.log("  • Google Cloud Console → AI Platform → Quotas / Billing for the source of truth");
console.log("  • PostHog → events filtered by '$ai_generation' for per-request data");
