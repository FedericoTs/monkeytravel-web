/**
 * Search Console: compare two windows along one dimension, so a drop can be
 * attributed rather than described.
 *
 *   npx tsx scripts/gsc-compare.mts <dimension> [--before A,B] [--after C,D] [--limit N] [--filter dim=value]
 *
 *   dimension: page | query | country | device | searchAppearance | date
 *   --before / --after: inclusive date ranges (YYYY-MM-DD,YYYY-MM-DD). Defaults:
 *     before = 2026-09-07..2026-09-14, after = 2026-09-15..2026-09-19.
 *   --filter: e.g. --filter page=/blog/  (contains) or --filter country=usa (equals)
 *   --json: print JSON instead of a table
 *
 * Read-only. Uses the same key lookup as gsc-daily.mts.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const SITE = process.env.GSC_SITE || "sc-domain:monkeytravel.app";

function findKeyPath(): string | null {
  const fromEnv = process.env.GSC_SERVICE_ACCOUNT_KEY;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const shared = join(home, ".config", "claude-seo", "gsc-service-account.json");
  if (home && existsSync(shared)) return shared;
  const inRoot = readdirSync(PROJECT_ROOT).find((f) => f.endsWith(".json") && f.includes("service"));
  return inRoot ? join(PROJECT_ROOT, inRoot) : null;
}
const keyPath = findKeyPath();
if (!keyPath) {
  console.error("No GSC service-account key found.");
  process.exit(1);
}
const key = JSON.parse(readFileSync(keyPath, "utf8"));
const jwt = new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] });
const webmasters = google.webmasters({ version: "v3", auth: jwt });

const argv = process.argv.slice(2);
const dimension = argv.find((a) => !a.startsWith("--")) ?? "page";
const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const [b0, b1] = (opt("--before") ?? "2026-09-07,2026-09-14").split(",");
const [a0, a1] = (opt("--after") ?? "2026-09-15,2026-09-19").split(",");
const limit = Number(opt("--limit") ?? 40);
const asJson = argv.includes("--json");
const filterArg = opt("--filter");
const filters = filterArg
  ? [(() => { const [d, v] = filterArg.split("="); return { dimension: d, expression: v, operator: d === "page" || d === "query" ? "contains" : "equals" }; })()]
  : undefined;

type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
async function pull(start: string, end: string): Promise<Row[]> {
  const res = await webmasters.searchanalytics.query({
    siteUrl: SITE,
    requestBody: {
      startDate: start, endDate: end, dimensions: [dimension], rowLimit: 25000,
      ...(filters ? { dimensionFilterGroups: [{ filters }] } : {}),
    },
  });
  return (res.data.rows ?? []) as Row[];
}

const [before, after] = await Promise.all([pull(b0, b1), pull(a0, a1)]);
const daysBefore = (new Date(b1).getTime() - new Date(b0).getTime()) / 86_400_000 + 1;
const daysAfter = (new Date(a1).getTime() - new Date(a0).getTime()) / 86_400_000 + 1;
const map = new Map<string, { b?: Row; a?: Row }>();
for (const r of before) map.set(r.keys[0], { ...(map.get(r.keys[0]) ?? {}), b: r });
for (const r of after) map.set(r.keys[0], { ...(map.get(r.keys[0]) ?? {}), a: r });

// Per-day so a 8-day window and a 5-day window compare fairly.
const rows = [...map.entries()].map(([k, { b, a }]) => {
  const bi = (b?.impressions ?? 0) / daysBefore, ai = (a?.impressions ?? 0) / daysAfter;
  const bc = (b?.clicks ?? 0) / daysBefore, ac = (a?.clicks ?? 0) / daysAfter;
  return {
    key: k, impr_before_pd: +bi.toFixed(1), impr_after_pd: +ai.toFixed(1), impr_delta_pd: +(ai - bi).toFixed(1),
    clicks_before_pd: +bc.toFixed(2), clicks_after_pd: +ac.toFixed(2), clicks_delta_pd: +(ac - bc).toFixed(2),
    pos_before: b ? +b.position.toFixed(1) : null, pos_after: a ? +a.position.toFixed(1) : null,
  };
});
const totals = {
  dimension, before: `${b0}..${b1}`, after: `${a0}..${a1}`,
  impr_before_pd: +rows.reduce((s, r) => s + r.impr_before_pd, 0).toFixed(0),
  impr_after_pd: +rows.reduce((s, r) => s + r.impr_after_pd, 0).toFixed(0),
  clicks_before_pd: +rows.reduce((s, r) => s + r.clicks_before_pd, 0).toFixed(1),
  clicks_after_pd: +rows.reduce((s, r) => s + r.clicks_after_pd, 0).toFixed(1),
  rows_before: before.length, rows_after: after.length,
};
const losers = [...rows].sort((x, y) => x.impr_delta_pd - y.impr_delta_pd).slice(0, limit);
const gainers = [...rows].sort((x, y) => y.impr_delta_pd - x.impr_delta_pd).slice(0, Math.min(limit, 15));

if (asJson) {
  console.log(JSON.stringify({ totals, losers, gainers }, null, 1));
} else {
  console.log(JSON.stringify(totals));
  console.log(`\nBiggest impression losers per day (${dimension}):`);
  console.table(losers);
  console.log(`\nBiggest gainers per day (${dimension}):`);
  console.table(gainers);
}
