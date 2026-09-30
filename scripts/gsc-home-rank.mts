/**
 * The homepage's rank on the "trip planner" family, read the way the audit asked:
 * page EQUALS https://monkeytravel.app/ (the other gsc-* scripts filter with
 * "contains", which matches every page on the bare domain).
 *
 * Prints, for the homepage: impressions, clicks and position per week; the
 * family's head queries in a before and an after window; India's "trip
 * planner" impressions per week; and which of our pages the family lands on
 * in the after window.
 *
 *   npx tsx scripts/gsc-home-rank.mts [--before A,B] [--after C,D]
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const SITE = process.env.GSC_SITE || "sc-domain:monkeytravel.app";
const HOME = "https://monkeytravel.app/";

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

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const [b0, b1] = (opt("--before") ?? "2026-08-10,2026-08-27").split(",");
const [a0, a1] = (opt("--after") ?? "2026-09-15,2026-09-28").split(",");

type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
type Filter = { dimension: string; operator: string; expression: string };

async function query(startDate: string, endDate: string, dimensions: string[], filters: Filter[], rowLimit = 5000): Promise<Row[]> {
  const res = await webmasters.searchanalytics.query({
    siteUrl: SITE,
    requestBody: {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      dimensionFilterGroups: filters.length ? [{ filters }] : undefined,
    },
  });
  return (res.data.rows ?? []) as Row[];
}

const homeOnly: Filter = { dimension: "page", operator: "equals", expression: HOME };
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
const n1 = (n: number) => n.toFixed(1);

// 1. The homepage by week, over the last ten weeks.
const end = new Date();
end.setDate(end.getDate() - 2);
const start = new Date(end);
start.setDate(start.getDate() - 69);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const daily = await query(fmt(start), fmt(end), ["date"], [homeOnly]);
console.log(`Homepage (page equals ${HOME}), ${fmt(start)}..${fmt(end)}\n`);
console.log("week starting   impr/day  clicks/day   ctr     pos");
const weeks = new Map<string, { impr: number; clicks: number; posSum: number; n: number }>();
for (const r of daily) {
  const d = new Date(r.keys[0]);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const k = fmt(monday);
  const w = weeks.get(k) ?? { impr: 0, clicks: 0, posSum: 0, n: 0 };
  w.impr += r.impressions;
  w.clicks += r.clicks;
  w.posSum += r.position * r.impressions;
  w.n += 1;
  weeks.set(k, w);
}
for (const [k, w] of [...weeks.entries()].sort()) {
  console.log(`${k}      ${String(Math.round(w.impr / w.n)).padStart(6)}   ${n1(w.clicks / w.n).padStart(8)}   ${(100 * w.clicks / Math.max(1, w.impr)).toFixed(2)}%  ${n1(w.posSum / Math.max(1, w.impr))}`);
}

// 2. Head queries on the homepage, before vs after.
const HEAD = ["ai trip planner", "trip planner ai", "ai travel planner", "trip planner", "free ai trip planner", "ai itinerary planner", "monkeytravel", "monkey travel"];
const before = await query(b0, b1, ["query"], [homeOnly]);
const after = await query(a0, a1, ["query"], [homeOnly]);
const byQ = (rows: Row[]) => new Map(rows.map((r) => [r.keys[0], r]));
const bq = byQ(before);
const aq = byQ(after);
console.log(`\nHead queries on the homepage: before ${b0}..${b1} (${days(b0, b1)} d) vs after ${a0}..${a1} (${days(a0, a1)} d), impressions per day\n`);
console.log("query                      before impr/day  pos  |  after impr/day  pos  | clicks/day before -> after");
for (const q of HEAD) {
  const b = bq.get(q);
  const a = aq.get(q);
  const bi = b ? b.impressions / days(b0, b1) : 0;
  const ai = a ? a.impressions / days(a0, a1) : 0;
  console.log(
    `${q.padEnd(26)} ${n1(bi).padStart(10)}  ${b ? n1(b.position).padStart(5) : "    -"}  | ${n1(ai).padStart(10)}  ${a ? n1(a.position).padStart(5) : "    -"}  | ${n1(b ? b.clicks / days(b0, b1) : 0)} -> ${n1(a ? a.clicks / days(a0, a1) : 0)}`
  );
}
const sum = (rows: Row[], k: "impressions" | "clicks") => rows.reduce((s, r) => s + r[k], 0);
console.log(`\nall homepage queries: impr/day ${n1(sum(before, "impressions") / days(b0, b1))} -> ${n1(sum(after, "impressions") / days(a0, a1))}, clicks/day ${n1(sum(before, "clicks") / days(b0, b1))} -> ${n1(sum(after, "clicks") / days(a0, a1))}`);

// 3. India, "trip planner" queries on the homepage, by week.
const india = await query(fmt(start), fmt(end), ["date"], [homeOnly, { dimension: "country", operator: "equals", expression: "ind" }, { dimension: "query", operator: "contains", expression: "trip planner" }]);
const iw = new Map<string, { impr: number; clicks: number; posSum: number }>();
for (const r of india) {
  const d = new Date(r.keys[0]);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const k = fmt(monday);
  const w = iw.get(k) ?? { impr: 0, clicks: 0, posSum: 0 };
  w.impr += r.impressions;
  w.clicks += r.clicks;
  w.posSum += r.position * r.impressions;
  iw.set(k, w);
}
console.log(`\nIndia, "trip planner" queries on the homepage, per week (impressions, clicks, pos)`);
for (const [k, w] of [...iw.entries()].sort()) console.log(`${k}  ${String(w.impr).padStart(5)}  ${String(w.clicks).padStart(3)}  ${n1(w.posSum / Math.max(1, w.impr))}`);

// 4. Which pages the family lands on, after window.
const family = await query(a0, a1, ["page"], [{ dimension: "query", operator: "contains", expression: "trip planner" }]);
console.log(`\n"trip planner" queries by page, ${a0}..${a1} (impr/day, clicks/day, pos)`);
for (const r of family.filter((x) => !x.keys[0].includes("#")).sort((x, y) => y.impressions - x.impressions).slice(0, 8)) {
  console.log(`${r.keys[0].replace("https://monkeytravel.app", "").padEnd(60)} ${n1(r.impressions / days(a0, a1)).padStart(8)}  ${n1(r.clicks / days(a0, a1)).padStart(6)}  ${n1(r.position)}`);
}
