/**
 * Drill into ONE page's Search Console data.
 *
 * Why this exists: pull-gsc.mts fetches global dimensions capped at GSC's
 * 5,000-row limit, so a mid-traffic page's queries get crowded out by the
 * head. /blog/etias-europe-travel-authorization-2026 showed 40,651 impressions
 * at the page level but only 20 impressions' worth of attributed queries —
 * that is a sampling artefact of the global pull, not anonymisation.
 *
 * This applies a page filter so the row budget is spent on one URL.
 *
 * Usage:
 *   npx tsx scripts/gsc-page-drill.mts <url-substring> [days]
 *
 * Example:
 *   npx tsx scripts/gsc-page-drill.mts etias 90
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";

const PROJECT_ROOT = join(import.meta.dirname, "..");

function findKeyPath(): string | null {
  const fromEnv = process.env.GSC_SERVICE_ACCOUNT_KEY;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const shared = join(home, ".config", "claude-seo", "gsc-service-account.json");
  if (home && existsSync(shared)) return shared;
  const inRoot = readdirSync(PROJECT_ROOT).find(
    (f) => f.startsWith("gen-lang-client-") && f.endsWith(".json") && !f.includes("package"),
  );
  return inRoot ? join(PROJECT_ROOT, inRoot) : null;
}

const needle = process.argv[2];
const days = Number(process.argv[3] ?? 90);
if (!needle) {
  console.error("Usage: npx tsx scripts/gsc-page-drill.mts <url-substring> [days]");
  process.exit(1);
}

const KEY_PATH = findKeyPath();
if (!KEY_PATH) {
  console.error("✗ No service-account JSON found (see pull-gsc.mts for the search order).");
  process.exit(1);
}

const keyJson = JSON.parse(readFileSync(KEY_PATH, "utf-8"));
const auth = new google.auth.JWT({
  email: keyJson.client_email,
  key: keyJson.private_key,
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
});
await auth.authorize();

const searchconsole = google.searchconsole({ version: "v1", auth });
const SITE = "sc-domain:monkeytravel.app";

const endDate = new Date();
endDate.setDate(endDate.getDate() - 2); // GSC reporting lag
const startDate = new Date(endDate);
startDate.setDate(startDate.getDate() - days);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

type Row = {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
};

async function q(dimensions: string[]) {
  const res = await searchconsole.searchanalytics.query({
    siteUrl: SITE,
    requestBody: {
      startDate: fmt(startDate),
      endDate: fmt(endDate),
      dimensions,
      rowLimit: 5000,
      dataState: "all",
      dimensionFilterGroups: [
        { filters: [{ dimension: "page", operator: "contains", expression: needle }] },
      ],
    },
  });
  return (res.data.rows ?? []) as Row[];
}

console.log(`Page filter: contains "${needle}"   ${fmt(startDate)} → ${fmt(endDate)}\n`);

const byQuery = await q(["query"]);
const byCountry = await q(["country"]);
const byDevice = await q(["device"]);
const bySurface = await q(["searchAppearance"]);

const tot = (rows: Row[], k: "clicks" | "impressions") =>
  rows.reduce((s, r) => s + (r[k] ?? 0), 0);

console.log(
  `queries returned: ${byQuery.length}, covering ${tot(byQuery, "impressions")} impressions / ${tot(byQuery, "clicks")} clicks\n`,
);

console.log("=== TOP QUERIES BY IMPRESSIONS ===");
console.log("%s".padEnd(0), "query".padEnd(52), "impr".padStart(8), "clk".padStart(5), "CTR".padStart(7), "pos".padStart(6));
for (const r of byQuery.sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)).slice(0, 30)) {
  console.log(
    (r.keys?.[0] ?? "").slice(0, 52).padEnd(52),
    String(r.impressions ?? 0).padStart(8),
    String(r.clicks ?? 0).padStart(5),
    (((r.ctr ?? 0) * 100).toFixed(2) + "%").padStart(7),
    (r.position ?? 0).toFixed(1).padStart(6),
  );
}

console.log("\n=== BY COUNTRY (top 12) ===");
for (const r of byCountry.sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)).slice(0, 12)) {
  console.log(
    (r.keys?.[0] ?? "").padEnd(10),
    String(r.impressions ?? 0).padStart(8),
    String(r.clicks ?? 0).padStart(5),
    (((r.ctr ?? 0) * 100).toFixed(2) + "%").padStart(7),
    (r.position ?? 0).toFixed(1).padStart(6),
  );
}

console.log("\n=== BY DEVICE ===");
for (const r of byDevice) {
  console.log(
    (r.keys?.[0] ?? "").padEnd(10),
    String(r.impressions ?? 0).padStart(8),
    String(r.clicks ?? 0).padStart(5),
    (((r.ctr ?? 0) * 100).toFixed(2) + "%").padStart(7),
    (r.position ?? 0).toFixed(1).padStart(6),
  );
}

console.log("\n=== BY SEARCH APPEARANCE (AI Overview / rich result surfaces) ===");
if (bySurface.length === 0) console.log("  (none reported)");
for (const r of bySurface) {
  console.log(
    (r.keys?.[0] ?? "").padEnd(28),
    String(r.impressions ?? 0).padStart(8),
    String(r.clicks ?? 0).padStart(5),
    (((r.ctr ?? 0) * 100).toFixed(2) + "%").padStart(7),
    (r.position ?? 0).toFixed(1).padStart(6),
  );
}
