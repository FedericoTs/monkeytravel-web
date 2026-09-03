/**
 * Which months are people searching for RIGHT NOW, and do we have a page for it.
 *
 * THE HYPOTHESIS THIS TESTS
 * -------------------------
 * That travellers search roughly three months ahead, so in early September the
 * demand is for November and December. If true, seasonal pages should be
 * published on that lead time rather than in-month.
 *
 * It is worth testing rather than assuming, because the prior measurement on
 * this site points the other way: comparison/review posts drew 140 readers at
 * 20.7% generate-rate over 90 days while practical/seasonal drew 112 at a
 * lower rate, and "seasonal is the trap" is recorded as a finding. Both can be
 * true — seasonal may lose on CONVERSION while still winning on VOLUME — so
 * this reports impressions, clicks, position AND whether a page exists, and
 * leaves the trade-off visible instead of picking for you.
 *
 * WHAT IT DOES
 * ------------
 *   1. Pulls the last 14 days of queries, and the 14 days before that.
 *   2. Buckets every query by the month name it mentions.
 *   3. Reports which months are RISING — that is the lead-time answer, and it
 *      comes from this site's own searchers rather than a rule of thumb.
 *   4. Lists the highest-impression queries with no clicks, which is where
 *      content is missing rather than merely ranked badly.
 *   5. Cross-references the month buckets against posts we already have.
 *
 *   npx tsx scripts/gsc-seasonal-demand.mts
 */
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
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
const dayShift = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

// GSC lags ~2 days; anything more recent is partial and reads as a decline.
const end = dayShift(new Date(), -2);
const start = dayShift(end, -(WINDOW_DAYS - 1));
const prevEnd = dayShift(start, -1);
const prevStart = dayShift(prevEnd, -(WINDOW_DAYS - 1));

interface Row { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

async function query(dimensions: string[], s: Date, e: Date, rowLimit = 25000): Promise<Row[]> {
  const res = await webmasters.searchanalytics.query({
    siteUrl: SITE,
    requestBody: { startDate: fmt(s), endDate: fmt(e), dimensions, rowLimit },
  });
  return (res.data.rows ?? []) as Row[];
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
/** es/it/pt month names, since 3 of 4 shipped locales are not English. */
const MONTH_ALIASES: Record<string, string[]> = {
  january: ["enero", "gennaio", "janeiro"],
  february: ["febrero", "febbraio", "fevereiro"],
  march: ["marzo", "março", "marco"],
  april: ["abril", "aprile"],
  may: ["mayo", "maggio", "maio"],
  june: ["junio", "giugno", "junho"],
  july: ["julio", "luglio", "julho"],
  august: ["agosto"],
  september: ["septiembre", "settembre", "setembro"],
  october: ["octubre", "ottobre", "outubro"],
  november: ["noviembre", "novembre", "novembro"],
  december: ["diciembre", "dicembre", "dezembro"],
};

function monthOf(q: string): string | null {
  const s = q.toLowerCase();
  for (const m of MONTHS) {
    if (s.includes(m)) return m;
    if (MONTH_ALIASES[m]?.some((a) => s.includes(a))) return m;
  }
  return null;
}

interface Bucket { clicks: number; impressions: number; queries: number; posSum: number }
const empty = (): Bucket => ({ clicks: 0, impressions: 0, queries: 0, posSum: 0 });

function bucketByMonth(rows: Row[]) {
  const out = new Map<string, Bucket>();
  for (const r of rows) {
    const m = monthOf(r.keys[0]);
    if (!m) continue;
    const b = out.get(m) ?? empty();
    b.clicks += r.clicks;
    b.impressions += r.impressions;
    b.queries += 1;
    b.posSum += r.position * r.impressions;
    out.set(m, b);
  }
  return out;
}

const pct = (a: number, b: number) => (b === 0 ? (a > 0 ? Infinity : 0) : ((a - b) / b) * 100);
const arrow = (v: number) => (v === Infinity ? "NEW" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`);

console.log("");
console.log(`Search demand by month · ${SITE}`);
console.log(`  current  ${fmt(start)} → ${fmt(end)}  (${WINDOW_DAYS} days)`);
console.log(`  previous ${fmt(prevStart)} → ${fmt(prevEnd)}`);

const [cur, prev] = await Promise.all([
  query(["query"], start, end),
  query(["query"], prevStart, prevEnd),
]);

const totals = (rows: Row[]) =>
  rows.reduce((a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }), { clicks: 0, impressions: 0 });
const tc = totals(cur);
const tp = totals(prev);

console.log("");
console.log("=== overall ===");
console.log(`  queries      ${cur.length} (was ${prev.length})`);
console.log(`  impressions  ${tc.impressions} (was ${tp.impressions}, ${arrow(pct(tc.impressions, tp.impressions))})`);
console.log(`  clicks       ${tc.clicks} (was ${tp.clicks}, ${arrow(pct(tc.clicks, tp.clicks))})`);
console.log(`  CTR          ${((tc.clicks / Math.max(1, tc.impressions)) * 100).toFixed(2)}%`);

const bc = bucketByMonth(cur);
const bp = bucketByMonth(prev);

console.log("");
console.log("=== month-named demand, current window ===");
console.log("  month       impr   clicks   avg pos   distinct q   vs prev");
const monthRows = MONTHS.map((m) => ({ m, b: bc.get(m) ?? empty(), p: bp.get(m) ?? empty() }))
  .filter((r) => r.b.impressions > 0 || r.p.impressions > 0)
  .sort((a, b) => b.b.impressions - a.b.impressions);
if (monthRows.length === 0) {
  console.log("  (no query in either window names a month)");
}
for (const { m, b, p } of monthRows) {
  const avgPos = b.impressions ? (b.posSum / b.impressions).toFixed(1) : "—";
  console.log(
    `  ${m.padEnd(10)} ${String(b.impressions).padStart(5)} ${String(b.clicks).padStart(8)} ${String(avgPos).padStart(9)} ${String(b.queries).padStart(12)}   ${arrow(pct(b.impressions, p.impressions))}`
  );
}

console.log("");
console.log("=== the lead-time question ===");
const now = new Date();
const curMonthIdx = now.getMonth();
const label = (offset: number) => MONTHS[(curMonthIdx + offset + 12) % 12];
for (const off of [0, 1, 2, 3, 4]) {
  const m = label(off);
  const b = bc.get(m) ?? empty();
  const p = bp.get(m) ?? empty();
  const tag = off === 0 ? "this month" : `+${off} month${off > 1 ? "s" : ""}`;
  console.log(
    `  ${tag.padEnd(11)} ${m.padEnd(10)} impr ${String(b.impressions).padStart(5)}  clicks ${String(b.clicks).padStart(4)}  ${arrow(pct(b.impressions, p.impressions))}`
  );
}

console.log("");
console.log("=== biggest impressions with ZERO clicks (content gaps, not ranking gaps) ===");
const zeroClick = cur
  .filter((r) => r.clicks === 0 && r.impressions >= 5)
  .sort((a, b) => b.impressions - a.impressions)
  .slice(0, 25);
for (const r of zeroClick) {
  console.log(`  ${String(r.impressions).padStart(4)} impr  pos ${r.position.toFixed(1).padStart(5)}  ${r.keys[0]}`);
}

console.log("");
console.log("=== month-named queries in detail (current window) ===");
const monthQueries = cur
  .filter((r) => monthOf(r.keys[0]))
  .sort((a, b) => b.impressions - a.impressions)
  .slice(0, 30);
if (!monthQueries.length) console.log("  (none)");
for (const r of monthQueries) {
  console.log(
    `  ${String(r.impressions).padStart(4)} impr  ${String(r.clicks).padStart(3)} clk  pos ${r.position.toFixed(1).padStart(5)}  ${r.keys[0]}`
  );
}

// Save the raw rows so a follow-up does not need another API round trip.
const outDir = join(PROJECT_ROOT, ".audit", "gsc", `${fmt(end)}-seasonal`);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "current-queries.json"), JSON.stringify(cur, null, 2));
writeFileSync(join(outDir, "previous-queries.json"), JSON.stringify(prev, null, 2));
console.log("");
console.log(`Raw rows written to ${outDir}`);
console.log("");
