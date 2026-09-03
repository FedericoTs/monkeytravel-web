/**
 * What should we publish for November onward — measured, not guessed.
 *
 * Three questions, three sections:
 *   1. THEMES — for a curated set of Nov-to-Mar travel themes, how much demand
 *      is there, is it growing, and do we already have a page for it?
 *   2. STRIKING DISTANCE — queries at position 4-20 with real impressions. We
 *      almost rank; a dedicated page is the cheapest way to win them.
 *   3. RISING, UNCLASSIFIED — the biggest impression gainers that match NO
 *      theme, so a trend nobody thought of still surfaces.
 *
 * Read-only. Compares the last 28 days to the 28 before, ending at GSC's
 * 2-day lag so the current window is not partial.
 *
 *   npx tsx scripts/gsc-theme-gaps.mts
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
const prevEnd = shift(start, -1);
const prevStart = shift(prevEnd, -(WINDOW - 1));

interface Row {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function q(dimensions: string[], s: Date, e: Date, rowLimit = 25000): Promise<Row[]> {
  const res = await webmasters.searchanalytics.query({
    siteUrl: SITE,
    requestBody: { startDate: fmt(s), endDate: fmt(e), dimensions, rowLimit },
  });
  return (res.data.rows ?? []) as Row[];
}

/**
 * Themes that matter from November onward. Patterns match the lowercased
 * query and include es/it/pt terms, because 3 of 4 shipped locales are not
 * English. `slugHints` are substrings of an EXISTING blog slug that would
 * mean the theme is already covered.
 */
const THEMES: Array<{ name: string; pat: RegExp; slugHints: string[] }> = [
  { name: "Christmas markets", pat: /christmas market|mercatini|mercado navide|mercados de natal|weihnachtsmarkt/, slugHints: ["christmas-market"] },
  { name: "Christmas / festive", pat: /christmas|navidad|natale|xmas|festive/, slugHints: ["christmas", "december"] },
  { name: "New Year / NYE", pat: /new year|\bnye\b|capodanno|nochevieja|ano novo|reveillon/, slugHints: ["new-year"] },
  { name: "Northern lights", pat: /northern light|aurora|boreal/, slugHints: ["northern-lights", "aurora"] },
  { name: "Ski / snow", pat: /\bski\b|skiing|snowboard|sciare|esqu[ií]|snow trip|\balps\b|dolomit/, slugHints: ["ski", "snow", "alps"] },
  { name: "Winter sun / escape", pat: /winter sun|escape winter|sol de invierno|winter escape/, slugHints: ["winter-sun", "winter-escape"] },
  { name: "Lunar / Chinese NY", pat: /chinese new year|lunar new year|capodanno cinese|nuevo chino/, slugHints: ["chinese-new-year", "lunar"] },
  { name: "Carnival", pat: /carnival|carnaval|carnevale|mardi gras/, slugHints: ["carnival", "carnaval"] },
  { name: "Valentine / romantic", pat: /valentine|san valent|romantic (getaway|trip|weekend|destination)|honeymoon|luna de miel/, slugHints: ["valentine", "romantic", "honeymoon"] },
  { name: "Easter / Semana Santa", pat: /easter|semana santa|pasqua|p[áa]scoa/, slugHints: ["easter", "semana-santa"] },
  { name: "Cherry blossom", pat: /cherry blossom|sakura|hanami|fioritura ciliegi/, slugHints: ["cherry-blossom"] },
  { name: "Thanksgiving", pat: /thanksgiving/, slugHints: ["thanksgiving"] },
  { name: "Black Friday travel", pat: /black friday|cyber monday/, slugHints: ["black-friday"] },
  { name: "Diwali", pat: /diwali|deepavali/, slugHints: ["diwali", "november"] },
  { name: "Ramadan / Eid", pat: /ramadan|ramad[áa]n|\beid\b/, slugHints: ["ramadan", "eid"] },
  { name: "Spring break", pat: /spring break/, slugHints: ["spring-break"] },
  { name: "Off-season / shoulder", pat: /off.?season|shoulder season|low season|cheapest time|bassa stagione|temporada baja/, slugHints: ["off-season", "shoulder", "cheapest-time"] },
  { name: "Cheap winter trips", pat: /cheap flight|cheap holiday|budget (winter|december|january)|vuelos baratos|voli economici/, slugHints: ["cheap", "budget"] },
];

const slugs = readdirSync(join(PROJECT_ROOT, "content", "blog"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""));

const covered = (hints: string[]) => slugs.filter((s) => hints.some((h) => s.includes(h)));

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "~" : s.padEnd(n));
const num = (n: number, w = 7) => String(Math.round(n)).padStart(w);

(async () => {
  const [cur, prev] = await Promise.all([
    q(["query"], start, end),
    q(["query"], prevStart, prevEnd),
  ]);
  const prevMap = new Map(prev.map((r) => [r.keys[0], r]));
  console.log(
    `GSC ${fmt(start)}..${fmt(end)} vs ${fmt(prevStart)}..${fmt(prevEnd)}  (${WINDOW}d, ${cur.length} queries)\n`,
  );

  // ---- 1. THEMES ----
  console.log("THEME                     impr  clicks    pos   vs prev   page?");
  console.log("-".repeat(78));
  const claimed = new Set<string>();
  const rows = THEMES.map((t) => {
    const hits = cur.filter((r) => t.pat.test(r.keys[0]));
    hits.forEach((h) => claimed.add(h.keys[0]));
    const impr = hits.reduce((a, r) => a + r.impressions, 0);
    const clicks = hits.reduce((a, r) => a + r.clicks, 0);
    const pos = impr ? hits.reduce((a, r) => a + r.position * r.impressions, 0) / impr : 0;
    const pImpr = prev
      .filter((r) => t.pat.test(r.keys[0]))
      .reduce((a, r) => a + r.impressions, 0);
    const delta = pImpr ? Math.round(((impr - pImpr) / pImpr) * 100) : null;
    return {
      t,
      impr,
      clicks,
      pos,
      delta,
      pages: covered(t.slugHints),
      top: [...hits].sort((a, b) => b.impressions - a.impressions).slice(0, 4),
    };
  }).sort((a, b) => b.impr - a.impr);

  for (const r of rows) {
    const d =
      r.delta === null
        ? r.impr
          ? "   new"
          : "     -"
        : `${r.delta >= 0 ? "+" : ""}${r.delta}%`.padStart(6);
    console.log(
      `${pad(r.t.name, 24)}${num(r.impr)}${num(r.clicks, 8)}${num(r.pos, 7)}   ${d}   ${
        r.pages.length ? `${r.pages.length} page(s)` : "** NONE **"
      }`,
    );
  }

  console.log("\nTop queries per UNCOVERED theme:");
  for (const r of rows.filter((x) => !x.pages.length && x.impr > 0)) {
    console.log(`  ${r.t.name}:`);
    for (const h of r.top) {
      console.log(`     ${num(h.impressions, 6)} impr  ${String(h.clicks).padStart(3)} clk  pos ${h.position.toFixed(1)}  ${h.keys[0]}`);
    }
  }

  // ---- 2. STRIKING DISTANCE ----
  console.log("\n\nSTRIKING DISTANCE — position 4-20, >=100 impressions");
  console.log("-".repeat(78));
  cur
    .filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= 100)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25)
    .forEach((r) =>
      console.log(`${num(r.impressions, 7)} impr ${String(r.clicks).padStart(4)} clk  pos ${r.position.toFixed(1).padStart(5)}  ${r.keys[0]}`),
    );

  // ---- 3. RISING, UNCLASSIFIED ----
  console.log("\n\nRISING & UNCLASSIFIED — biggest impression gain, matches no theme above");
  console.log("-".repeat(78));
  cur
    .filter((r) => !claimed.has(r.keys[0]) && r.impressions >= 60)
    .map((r) => ({ r, gain: r.impressions - (prevMap.get(r.keys[0])?.impressions ?? 0) }))
    .filter((x) => x.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 25)
    .forEach(({ r, gain }) =>
      console.log(`+${num(gain, 6)}  now ${num(r.impressions, 6)} impr ${String(r.clicks).padStart(4)} clk  pos ${r.position.toFixed(1)}  ${r.keys[0]}`),
    );
})();
