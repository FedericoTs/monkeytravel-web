/**
 * Every outbound citation in the blog, checked for a pulse.
 *
 * WHY
 * ---
 * A prior content audit found 36 dead or fabricated citations across the blog,
 * and 72 of 88 posts making percentage claims with 2 citing anything. A dead
 * citation is worse than none: it looks like sourcing while proving nothing,
 * and Google's spam policy on unoriginal, poorly-sourced content treats it as
 * exactly that.
 *
 * This is the cheap recurring check that keeps that from creeping back.
 *
 * HEAD first, falling back to a ranged GET, because a fair number of tourism
 * and government sites reject HEAD outright (405) while serving GET fine —
 * counting those as broken would send someone chasing links that work.
 *
 *   node scripts/check-blog-links.mjs                 # every post
 *   node scripts/check-blog-links.mjs where-to-go     # only matching posts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "content", "blog");
const filter = process.argv[2] ?? "";
const TIMEOUT_MS = 15000;
const CONCURRENCY = 8;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".md"))
  .filter((f) => (filter ? f.includes(filter) : true));

/** Collect every external link, remembering which post and line it came from. */
const links = new Map(); // url -> [{ file, line, label }]
for (const file of files) {
  const body = readFileSync(join(DIR, file), "utf8");
  body.split(/\r?\n/).forEach((text, i) => {
    for (const m of text.matchAll(/\[([^\]]{1,80})\]\((https?:\/\/[^)\s]+)\)/g)) {
      const [, label, url] = m;
      if (url.includes("monkeytravel")) continue; // internal, covered elsewhere
      if (!links.has(url)) links.set(url, []);
      links.get(url).push({ file, line: i + 1, label });
    }
  });
}

console.log("");
console.log(`Checking ${links.size} distinct external citation(s) across ${files.length} post(s)`);
if (links.size === 0) {
  console.log("");
  console.log("  No external citations found in the selected posts.");
  console.log("  For a post making factual claims that is itself the finding:");
  console.log("  unsourced numbers read as invented, whoever wrote them.");
  console.log("");
  process.exit(0);
}

async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": UA },
    });
    // Plenty of government and tourism sites refuse HEAD but serve GET.
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "user-agent": UA, range: "bytes=0-2048" },
      });
    }
    return { status: res.status, finalUrl: res.url };
  } catch (err) {
    return { status: 0, error: err.name === "AbortError" ? "timeout" : err.message.slice(0, 60) };
  } finally {
    clearTimeout(timer);
  }
}

const entries = [...links.entries()];
const results = [];
for (let i = 0; i < entries.length; i += CONCURRENCY) {
  const batch = entries.slice(i, i + CONCURRENCY);
  const settled = await Promise.all(
    batch.map(async ([url, uses]) => ({ url, uses, ...(await probe(url)) }))
  );
  results.push(...settled);
  process.stdout.write(`  …${Math.min(i + CONCURRENCY, entries.length)}/${entries.length}\r`);
}

const dead = results.filter((r) => r.status === 0 || r.status >= 400);
const redirected = results.filter(
  (r) => r.status >= 200 && r.status < 400 && r.finalUrl && r.finalUrl.replace(/\/$/, "") !== r.url.replace(/\/$/, "")
);
const ok = results.length - dead.length;

console.log(`  ${" ".repeat(30)}`);
console.log("");
console.log(`=== ${dead.length} broken, ${redirected.length} redirected, ${ok} healthy ===`);

if (dead.length) {
  console.log("");
  console.log("BROKEN — a dead citation is worse than no citation:");
  for (const r of dead.sort((a, b) => b.uses.length - a.uses.length)) {
    console.log(`  ${String(r.status || r.error).padStart(7)}  ${r.url}`);
    for (const u of r.uses) console.log(`           ${u.file}:${u.line}  “${u.label}”`);
  }
}

if (redirected.length) {
  console.log("");
  console.log("REDIRECTED — still resolves, but the canonical target moved:");
  for (const r of redirected.slice(0, 20)) {
    console.log(`  ${r.url}`);
    console.log(`      → ${r.finalUrl}   (${r.uses[0].file})`);
  }
}

console.log("");
process.exit(dead.length ? 2 : 0);
