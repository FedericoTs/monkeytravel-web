/**
 * Daily clicks/impressions from Search Console — the independent check.
 *
 * When GA4 reports a collapse, GA4 cannot be the evidence that the collapse
 * is or is not real. GSC is a separate pipeline: if organic impressions and
 * clicks are flat across the days GA4 shows as empty, real search traffic did
 * not change and the GA4 number is an artefact.
 *
 *   npx tsx scripts/gsc-daily.mts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const SITE = process.env.GSC_SITE || "sc-domain:monkeytravel.app";
const DAYS = Number(process.env.DAYS || 21);

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
const jwt = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
});
const webmasters = google.webmasters({ version: "v3", auth: jwt });

const fmt = (d: Date) => d.toISOString().slice(0, 10);
const shift = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const end = new Date();
const start = shift(end, -DAYS);

const res = await webmasters.searchanalytics.query({
  siteUrl: SITE,
  requestBody: { startDate: fmt(start), endDate: fmt(end), dimensions: ["date"], rowLimit: 1000 },
});
const rows = (res.data.rows ?? []) as Array<{
  keys: string[]; clicks: number; impressions: number; ctr: number; position: number;
}>;

console.log(`GSC daily, ${fmt(start)}..${fmt(end)}  (site: ${SITE})\n`);
console.log("date          clicks   impressions   ctr     avg pos");
console.log("-".repeat(56));
const clicks = rows.map((r) => r.clicks);
const med = [...clicks].sort((a, b) => a - b)[Math.floor(clicks.length / 2)] ?? 0;
for (const r of rows) {
  const flag = med && r.clicks < med * 0.5 ? "  << less than half the median" : "";
  console.log(
    `${r.keys[0]}   ${String(r.clicks).padStart(5)}   ${String(r.impressions).padStart(11)}   ${(r.ctr * 100).toFixed(2).padStart(5)}%   ${r.position.toFixed(1).padStart(5)}${flag}`,
  );
}
console.log(`\nmedian daily clicks over the window: ${med}`);
console.log("GSC lags ~2 days; the last row or two are partial and always read low.");
