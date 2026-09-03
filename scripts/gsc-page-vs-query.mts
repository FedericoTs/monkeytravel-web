/**
 * For a query cluster, WHICH of our pages is Google actually showing?
 *
 * Written after a false negative worth remembering: a coverage check keyed on
 * slug substrings ("off-season", "shoulder") reported the low-season theme as
 * uncovered, when content/blog/alta-e-bassa-stagione-2026.md had existed in
 * all four locales the whole time. Coverage-by-slug-guess is unreliable;
 * coverage-by-what-Google-serves is not.
 *
 * The interesting failure is not "no page" but "the WRONG page ranks" — a
 * pillar absorbing queries a dedicated post was written to answer. This prints
 * every page a cluster lands on, and every query a given page receives, so the
 * two can be compared directly.
 *
 *   npx tsx scripts/gsc-page-vs-query.mts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const SITE = process.env.GSC_SITE || "sc-domain:monkeytravel.app";
const WINDOW = Number(process.env.WINDOW_DAYS || 28);

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
const end = shift(new Date(), -2);
const start = shift(end, -(WINDOW - 1));

interface Row {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

const res = await webmasters.searchanalytics.query({
  siteUrl: SITE,
  requestBody: { startDate: fmt(start), endDate: fmt(end), dimensions: ["page", "query"], rowLimit: 25000 },
});
const rows = (res.data.rows ?? []) as Row[];
const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "");

const CLUSTERS: Array<[string, RegExp]> = [
  ["low season (it)", /bassa stagione|alta stagione|alta e bassa/],
  ["gastronomy (es)", /gastronom|mejor(es)? cocina/],
  ["food destinations (en)", /best food (destination|cit)|food travel|foodie destination/],
  ["christmas", /christmas|navidad|natale|natal/],
];

console.log(`GSC ${fmt(start)}..${fmt(end)} (${WINDOW}d)\n`);
for (const [name, pat] of CLUSTERS) {
  const hits = rows.filter((r) => pat.test(r.keys[1]));
  const impr = hits.reduce((a, r) => a + r.impressions, 0);
  const clicks = hits.reduce((a, r) => a + r.clicks, 0);
  console.log(`=== ${name} — ${impr} impr, ${clicks} clicks`);
  const byPage = new Map<string, { i: number; c: number; p: number }>();
  for (const h of hits) {
    const k = path(h.keys[0]);
    const e = byPage.get(k) ?? { i: 0, c: 0, p: 0 };
    e.p = (e.p * e.i + h.position * h.impressions) / (e.i + h.impressions || 1);
    e.i += h.impressions;
    e.c += h.clicks;
    byPage.set(k, e);
  }
  for (const [p, v] of [...byPage.entries()].sort((a, b) => b[1].i - a[1].i).slice(0, 6)) {
    console.log(`   ${String(v.i).padStart(5)} impr ${String(v.c).padStart(3)} clk pos ${v.p.toFixed(1).padStart(5)}  ${p}`);
  }
  console.log();
}

const PAGES = ["alta-e-bassa-stagione-2026", "best-food-destinations-2026", "cheapest-european-cities-for-food-2026"];
console.log("\nWHAT THE DEDICATED PAGES ACTUALLY RECEIVE");
console.log("-".repeat(78));
for (const slug of PAGES) {
  const hits = rows.filter((r) => r.keys[0].includes(slug));
  const impr = hits.reduce((a, r) => a + r.impressions, 0);
  const clicks = hits.reduce((a, r) => a + r.clicks, 0);
  console.log(`\n=== ${slug} — ${impr} impr, ${clicks} clicks, ${hits.length} queries`);
  if (!hits.length) {
    console.log("   (nothing — the page is invisible in search)");
    continue;
  }
  for (const h of [...hits].sort((a, b) => b.impressions - a.impressions).slice(0, 10)) {
    const locale = h.keys[0].match(/monkeytravel\.app\/(es|it|pt)\//)?.[1] ?? "en";
    console.log(`   ${String(h.impressions).padStart(5)} impr ${String(h.clicks).padStart(3)} clk pos ${h.position.toFixed(1).padStart(5)} [${locale}] ${h.keys[1]}`);
  }
}
