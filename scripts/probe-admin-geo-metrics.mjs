/**
 * Does the admin traffic dashboard survive its own Promise.all?
 *
 * WHY THIS SHAPE
 * --------------
 * On 2026-09-01 all SEVEN geo metrics timed out together in production (Sentry
 * JAVASCRIPT-NEXTJS-2C..2J, every one pg_code 57014) on the very release that
 * had just made four of them faster. Measuring each query alone could not have
 * predicted it: individually they ran 3.5-7.8s, but app/api/admin/stats/route.ts
 * fires them in ONE Promise.all against a cluster with max_parallel_workers = 2
 * and work_mem = 2184kB, so most lost their parallel worker and every sort
 * spilled. The set failed, not any member of it.
 *
 * So this probe does not time queries one at a time. It fires the exact same
 * concurrent batch the route fires, through PostgREST (which connects as
 * `authenticator`, carrying the hard statement_timeout = 8s), and fails if ANY
 * of them errors or comes back empty.
 *
 * An empty result is a failure here, not a pass: `(x.data || [])` turning a
 * timeout into [] is precisely how this dashboard rendered confident zeros for
 * months while activation decisions were made from that screen.
 *
 *   node scripts/probe-admin-geo-metrics.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function creds() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if ((!url || !key) && existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "NEXT_PUBLIC_SUPABASE_URL" && !url) url = v;
      if (m[1] === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
    }
  }
  return { url, key };
}

const { url, key } = creds();
if (!url || !key) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The same call set, in the same shape, as fetchGeoMetrics().
const CALLS = [
  "get_page_view_totals",
  "count_unique_visitors",
  "get_page_views_by_country",
  "get_page_views_by_city",
  "get_top_pages",
  "get_page_views_daily_trend",
  "get_page_views_by_section",
  "get_conversion_funnel",
];

const t0 = Date.now();
const results = await Promise.all(
  CALLS.map(async (name) => {
    const started = Date.now();
    const { data, error } = await db.rpc(name);
    return { name, ms: Date.now() - started, error, rows: Array.isArray(data) ? data.length : data == null ? 0 : 1 };
  })
);
const wall = Date.now() - t0;

console.log("\n=== concurrent batch (as the route fires it) ===");
let failed = 0;
for (const r of results) {
  const bad = r.error || r.rows === 0;
  if (bad) failed++;
  console.log(
    `  ${bad ? "FAIL" : "ok  "}  ${r.name.padEnd(28)} ${String(r.ms).padStart(6)}ms  rows=${r.rows}` +
      (r.error ? `  ${r.error.code ?? "?"} ${r.error.message}` : "")
  );
}
console.log(`\n  wall clock for the whole batch: ${wall}ms  (statement_timeout is 8000ms per call)`);

// Freshness: a stale rollup renders confident numbers that are quietly ageing.
const { data: totals } = await db.rpc("get_page_view_totals");
const row = Array.isArray(totals) ? totals[0] : null;
const ageH = row?.refreshed_at ? (Date.now() - new Date(row.refreshed_at).getTime()) / 36e5 : Infinity;
console.log(
  `  rollup refreshed ${Number.isFinite(ageH) ? ageH.toFixed(1) + "h ago" : "NEVER"}` +
    ` (route marks degraded past 36h)`
);
if (row) {
  console.log(`  totals: all-time=${row.total_views}  7d=${row.last_7_days}  30d=${row.last_30_days}`);
}

const stale = !(ageH <= 36);
if (stale) failed++;

console.log(
  failed === 0
    ? "\n  PASS - all 8 answered under contention, none empty, rollup fresh.\n"
    : `\n  *** FAIL - ${failed} metric(s) errored, came back empty, or the rollup is stale. ***\n`
);
process.exit(failed === 0 ? 0 : 2);
