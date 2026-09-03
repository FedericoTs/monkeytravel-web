/**
 * For the biggest impression gaps: which page is ranking, and what is it
 * called?
 *
 * The seasonal pull surfaced queries that rank well and get NO clicks at all —
 * "best places to see fall foliage" at 6,818 impressions and position 3.6 with
 * zero, "wanderlog pro cost" at position 1.1 with zero. A page that ranks and
 * is not clicked is a different problem from a page that does not rank, and
 * the fix is different too: title/snippet, or intent mismatch, or an AI
 * Overview answering in the SERP. This gets the page so the question can be
 * answered instead of guessed.
 *
 *   npx tsx scripts/gsc-opportunity-drill.mts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const SITE = process.env.GSC_SITE || "sc-domain:monkeytravel.app";
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 14);

function findKeyPath(): string | null {
  const fromEnv = process.env.GSC_SERVICE_ACCOUNT_KEY;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const shared = join(home, ".config", "claude-seo", "gsc-service-account.json");
  if (home && existsSync(shared)) return shared;
  const inRoot = readdirSync(PROJECT_ROOT).find((f) => f.endsWith(".json") && f.includes("service"));
  return inRoot ? join(PROJECT_ROOT, inRoot) : null;
}

const key = JSON.parse(readFileSync(findKeyPath()!, "utf8"));
const jwt = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
});
const webmasters = google.webmasters({ version: "v3", auth: jwt });

const fmt = (d: Date) => d.toISOString().slice(0, 10);
const shift = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const end = shift(new Date(), -2);
const start = shift(end, -(WINDOW_DAYS - 1));

interface Row { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

async function q(dimensions: string[], filters?: { dimension: string; expression: string; operator?: string }[]) {
  const res = await webmasters.searchanalytics.query({
    siteUrl: SITE,
    requestBody: {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions,
      rowLimit: 25000,
      ...(filters ? { dimensionFilterGroups: [{ filters: filters.map((f) => ({ operator: "contains", ...f })) }] } : {}),
    },
  });
  return (res.data.rows ?? []) as Row[];
}

console.log("");
console.log(`Opportunity drill · ${fmt(start)} → ${fmt(end)}`);

// ---------------------------------------------------------------- pages
console.log("");
console.log("=== top pages by impressions ===");
console.log("  impr   clicks    CTR    pos   page");
const pages = (await q(["page"])).sort((a, b) => b.impressions - a.impressions).slice(0, 20);
for (const p of pages) {
  const path = p.keys[0].replace(/^https?:\/\/[^/]+/, "");
  console.log(
    `  ${String(p.impressions).padStart(5)} ${String(p.clicks).padStart(7)} ${(p.ctr * 100).toFixed(2).padStart(6)}% ${p.position.toFixed(1).padStart(6)}   ${path}`
  );
}

// ------------------------------------------------ the zero-click headliners
const TARGETS = [
  "fall foliage",
  "wanderlog pro cost",
  "where to travel solo",
  "settembre 2026",
  "monsoon",
  "weakest passport",
];

for (const target of TARGETS) {
  console.log("");
  console.log(`=== "${target}" → which page ranks ===`);
  const rows = await q(["query", "page"], [{ dimension: "query", expression: target }]);
  const top = rows.sort((a, b) => b.impressions - a.impressions).slice(0, 6);
  if (!top.length) { console.log("  (no rows)"); continue; }
  for (const r of top) {
    const path = r.keys[1].replace(/^https?:\/\/[^/]+/, "");
    console.log(
      `  ${String(r.impressions).padStart(5)} impr ${String(r.clicks).padStart(4)} clk  pos ${r.position.toFixed(1).padStart(5)}  ${r.keys[0]}`
    );
    console.log(`        → ${path}`);
  }
  const totImpr = rows.reduce((a, r) => a + r.impressions, 0);
  const totClicks = rows.reduce((a, r) => a + r.clicks, 0);
  console.log(`  ── all matching queries: ${totImpr} impr, ${totClicks} clicks`);
}

// --------------------------------------------- month intent, by landing page
console.log("");
console.log("=== November / December / October queries → landing pages ===");
for (const month of ["november", "december", "october", "novembre", "dicembre", "noviembre"]) {
  const rows = await q(["query", "page"], [{ dimension: "query", expression: month }]);
  if (!rows.length) continue;
  const byPage = new Map<string, { impr: number; clicks: number }>();
  for (const r of rows) {
    const path = r.keys[1].replace(/^https?:\/\/[^/]+/, "");
    const b = byPage.get(path) ?? { impr: 0, clicks: 0 };
    b.impr += r.impressions;
    b.clicks += r.clicks;
    byPage.set(path, b);
  }
  const total = rows.reduce((a, r) => a + r.impressions, 0);
  console.log(`  "${month}": ${total} impr across ${byPage.size} page(s)`);
  for (const [path, b] of [...byPage.entries()].sort((a, b) => b[1].impr - a[1].impr).slice(0, 5)) {
    console.log(`      ${String(b.impr).padStart(5)} impr ${String(b.clicks).padStart(4)} clk  ${path}`);
  }
}
console.log("");
