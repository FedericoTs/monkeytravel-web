/**
 * What do people actually ask that lands on our month posts?
 *
 * GSC cannot size demand for a topic we have no page for — zero impressions
 * means invisible, not unwanted. But it CAN show sub-topics leaking into a
 * page that only half-answers them. If "christmas markets" queries are already
 * landing on where-to-go-in-december, that is evidence of latent demand for a
 * dedicated post, measured rather than assumed.
 *
 *   npx tsx scripts/gsc-month-post-queries.mts
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
  requestBody: {
    startDate: fmt(start),
    endDate: fmt(end),
    dimensions: ["page", "query"],
    rowLimit: 25000,
  },
});
const rows = (res.data.rows ?? []) as Row[];

const TARGETS = [
  "where-to-go-in-october",
  "where-to-go-in-november",
  "where-to-go-in-december",
  "2026-travel-calendar",
];

console.log(`GSC ${fmt(start)}..${fmt(end)} (${WINDOW}d), ${rows.length} page+query rows\n`);

for (const t of TARGETS) {
  const hits = rows.filter((r) => r.keys[0].includes(t));
  if (!hits.length) {
    console.log(`=== ${t}: no rows\n`);
    continue;
  }
  const impr = hits.reduce((a, r) => a + r.impressions, 0);
  const clicks = hits.reduce((a, r) => a + r.clicks, 0);
  console.log(`=== ${t} — ${impr} impr, ${clicks} clicks, ${((clicks / impr) * 100).toFixed(2)}% CTR, ${hits.length} queries`);
  for (const h of [...hits].sort((a, b) => b.impressions - a.impressions).slice(0, 12)) {
    const q = h.keys[1];
    const locale = h.keys[0].match(/monkeytravel\.app\/(es|it|pt)\//)?.[1] ?? "en";
    console.log(`   ${String(h.impressions).padStart(5)} impr ${String(h.clicks).padStart(3)} clk pos ${h.position.toFixed(1).padStart(5)} [${locale}] ${q}`);
  }
  console.log();
}

// Sub-topic leak: do themed queries reach ANY page, and which?
const SUBTOPICS: Array<[string, RegExp]> = [
  ["christmas market", /christmas market|mercatini|mercado navide/],
  ["christmas (any)", /christmas|navidad|natale/],
  ["new year", /new year|capodanno|nochevieja|reveillon/],
  ["northern lights", /northern light|aurora|boreal/],
  ["ski/snow", /\bski\b|skiing|neve|snow/],
  ["winter sun", /winter sun|winter escape|sol de invierno/],
  ["warm in winter", /warm.*(december|january|february)|hot.*(december|january)/],
];
console.log("\nSUB-TOPIC LEAK — themed queries and the page they land on");
console.log("-".repeat(78));
for (const [name, pat] of SUBTOPICS) {
  const hits = rows.filter((r) => pat.test(r.keys[1]));
  const impr = hits.reduce((a, r) => a + r.impressions, 0);
  if (!impr) {
    console.log(`${name.padEnd(18)} — no impressions at all (we are invisible for this)`);
    continue;
  }
  const clicks = hits.reduce((a, r) => a + r.clicks, 0);
  const byPage = new Map<string, number>();
  for (const h of hits) {
    const p = h.keys[0].replace(/^https?:\/\/[^/]+/, "");
    byPage.set(p, (byPage.get(p) ?? 0) + h.impressions);
  }
  const top = [...byPage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`${name.padEnd(18)} ${String(impr).padStart(5)} impr ${String(clicks).padStart(3)} clk -> ${top.map(([p, i]) => `${p} (${i})`).join(", ")}`);
}
