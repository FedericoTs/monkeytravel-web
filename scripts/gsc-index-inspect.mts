/**
 * GSC URL Inspection — pull the REAL indexing verdict per URL.
 *
 * The other gsc-*.mts scripts pull Search Analytics (clicks/impressions), which
 * says nothing about the "Page indexing" report. This calls the URL Inspection
 * API (urlInspection.index.inspect) to get each URL's coverageState, verdict,
 * robots/indexing/fetch state, and Google-vs-user canonical — i.e. exactly the
 * categories GSC shows under "Why pages aren't indexed".
 *
 * Auth: same service-account JSON + property discovery as pull-gsc.mts.
 * URL Inspection needs the SA to be a FULL/owner user (Restricted → 403).
 *
 *   npx tsx scripts/gsc-index-inspect.mts               # default sample
 *   npx tsx scripts/gsc-index-inspect.mts <url> [url…]  # inspect specific URLs
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
  const inRoot = readdirSync(PROJECT_ROOT).find((f) => f.startsWith("gen-lang-client-") && f.endsWith(".json") && !f.includes("package"));
  return inRoot ? join(PROJECT_ROOT, inRoot) : null;
}

const KEY_PATH = findKeyPath();
if (!KEY_PATH) { console.error("✗ No GSC service-account JSON found"); process.exit(1); }
const keyJson = JSON.parse(readFileSync(KEY_PATH, "utf-8"));
const auth = new google.auth.JWT({
  email: keyJson.client_email,
  key: keyJson.private_key,
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
});
await auth.authorize();
const searchconsole = google.searchconsole({ version: "v1", auth });

const SITE_CANDIDATES = ["sc-domain:monkeytravel.app", "https://monkeytravel.app/"];
const sites = (await searchconsole.sites.list()).data.siteEntry ?? [];
const siteUrl = sites.find((s) => SITE_CANDIDATES.includes(s.siteUrl ?? ""))?.siteUrl ?? sites[0]?.siteUrl;
if (!siteUrl) { console.error("✗ SA has access to no property"); process.exit(1); }
console.log(`property: ${siteUrl}  (SA ${keyJson.client_email})\n`);

const B = "https://monkeytravel.app";
const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      B, `${B}/es`, `${B}/it`, `${B}/pt`,
      `${B}/free-ai-trip-planner`, `${B}/ai-itinerary-generator`, `${B}/budget-trip-planner`,
      `${B}/es/free-ai-trip-planner`, `${B}/it/ai-itinerary-generator`,
      `${B}/blog/3-day-paris-itinerary`, `${B}/es/blog/3-day-paris-itinerary`,
      `${B}/destinations/paris`, `${B}/pt/destinations/paris`,
      `${B}/passport/united-states`, `${B}/tools/packing-list`,
      `${B}/about/authors/federico-s`, `${B}/compare/wanderlog-alternative`, `${B}/explore`,
    ];

const tally: Record<string, number> = {};
const problems: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log("coverageState                              verdict  robots/index/fetch          canonical-match  url");
for (const u of urls) {
  try {
    const res = await searchconsole.urlInspection.index.inspect({ requestBody: { inspectionUrl: u, siteUrl } });
    const r = res.data.inspectionResult?.indexStatusResult ?? {};
    const cov = r.coverageState ?? "?";
    tally[cov] = (tally[cov] ?? 0) + 1;
    const canonMatch = r.googleCanonical && r.userCanonical
      ? (r.googleCanonical === r.userCanonical ? "match" : "DIFFERS")
      : "-";
    const flags = `${r.robotsTxtState ?? "?"}/${r.indexingState ?? "?"}/${r.pageFetchState ?? "?"}`;
    printf(cov, r.verdict ?? "?", flags, canonMatch, u.replace(B, "") || "/");
    if ((r.verdict && r.verdict !== "PASS") || canonMatch === "DIFFERS" || (cov && !/indexed/i.test(cov))) {
      problems.push(`${u.replace(B, "") || "/"}  →  ${cov} [${r.verdict}]${canonMatch === "DIFFERS" ? `  google→${r.googleCanonical}` : ""}`);
    }
    await sleep(400);
  } catch (e) {
    const msg = (e as { message?: string }).message ?? String(e);
    console.log(`  ERROR inspecting ${u.replace(B, "")}: ${msg.slice(0, 120)}`);
    if (/permission|403|forbidden/i.test(msg)) { console.error("\n  → SA lacks URL-Inspection permission (needs FULL/owner, not Restricted)."); break; }
  }
}

function printf(cov: string, verdict: string, flags: string, canon: string, url: string) {
  console.log(`${cov.padEnd(42)} ${verdict.padEnd(8)} ${flags.padEnd(27)} ${canon.padEnd(16)} ${url}`);
}

console.log("\n=== coverageState tally ===");
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
if (problems.length) {
  console.log("\n=== not-cleanly-indexed / canonical issues ===");
  for (const p of problems) console.log("  " + p);
} else {
  console.log("\n(no indexing/canonical problems in the sample)");
}
