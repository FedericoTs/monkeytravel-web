/**
 * Tells search engines about changed pages, and lists the ones Google has not
 * indexed yet. Run by .github/workflows/seo-notify.yml.
 *
 *   node scripts/seo-notify.mjs deploy --from <sha> --to <sha> [--dry-run]
 *   node scripts/seo-notify.mjs check [--days 21] [--min-age 4] [--out report.md] [--count-file n.txt]
 *
 * deploy: blog posts changed between two commits go to IndexNow (Bing and the
 *   engines that share its index), then the sitemap and the touched locales'
 *   feeds are resubmitted to Search Console. Google has no API for "Request
 *   indexing" outside job and livestream pages, so the sitemap is the signal.
 * check: URL Inspection on recently changed sitemap URLs, read-only.
 *
 * Credentials: $GSC_SERVICE_ACCOUNT_KEY (the JSON itself), else
 * ~/.config/claude-seo/gsc-service-account.json. Node built-ins only.
 */
import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOST = "monkeytravel.app";
const ORIGIN = `https://${HOST}`;
const SITE = `sc-domain:${HOST}`;
const ROOT = join(import.meta.dirname, "..");
const INDEXNOW_KEY = readFileSync(join(ROOT, "lib/seo/indexnow.ts"), "utf8").match(/INDEXNOW_KEY = "([0-9a-f]+)"/)?.[1];
const SCOPE_WRITE = "https://www.googleapis.com/auth/webmasters";
const SCOPE_READ = "https://www.googleapis.com/auth/webmasters.readonly";
const INDEXED = new Set(["Submitted and indexed", "Indexed, not submitted in sitemap"]);

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

async function deploy() {
  const from = opt("from"), to = opt("to", "HEAD"), dryRun = flag("dry-run");
  if (!from) {
    log("No previous production deploy to compare with; nothing to send.");
    return;
  }
  const files = execFileSync("git", ["diff", "--name-only", "--diff-filter=AMR", from, to, "--", "content/blog"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean);
  const live = new Set((await sitemapEntries()).map((e) => e.loc));
  const changed = [...new Set(files.map(postUrl).filter(Boolean))];
  const urls = changed.filter((u) => live.has(u));
  log(`### Search engine notifications for ${to.slice(0, 8)}`);
  log(`${files.length} changed post files, ${urls.length} live URLs${changed.length > urls.length ? ` (${changed.length - urls.length} not in the sitemap, skipped)` : ""}.`);
  if (!urls.length) return;
  for (const u of urls) log(`- ${u}`);
  const feeds = [...new Set(urls.map((u) => u.match(/^https:\/\/[^/]+\/(es|it|pt)\//)?.[1] ?? ""))]
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

async function check() {
  const days = Number(opt("days", 21)), minAge = Number(opt("min-age", 4));
  const now = Date.now();
  const window = (await sitemapEntries())
    .filter((e) => e.lastmod)
    .map((e) => ({ ...e, t: Date.parse(e.lastmod) }))
    .filter((e) => e.t >= now - days * 864e5 && e.t <= now - minAge * 864e5)
    .sort((a, b) => b.t - a.t)
    .slice(0, 150);
  const token = await accessToken(SCOPE_READ);
  const missing = [], stale = [], failed = [];
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
    const crawled = s.lastCrawlTime ? Date.parse(s.lastCrawlTime) : 0;
    if (!INDEXED.has(s.coverageState)) missing.push({ ...e, why: s.coverageState ?? "unknown" });
    else if (crawled < e.t && e.t <= now - 7 * 864e5) stale.push({ ...e, why: `last crawled ${s.lastCrawlTime?.slice(0, 10) ?? "never"}` });
  }
  // Four at a time: each inspection takes a few seconds; the quota is 600 a minute.
  const queue = [...window];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) await inspect(queue.shift());
  }));
  // Google crawled these and chose not to index them: a request rarely changes
  // that, better content does. Everything else is waiting for a crawl.
  const passed = missing.filter((e) => /^Crawled|^Duplicate/.test(e.why));
  const waiting = missing.filter((e) => !passed.includes(e));
  const item = (e) => `- \`${e.loc}\` (${e.why}, updated ${e.lastmod.slice(0, 10)})`;
  const byDate = (a, b) => b.t - a.t;
  const lines = [
    `Checked ${window.length} pages updated between ${days} and ${minAge} days ago.`,
    "",
    "Paste each URL below into the search bar at the top of Search Console, press Enter, then click **Request indexing**. Search Console allows roughly 10 requests a day.",
    "",
    `**Waiting for Google (${waiting.length})**`,
    ...(waiting.length ? waiting.sort(byDate).map(item) : ["- none"]),
    "",
    `**Indexed, but not recrawled since an update over a week ago (${stale.length})**`,
    ...(stale.length ? stale.sort(byDate).slice(0, 20).map(item) : ["- none"]),
  ];
  if (stale.length > 20) lines.push(`- …and ${stale.length - 20} more`);
  if (passed.length) {
    lines.push("", `**Crawled, but Google chose not to index (${passed.length})**: improve the content rather than request indexing.`);
    lines.push(...passed.sort(byDate).slice(0, 20).map(item));
    if (passed.length > 20) lines.push(`- …and ${passed.length - 20} more`);
  }
  if (failed.length) lines.push("", `Could not check ${failed.length}: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ", …" : ""}`);
  for (const l of lines) log(l);
  if (window.length && failed.length === window.length) process.exitCode = 1;
  if (opt("out")) writeFileSync(opt("out"), `${lines.join("\n")}\n`);
  if (opt("count-file")) writeFileSync(opt("count-file"), String(waiting.length + stale.length));
}

if (mode === "deploy") await deploy();
else if (mode === "check") await check();
else {
  console.error("Usage: node scripts/seo-notify.mjs deploy|check …");
  process.exit(2);
}
