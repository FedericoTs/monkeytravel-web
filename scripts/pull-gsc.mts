/**
 * Pull Google Search Console data for monkeytravel.app.
 *
 * Setup:
 *   1. Service account JSON must live at project root (gitignored).
 *   2. Service account email must be granted "Restricted" user on a GSC property.
 *   3. Run: npx tsx scripts/pull-gsc.mts
 *
 * Output:
 *   .audit/gsc/YYYY-MM-DD/ — raw + summarized JSON + a human-readable report
 *
 * Auth: service account JWT → OAuth2 → searchanalytics.query
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const PROJECT_ROOT = join(import.meta.dirname, "..");

// Discover the service-account JSON automatically — any file matching the
// gitignored patterns. Avoids hardcoding the key filename.
const KEY_FILENAME = readdirSync(PROJECT_ROOT).find(
  (f) =>
    f.startsWith("gen-lang-client-") && f.endsWith(".json") && !f.includes("package"),
);
if (!KEY_FILENAME) {
  console.error("✗ No service-account JSON found in project root (looking for gen-lang-client-*.json).");
  process.exit(1);
}
const KEY_PATH = join(PROJECT_ROOT, KEY_FILENAME);

// Both property formats — Search Console may have either or both.
const SITE_CANDIDATES = [
  "sc-domain:monkeytravel.app", // Domain property
  "https://monkeytravel.app/", // URL-prefix property
];

const DAYS_LOOKBACK = 90;
const ROW_LIMIT = 5000; // GSC max per request

// ----------------------------------------------------------------------------
// Auth
// ----------------------------------------------------------------------------

console.log(`→ Using service account JSON: ${KEY_FILENAME}`);
const keyJson = JSON.parse(readFileSync(KEY_PATH, "utf-8"));
console.log(`→ client_email: ${keyJson.client_email}`);
console.log(`→ project_id: ${keyJson.project_id}\n`);

const auth = new google.auth.JWT({
  email: keyJson.client_email,
  key: keyJson.private_key,
  scopes: [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/analytics.readonly",
  ],
});

await auth.authorize();
console.log(`✓ Auth handshake succeeded — JSON key is valid.\n`);

// ----------------------------------------------------------------------------
// Discover which property the robot has access to
// ----------------------------------------------------------------------------

const searchconsole = google.searchconsole({ version: "v1", auth });

console.log("→ Listing properties the service account can read…");
let sitesList: { siteUrl?: string | null; permissionLevel?: string | null }[];
try {
  const res = await searchconsole.sites.list();
  sitesList = res.data.siteEntry ?? [];
} catch (err) {
  console.error("✗ sites.list failed:", (err as Error).message);
  console.error("\n  This usually means the service account isn't granted access on ANY property yet.");
  console.error("  Add the email as a Restricted user in Search Console → Settings → Users and permissions.");
  process.exit(1);
}

if (sitesList.length === 0) {
  console.error("✗ Auth worked but the service account has access to ZERO Search Console properties.");
  console.error("\n  Fix: open Search Console → property → Settings → Users and permissions → Add user.");
  console.error(`  Email to add: ${keyJson.client_email}`);
  console.error(`  Permission: Restricted\n`);
  process.exit(1);
}

console.log(`✓ Service account has access to ${sitesList.length} property(ies):`);
for (const s of sitesList) console.log(`    - ${s.siteUrl}  [${s.permissionLevel}]`);

// Pick the first matching property
const targetSite =
  sitesList.find((s) => SITE_CANDIDATES.includes(s.siteUrl ?? ""))?.siteUrl ??
  sitesList[0]!.siteUrl!;

console.log(`\n→ Pulling data for: ${targetSite}`);

// ----------------------------------------------------------------------------
// Date range
// ----------------------------------------------------------------------------

const endDate = new Date();
endDate.setDate(endDate.getDate() - 2); // GSC has ~2-day reporting lag
const startDate = new Date(endDate);
startDate.setDate(startDate.getDate() - DAYS_LOOKBACK);

const fmt = (d: Date) => d.toISOString().slice(0, 10);
console.log(`→ Date range: ${fmt(startDate)} → ${fmt(endDate)} (${DAYS_LOOKBACK} days)\n`);

// ----------------------------------------------------------------------------
// Output dir
// ----------------------------------------------------------------------------

const todayStamp = new Date().toISOString().slice(0, 10);
const outDir = join(PROJECT_ROOT, ".audit", "gsc", todayStamp);
mkdirSync(outDir, { recursive: true });
console.log(`→ Output dir: ${outDir}\n`);

// ----------------------------------------------------------------------------
// Pull queries (dimension: query)
// ----------------------------------------------------------------------------

async function pullDimension(dimensions: string[], filename: string) {
  console.log(`→ Pulling dimensions: [${dimensions.join(", ")}]…`);
  const res = await searchconsole.searchanalytics.query({
    siteUrl: targetSite,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions,
      rowLimit: ROW_LIMIT,
      dataState: "all",
    },
  });
  const rows = res.data.rows ?? [];
  const outPath = join(outDir, filename);
  writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`  ✓ ${rows.length} rows → ${filename}`);
  return rows;
}

const queries = await pullDimension(["query"], "queries.json");
const pages = await pullDimension(["page"], "pages.json");
const countries = await pullDimension(["country"], "countries.json");
const devices = await pullDimension(["device"], "devices.json");
const queriesByPage = await pullDimension(["page", "query"], "queries-by-page.json");
const dailyTimeseries = await pullDimension(["date"], "daily.json");

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------

type Row = { keys?: string[] | null; clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null };

const summary = {
  meta: {
    property: targetSite,
    date_range: { start: fmt(startDate), end: fmt(endDate), days: DAYS_LOOKBACK },
    pulled_at: new Date().toISOString(),
  },
  totals: {
    clicks: queries.reduce((s: number, r: Row) => s + (r.clicks ?? 0), 0),
    impressions: queries.reduce((s: number, r: Row) => s + (r.impressions ?? 0), 0),
    avg_ctr_pct: 0,
    avg_position: 0,
  },
  top_queries_by_clicks: (queries as Row[])
    .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
    .slice(0, 30)
    .map((r) => ({
      query: r.keys?.[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr_pct: Math.round((r.ctr ?? 0) * 10000) / 100,
      position: Math.round((r.position ?? 0) * 10) / 10,
    })),
  top_queries_by_impressions: (queries as Row[])
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 30)
    .map((r) => ({
      query: r.keys?.[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr_pct: Math.round((r.ctr ?? 0) * 10000) / 100,
      position: Math.round((r.position ?? 0) * 10) / 10,
    })),
  // Striking distance: high impressions, position 8-20 — easy to lift into top 10
  striking_distance: (queries as Row[])
    .filter((r) => (r.position ?? 0) >= 8 && (r.position ?? 0) <= 20 && (r.impressions ?? 0) >= 50)
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 30)
    .map((r) => ({
      query: r.keys?.[0],
      impressions: r.impressions,
      clicks: r.clicks,
      ctr_pct: Math.round((r.ctr ?? 0) * 10000) / 100,
      position: Math.round((r.position ?? 0) * 10) / 10,
    })),
  top_pages_by_clicks: (pages as Row[])
    .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
    .slice(0, 30)
    .map((r) => ({
      page: r.keys?.[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr_pct: Math.round((r.ctr ?? 0) * 10000) / 100,
      position: Math.round((r.position ?? 0) * 10) / 10,
    })),
  top_pages_by_impressions: (pages as Row[])
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 30)
    .map((r) => ({
      page: r.keys?.[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr_pct: Math.round((r.ctr ?? 0) * 10000) / 100,
      position: Math.round((r.position ?? 0) * 10) / 10,
    })),
  // Underperforming: pages ranking well (position < 10) but low CTR (likely weak title/meta)
  underperforming_pages: (pages as Row[])
    .filter((r) => (r.position ?? 99) < 10 && (r.ctr ?? 0) < 0.02 && (r.impressions ?? 0) >= 100)
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 20)
    .map((r) => ({
      page: r.keys?.[0],
      impressions: r.impressions,
      clicks: r.clicks,
      ctr_pct: Math.round((r.ctr ?? 0) * 10000) / 100,
      position: Math.round((r.position ?? 0) * 10) / 10,
    })),
  countries: (countries as Row[])
    .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
    .slice(0, 15)
    .map((r) => ({ country: r.keys?.[0], clicks: r.clicks, impressions: r.impressions })),
  devices: (devices as Row[]).map((r) => ({
    device: r.keys?.[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr_pct: Math.round((r.ctr ?? 0) * 10000) / 100,
  })),
};

summary.totals.avg_ctr_pct = summary.totals.impressions
  ? Math.round((summary.totals.clicks / summary.totals.impressions) * 10000) / 100
  : 0;
summary.totals.avg_position =
  Math.round(
    ((queries as Row[]).reduce((s, r) => s + ((r.position ?? 0) * (r.impressions ?? 0)), 0) /
      (summary.totals.impressions || 1)) *
      10,
  ) / 10;

writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

// ----------------------------------------------------------------------------
// Human-readable report
// ----------------------------------------------------------------------------

const lines: string[] = [];
const push = (s = "") => lines.push(s);
const pad = (s: string | number | null | undefined, n: number) => String(s ?? "").padStart(n);

push(`# GSC Pull — ${targetSite}`);
push(`Date range: ${summary.meta.date_range.start} → ${summary.meta.date_range.end} (${summary.meta.date_range.days} days)`);
push(`Pulled at: ${summary.meta.pulled_at}`);
push();
push(`## Totals`);
push(`Clicks:        ${summary.totals.clicks.toLocaleString()}`);
push(`Impressions:   ${summary.totals.impressions.toLocaleString()}`);
push(`Avg CTR:       ${summary.totals.avg_ctr_pct}%`);
push(`Avg position:  ${summary.totals.avg_position}`);
push();

push(`## Top 30 queries by clicks`);
push(`${pad("clicks", 8)} ${pad("impr", 8)} ${pad("ctr%", 6)} ${pad("pos", 6)}  query`);
for (const r of summary.top_queries_by_clicks) {
  push(`${pad(r.clicks, 8)} ${pad(r.impressions, 8)} ${pad(r.ctr_pct, 6)} ${pad(r.position, 6)}  ${r.query}`);
}
push();

push(`## Top 30 queries by impressions (visibility, even if low clicks)`);
push(`${pad("impr", 8)} ${pad("clicks", 8)} ${pad("ctr%", 6)} ${pad("pos", 6)}  query`);
for (const r of summary.top_queries_by_impressions) {
  push(`${pad(r.impressions, 8)} ${pad(r.clicks, 8)} ${pad(r.ctr_pct, 6)} ${pad(r.position, 6)}  ${r.query}`);
}
push();

push(`## Striking distance (pos 8-20, ≥50 impressions — easy lift to page 1)`);
push(`${pad("impr", 8)} ${pad("clicks", 8)} ${pad("ctr%", 6)} ${pad("pos", 6)}  query`);
for (const r of summary.striking_distance) {
  push(`${pad(r.impressions, 8)} ${pad(r.clicks, 8)} ${pad(r.ctr_pct, 6)} ${pad(r.position, 6)}  ${r.query}`);
}
push();

push(`## Top 30 pages by clicks`);
push(`${pad("clicks", 8)} ${pad("impr", 8)} ${pad("ctr%", 6)} ${pad("pos", 6)}  page`);
for (const r of summary.top_pages_by_clicks) {
  push(`${pad(r.clicks, 8)} ${pad(r.impressions, 8)} ${pad(r.ctr_pct, 6)} ${pad(r.position, 6)}  ${r.page}`);
}
push();

push(`## Underperforming pages (rank top 10 but CTR <2% — weak titles/meta)`);
push(`${pad("impr", 8)} ${pad("clicks", 8)} ${pad("ctr%", 6)} ${pad("pos", 6)}  page`);
for (const r of summary.underperforming_pages) {
  push(`${pad(r.impressions, 8)} ${pad(r.clicks, 8)} ${pad(r.ctr_pct, 6)} ${pad(r.position, 6)}  ${r.page}`);
}
push();

push(`## Countries (top 15 by clicks)`);
for (const r of summary.countries) {
  push(`  ${r.country?.toUpperCase()}  clicks=${r.clicks}  impressions=${r.impressions}`);
}
push();

push(`## Devices`);
for (const r of summary.devices) {
  push(`  ${r.device}  clicks=${r.clicks}  impressions=${r.impressions}  ctr=${r.ctr_pct}%`);
}

const reportPath = join(outDir, "REPORT.md");
writeFileSync(reportPath, lines.join("\n"));

console.log(`\n✓ Wrote summary.json + REPORT.md`);
console.log(`\n${"═".repeat(70)}`);
console.log(`  Open ${reportPath} to read the human-readable report.`);
console.log(`${"═".repeat(70)}\n`);

// Echo the key headline numbers to console
console.log(`Totals over ${DAYS_LOOKBACK} days:`);
console.log(`  ${summary.totals.clicks.toLocaleString()} clicks`);
console.log(`  ${summary.totals.impressions.toLocaleString()} impressions`);
console.log(`  ${summary.totals.avg_ctr_pct}% avg CTR`);
console.log(`  position ${summary.totals.avg_position} avg`);
