/**
 * Is a promising query cluster REAL demand, or low-intent impressions?
 *
 * A cluster can look like a big opportunity — thousands of impressions, a
 * top-10 position, almost no clicks — and still be worth nothing. That exact
 * shape already fooled us once on "best places to see fall foliage" (7,310
 * impressions at 0.14% CTR); the country split showed 431 impressions from a
 * market with 0% CTR and a single click from the target market. Impressions
 * without a matching audience are not demand.
 *
 * So before writing a post for a cluster, look at WHO is seeing it and on what
 * device, and compare its CTR to what the site actually achieves at the same
 * position. Sites' own month posts run 2.68-2.70% CTR; the site average is
 * 1.11%. A cluster far below that at a good position is suspect.
 *
 *   npx tsx scripts/gsc-cluster-verify.mts
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

async function q(dimensions: string[], rowLimit = 25000): Promise<Row[]> {
  const res = await webmasters.searchanalytics.query({
    siteUrl: SITE,
    requestBody: { startDate: fmt(start), endDate: fmt(end), dimensions, rowLimit },
  });
  return (res.data.rows ?? []) as Row[];
}

const CLUSTERS: Array<{ name: string; pat: RegExp }> = [
  { name: "Gastronomy ranking (es)", pat: /gastronom|mejores cocinas|mejor cocina/ },
  { name: "Cherry blossom", pat: /cherry blossom|sakura|hanami/ },
  { name: "Solo / alone travel", pat: /travel (solo|alone)|solo travel|viajar sol[ao]/ },
  { name: "World Cup itinerary", pat: /mundial|copa mundial|world cup/ },
  { name: "Low season (it)", pat: /bassa stagione|alta stagione/ },
  { name: "Fall foliage (known junk)", pat: /fall foliage|foliage/ },
  { name: "Monsoon / rainy season", pat: /monsoon|rainy season/ },
  { name: "Valentine / romantic", pat: /valentine|romantic (getaway|trip|weekend|destination)|honeymoon/ },
  { name: "Italian month (mete X)", pat: /^mete /},
];

const num = (n: number, w = 6) => String(Math.round(n)).padStart(w);
const pct = (n: number) => `${(n * 100).toFixed(2)}%`.padStart(7);

(async () => {
  const [byCountry, byDevice] = await Promise.all([
    q(["query", "country"]),
    q(["query", "device"]),
  ]);
  console.log(`GSC ${fmt(start)}..${fmt(end)} (${WINDOW}d)\n`);
  console.log("Site benchmarks: average CTR 1.11%; standalone month posts 2.68-2.70%.\n");

  for (const c of CLUSTERS) {
    const cr = byCountry.filter((r) => c.pat.test(r.keys[0]));
    if (!cr.length) continue;
    const impr = cr.reduce((a, r) => a + r.impressions, 0);
    const clicks = cr.reduce((a, r) => a + r.clicks, 0);
    const pos = impr ? cr.reduce((a, r) => a + r.position * r.impressions, 0) / impr : 0;
    console.log(`=== ${c.name} — ${impr} impr, ${clicks} clicks, ${pct(clicks / impr)} CTR, pos ${pos.toFixed(1)}`);

    const agg = new Map<string, { i: number; c: number }>();
    for (const r of cr) {
      const k = r.keys[1];
      const e = agg.get(k) ?? { i: 0, c: 0 };
      e.i += r.impressions;
      e.c += r.clicks;
      agg.set(k, e);
    }
    const top = [...agg.entries()].sort((a, b) => b[1].i - a[1].i).slice(0, 6);
    console.log(
      "    country: " +
        top.map(([k, v]) => `${k} ${num(v.i, 0)}/${v.c}${v.i >= 100 && v.c === 0 ? " !" : ""}`).join("   "),
    );

    const dr = byDevice.filter((r) => c.pat.test(r.keys[0]));
    const dagg = new Map<string, { i: number; c: number }>();
    for (const r of dr) {
      const k = r.keys[1];
      const e = dagg.get(k) ?? { i: 0, c: 0 };
      e.i += r.impressions;
      e.c += r.clicks;
      dagg.set(k, e);
    }
    console.log(
      "    device : " +
        [...dagg.entries()].sort((a, b) => b[1].i - a[1].i).map(([k, v]) => `${k} ${v.i}/${v.c}`).join("   "),
    );
    console.log();
  }
  console.log('"!" marks a country with >=100 impressions and ZERO clicks — the low-intent signature.');
})();
