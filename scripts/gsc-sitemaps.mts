/**
 * GSC sitemaps — what Google last read from us, and (optionally) a (re)submit.
 *
 * URL Inspection on 2026-09-12 returned "URL is unknown to Google" for URLs
 * that ARE in sitemap.xml and answer 200 with a self-canonical (/destinations,
 * /blog/seoul-5-day-itinerary, /blog/visa-free-destinations-by-passport, …).
 * The only way to see whether Google has processed the sitemap since those
 * were added is sitemaps.list: lastDownloaded, errors/warnings, and per-type
 * submitted vs indexed counts. The same call showed that only sitemap.xml had
 * ever been submitted: sitemap-trips.xml and sitemap-creators.xml (the UGC
 * pages, ~430 URLs) were unknown to Search Console. sitemaps.submit queues a
 * fetch; Google retired the anonymous ping endpoint in 2023, so this is the
 * supported way to tell it about a sitemap.
 *
 *   npx tsx scripts/gsc-sitemaps.mts                    # list (read-only scope)
 *   npx tsx scripts/gsc-sitemaps.mts --submit           # list, then submit the
 *                                                       # listed sitemaps + the
 *                                                       # three the app serves
 *   npx tsx scripts/gsc-sitemaps.mts --submit <url…>    # submit exactly these
 *
 * Auth: same service-account JSON + property discovery as gsc-index-inspect.mts.
 * --submit needs the SA to be a FULL/owner user and the non-readonly scope.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { google } from "googleapis";

const args = process.argv.slice(2);
const SUBMIT = args.includes("--submit");
const EXPLICIT = args.filter((a) => a.startsWith("http"));

/** Every sitemap the app serves (app/sitemap.ts + the two UGC routes). */
const SERVED = [
  "https://monkeytravel.app/sitemap.xml",
  "https://monkeytravel.app/sitemap-trips.xml",
  "https://monkeytravel.app/sitemap-creators.xml",
];

const PROJECT_ROOT = join(import.meta.dirname, "..");
function findKeyPath(): string | null {
  const fromEnv = process.env.GSC_SERVICE_ACCOUNT_KEY;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const shared = join(home, ".config", "claude-seo", "gsc-service-account.json");
  if (home && existsSync(shared)) return shared;
  const inRoot = readdirSync(PROJECT_ROOT).find(
    (f) => f.startsWith("gen-lang-client-") && f.endsWith(".json") && !f.includes("package")
  );
  return inRoot ? join(PROJECT_ROOT, inRoot) : null;
}

const KEY_PATH = findKeyPath();
if (!KEY_PATH) {
  console.error("✗ No GSC service-account JSON found");
  process.exit(1);
}
const keyJson = JSON.parse(readFileSync(KEY_PATH, "utf-8"));
const auth = new google.auth.JWT({
  email: keyJson.client_email,
  key: keyJson.private_key,
  scopes: [
    SUBMIT
      ? "https://www.googleapis.com/auth/webmasters"
      : "https://www.googleapis.com/auth/webmasters.readonly",
  ],
});
await auth.authorize();
const searchconsole = google.searchconsole({ version: "v1", auth });

const SITE_CANDIDATES = ["sc-domain:monkeytravel.app", "https://monkeytravel.app/"];
const sites = (await searchconsole.sites.list()).data.siteEntry ?? [];
const siteUrl =
  sites.find((s) => SITE_CANDIDATES.includes(s.siteUrl ?? ""))?.siteUrl ?? sites[0]?.siteUrl;
if (!siteUrl) {
  console.error("✗ SA has access to no property");
  process.exit(1);
}
console.log(`property: ${siteUrl}  (SA ${keyJson.client_email})\n`);

async function printList(): Promise<string[]> {
  const list = (await searchconsole.sitemaps.list({ siteUrl })).data.sitemap ?? [];
  if (list.length === 0) console.log("(no sitemaps known to Search Console for this property)");
  for (const s of list) {
    console.log(`${s.path}`);
    console.log(
      `  submitted ${s.lastSubmitted ?? "-"}   downloaded ${s.lastDownloaded ?? "-"}   ` +
        `pending=${s.isPending ?? false}   index=${s.isSitemapsIndex ?? false}   ` +
        `warnings=${s.warnings ?? 0}   errors=${s.errors ?? 0}`
    );
    for (const c of s.contents ?? []) {
      console.log(
        `  ${String(c.type).padEnd(8)} submitted=${c.submitted ?? "?"}  indexed=${c.indexed ?? "?"}`
      );
    }
  }
  return list.map((s) => s.path ?? "").filter(Boolean);
}

const known = await printList();

if (SUBMIT) {
  const targets = EXPLICIT.length ? EXPLICIT : [...new Set([...known, ...SERVED])];
  console.log("\n=== submitting ===");
  for (const feedpath of targets) {
    try {
      await searchconsole.sitemaps.submit({ siteUrl, feedpath });
      console.log(`  ✓ ${feedpath}${known.includes(feedpath) ? "" : "   (new to Search Console)"}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ✗ ${feedpath}: ${msg.slice(0, 160)}`);
    }
  }
  console.log("\n=== after ===");
  await printList();
}
