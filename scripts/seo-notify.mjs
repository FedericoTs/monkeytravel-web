/**
 * Tells search engines about changed pages, and lists the ones Google has not
 * indexed yet. Run by .github/workflows/seo-notify.yml.
 *
 *   node scripts/seo-notify.mjs deploy --from <sha> --to <sha> [--dry-run]
 *   node scripts/seo-notify.mjs check [--days 21] [--min-age 4] [--limit 150] [--state s.json] [--out report.md] [--count-file n.txt] [--dry-run]
 *
 * deploy: blog posts changed between two commits, and pages whose title,
 *   description or copy changed in messages/ (MESSAGE_PAGES), go to IndexNow
 *   (Bing and the engines that share its index), then the sitemap and the
 *   touched locales' feeds are resubmitted to Search Console. Google has no API
 *   for "Request indexing" outside job and livestream pages, so the sitemap is
 *   the signal.
 * check: URL Inspection on recently changed sitemap URLs, read-only, at most
 *   --limit a run. --state keeps what earlier runs found, so pages not yet
 *   inspected since their update go first and the report covers them all.
 *
 * Credentials: $GSC_SERVICE_ACCOUNT_KEY (the JSON itself), else
 * ~/.config/claude-seo/gsc-service-account.json. Node built-ins only.
 */
import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "monkeytravel.app";
const ORIGIN = `https://${HOST}`;
const SITE = `sc-domain:${HOST}`;
const ROOT = join(import.meta.dirname, "..");
const INDEXNOW_KEY = readFileSync(join(ROOT, "lib/seo/indexnow.ts"), "utf8").match(/INDEXNOW_KEY = "([0-9a-f]+)"/)?.[1];
const SCOPE_WRITE = "https://www.googleapis.com/auth/webmasters";
const SCOPE_READ = "https://www.googleapis.com/auth/webmasters.readonly";
const INDEXED = new Set(["Submitted and indexed", "Indexed, not submitted in sitemap"]);
const DAY = 864e5;

const [mode, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
};

function log(line = "") {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function serviceAccount() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_KEY;
  if (raw) return JSON.parse(raw);
  const file = join(homedir(), ".config", "claude-seo", "gsc-service-account.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  throw new Error("No Search Console key: set GSC_SERVICE_ACCOUNT_KEY.");
}

const b64url = (data) => Buffer.from(data).toString("base64url");

async function accessToken(scope) {
  const key = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: key.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Google token request failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function sitemapEntries() {
  const res = await fetch(`${ORIGIN}/sitemap.xml`, { headers: { "user-agent": "monkeytravel-seo-notify" } });
  if (!res.ok) throw new Error(`sitemap.xml: HTTP ${res.status}`);
  const xml = await res.text();
  return (xml.match(/<url\b[\s\S]*?<\/url>/g) ?? []).map((block) => ({
    loc: block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/)?.[1].replace(/&amp;/g, "&"),
    lastmod: block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/)?.[1],
  })).filter((e) => e.loc);
}

/** content/blog/<slug>.md → /blog/<slug>; content/blog/<locale>/<slug>.md → /<locale>/blog/<slug>. */
function postUrl(file) {
  const m = file.match(/^content\/blog\/(?:(es|it|pt)\/)?([^/]+)\.md$/);
  return m ? `${ORIGIN}${m[1] ? `/${m[1]}` : ""}/blog/${m[2]}` : null;
}

// The pages whose title, description or copy a messages file holds, by the
// changed key. "*" is one URL segment, matched against the live sitemap, so a
// page a locale does not have sends nothing. Strings that every page of a kind
// shows (buttons, headings, labels) map to nothing: a wording tweak there would
// resend every such page.
const only = (path) => () => [path];
const MESSAGE_PAGES = {
  "blog.json": ([group, key = "*"]) => {
    if (group === "posts") return [`/blog/${key}`];
    if (group === "meta") return ["/blog"];
    if (group === "tag" && /^(meta|\*$)/.test(key)) return ["/blog/tag/*"];
    return [];
  },
  "destinations.json": ([group, key = "*", sub = "*"]) => {
    if (group === "meta") return key.endsWith("Index") ? ["/destinations"] : ["/destinations/*"];
    if (group === "style" && key === "content") return [`/destinations/style/${sub}`];
    if (group === "style" && /^(meta|\*$)/.test(key)) return ["/destinations/style/*"];
    // The style pages put the tag's label in their title.
    if (group === "tags") return [`/destinations/style/${key}`];
    return [];
  },
  "landing.json": only(""),
  "aiItineraryGenerator.json": only("/ai-itinerary-generator"),
  "backpacker.json": only("/backpacker"),
  "budgetTripPlanner.json": only("/budget-trip-planner"),
  "familyTripPlanner.json": only("/family-trip-planner"),
  "freeTripPlanner.json": only("/free-ai-trip-planner"),
  "groupTripPlanner.json": only("/group-trip-planner"),
  "multiCityTripPlanner.json": only("/multi-city-trip-planner"),
  "soloTripPlanner.json": only("/solo-trip-planner"),
  "weekendTripPlanner.json": only("/weekend-trip-planner"),
};

/** Key paths whose values differ between two parsed JSON documents, down to the leaves. */
export function changedKeys(before, after, path = []) {
  const branch = (v) => v === undefined || (v !== null && typeof v === "object");
  if (branch(before) && branch(after) && Array.isArray(before ?? {}) === Array.isArray(after ?? {})) {
    const a = before ?? {}, b = after ?? {};
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => changedKeys(a[k], b[k], [...path, k]));
  }
  return before === after ? [] : [path];
}

/** The live URLs a change to messages/<locale>/<file> moves, given its JSON before and after. */
export function messageUrls(file, before, after, live) {
  const [, locale, name] = file.match(/^messages\/(en|es|it|pt)\/([^/]+)$/) ?? [];
  if (!name || !Object.hasOwn(MESSAGE_PAGES, name)) return [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = esc(`${ORIGIN}${locale === "en" ? "" : `/${locale}`}`);
  const patterns = [...new Set(changedKeys(before, after).flatMap(MESSAGE_PAGES[name]))]
    .map((p) => new RegExp(`^${base}${p.split("*").map(esc).join("[^/]+")}$`));
  return live.filter((u) => patterns.some((re) => re.test(u)));
}

/** A file's parsed JSON at a commit; undefined where it does not exist. */
function jsonAt(sha, file) {
  try {
    return JSON.parse(execFileSync("git", ["show", `${sha}:${file}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 }));
  } catch {
    return undefined;
  }
}

async function deploy() {
  const from = opt("from"), to = opt("to", "HEAD"), dryRun = flag("dry-run");
  if (!from) {
    log("No previous production deploy to compare with; nothing to send.");
    return;
  }
  const changedFiles = (dir) => execFileSync("git", ["diff", "--name-only", "--diff-filter=AMR", from, to, "--", dir], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean);
  const files = changedFiles("content/blog");
  const messages = changedFiles("messages");
  const sitemap = (await sitemapEntries()).map((e) => e.loc);
  const live = new Set(sitemap);
  const changed = [...new Set([
    ...files.map(postUrl).filter(Boolean),
    ...messages.flatMap((f) => messageUrls(f, jsonAt(from, f), jsonAt(to, f), sitemap)),
  ])];
  const urls = changed.filter((u) => live.has(u));
  log(`### Search engine notifications for ${to.slice(0, 8)}`);
  log(`${files.length} changed post files, ${messages.length} changed message files, ${urls.length} live URLs${changed.length > urls.length ? ` (${changed.length - urls.length} not in the sitemap, skipped)` : ""}.`);
  if (!urls.length) return;
  for (const u of urls) log(`- ${u}`);
  // The feeds list blog posts only; other pages have the sitemap.
  const feeds = [...new Set(urls.filter((u) => /^\/((es|it|pt)\/)?blog(\/|$)/.test(new URL(u).pathname))
    .map((u) => u.match(/^https:\/\/[^/]+\/(es|it|pt)\//)?.[1] ?? ""))]
    .map((l) => `${ORIGIN}${l ? `/${l}` : ""}/feed.xml`);
  const sitemaps = [`${ORIGIN}/sitemap.xml`, ...feeds];
  if (dryRun) {
    log(`Dry run: would send ${urls.length} URLs to IndexNow and resubmit ${sitemaps.join(", ")}.`);
    return;
  }
  const ix = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: INDEXNOW_KEY, keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`, urlList: urls }),
  });
  log(`IndexNow: HTTP ${ix.status}${ix.ok ? " (accepted)" : ""}`);
  const token = await accessToken(SCOPE_WRITE);
  let failed = !ix.ok;
  for (const sm of sitemaps) {
    const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/sitemaps/${encodeURIComponent(sm)}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
    });
    log(`Search Console sitemap ${sm}: HTTP ${res.status}`);
    failed ||= !res.ok;
  }
  if (failed) process.exitCode = 1;
}

/** What the last inspection of a page found, if it happened after the page's latest update. */
function verdict(page, seen, now) {
  if (seen?.lastmod !== page.lastmod) return "unchecked";
  if (!INDEXED.has(seen.coverage)) return /^Crawled|^Duplicate/.test(seen.coverage ?? "") ? "passed" : "waiting";
  if ((seen.crawled ? Date.parse(seen.crawled) : 0) >= page.t) return "done";
  return page.t <= now - 7 * DAY ? "stale" : "recent";
}

/**
 * The pages to inspect this run: first those not inspected since their update,
 * oldest first because they leave the window soonest, then earlier findings
 * that may have moved, least recently checked first. A page indexed and
 * crawled after its update is done and costs no more quota.
 */
export function pickForInspection(pages, state, limit, now = Date.now()) {
  const byAge = (a, b) => a.t - b.t || (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0);
  const unchecked = pages.filter((p) => verdict(p, state[p.loc], now) === "unchecked").sort(byAge);
  const recheck = pages.filter((p) => !["unchecked", "done"].includes(verdict(p, state[p.loc], now)))
    .sort((a, b) => state[a.loc].checked.localeCompare(state[b.loc].checked) || byAge(a, b));
  return [...unchecked, ...recheck].slice(0, limit);
}

/** The issue body for every page in the window, and how many pages still need a look. */
export function report(pages, state, { now, days, minAge, inspected, failed = [] }) {
  const by = { waiting: [], stale: [], passed: [], unchecked: [] };
  for (const p of pages) by[verdict(p, state[p.loc], now)]?.push(p);
  const { waiting, stale, passed, unchecked } = by;
  const coverage = (s) => s.coverage ?? "unknown";
  const crawl = (s) => `last crawled ${s.crawled?.slice(0, 10) ?? "never"}`;
  const item = (why) => (p) => `- \`${p.loc}\` (${why(state[p.loc])}, updated ${p.lastmod.slice(0, 10)}, checked ${state[p.loc].checked.slice(0, 10)})`;
  const lines = [
    `${pages.length} pages were updated between ${days} and ${minAge} days ago; this run inspected ${inspected}. ${unchecked.length ? `The next run starts with the ${unchecked.length} not inspected since their update.` : "Every one has been inspected since its update."}`,
    "",
    "Paste each URL below into the search bar at the top of Search Console, press Enter, then click **Request indexing**. Search Console allows roughly 10 requests a day.",
    "",
    `**Waiting for Google (${waiting.length})**`,
    ...(waiting.length ? waiting.slice(0, 100).map(item(coverage)) : ["- none"]),
    // The window can hold more pages than an issue body has room for.
    ...(waiting.length > 100 ? [`- …and ${waiting.length - 100} more`] : []),
    "",
    `**Indexed, but not recrawled since an update over a week ago (${stale.length})**`,
    ...(stale.length ? stale.slice(0, 20).map(item(crawl)) : ["- none"]),
  ];
  if (stale.length > 20) lines.push(`- …and ${stale.length - 20} more`);
  // Google crawled these and chose not to index them: a request rarely changes
  // that, better content does. Everything else is waiting for a crawl.
  if (passed.length) {
    lines.push("", `**Crawled, but Google chose not to index (${passed.length})**: improve the content rather than request indexing.`);
    lines.push(...passed.slice(0, 20).map(item(coverage)));
    if (passed.length > 20) lines.push(`- …and ${passed.length - 20} more`);
  }
  if (failed.length) lines.push("", `Could not check ${failed.length}: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ", …" : ""}`);
  // Unchecked pages keep the issue open, so closing it still means every
  // updated page was looked at.
  return { lines, open: waiting.length + stale.length + unchecked.length };
}

/** Earlier inspections by URL. A missing or unreadable file means none yet. */
function readState(path) {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return Object.fromEntries(Object.entries(raw).filter(([, s]) => typeof s?.lastmod === "string" && typeof s?.checked === "string"));
  } catch {
    return {};
  }
}

async function check() {
  const days = Number(opt("days", 21)), minAge = Number(opt("min-age", 4)), limit = Number(opt("limit", 150));
  const statePath = opt("state");
  const now = Date.now();
  const pages = (await sitemapEntries())
    .filter((e) => e.lastmod)
    .map((e) => ({ ...e, t: Date.parse(e.lastmod) }))
    .filter((e) => e.t >= now - days * DAY && e.t <= now - minAge * DAY)
    .sort((a, b) => b.t - a.t);
  const state = statePath ? readState(statePath) : {};
  if (statePath) log(`Earlier inspections on file: ${Object.keys(state).length}.`);
  const batch = pickForInspection(pages, state, limit, now);
  if (flag("dry-run")) {
    const perDay = {};
    for (const p of batch) perDay[p.lastmod.slice(0, 10)] = (perDay[p.lastmod.slice(0, 10)] ?? 0) + 1;
    const fresh = pages.filter((p) => verdict(p, state[p.loc], now) === "unchecked").length;
    log(`Dry run: ${pages.length} pages updated between ${days} and ${minAge} days ago, ${fresh} not inspected since their update.`);
    log(`Would inspect ${batch.length}, by update day: ${Object.entries(perDay).map(([d, n]) => `${d} ×${n}`).join(", ") || "none"}.`);
    return;
  }
  const token = batch.length ? await accessToken(SCOPE_READ) : null;
  const failed = [];
  async function inspect(e) {
    let res;
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ inspectionUrl: e.loc, siteUrl: SITE }),
      });
      if (res.ok || (res.status < 500 && res.status !== 429)) break;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
    if (!res.ok) return void failed.push(`${e.loc} (HTTP ${res.status})`);
    const s = (await res.json()).inspectionResult?.indexStatusResult ?? {};
    state[e.loc] = { lastmod: e.lastmod, checked: new Date().toISOString(), coverage: s.coverageState ?? null, crawled: s.lastCrawlTime ?? null };
  }
  // Four at a time: each inspection takes a few seconds; the quota is 600 a minute.
  const queue = [...batch];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) await inspect(queue.shift());
  }));
  const { lines, open } = report(pages, state, { now, days, minAge, inspected: batch.length - failed.length, failed });
  for (const l of lines) log(l);
  if (batch.length && failed.length === batch.length) process.exitCode = 1;
  if (statePath) writeFileSync(statePath, JSON.stringify(Object.fromEntries(pages.filter((p) => state[p.loc]?.lastmod === p.lastmod).map((p) => [p.loc, state[p.loc]]))));
  if (opt("out")) writeFileSync(opt("out"), `${lines.join("\n")}\n`);
  if (opt("count-file")) writeFileSync(opt("count-file"), String(open));
}

// Run only as a command, so the tests can import the functions above.
const direct = (() => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (direct && mode === "deploy") await deploy();
else if (direct && mode === "check") await check();
else if (direct) {
  console.error("Usage: node scripts/seo-notify.mjs deploy|check …");
  process.exit(2);
}
