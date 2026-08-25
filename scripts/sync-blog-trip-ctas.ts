/**
 * Rewrite the in-body "Plan my trip" links in blog markdown so they carry the
 * article's trip, not just its city.
 *
 * The component CTAs on /blog/[slug] (hero, inline, sidebar, sticky) already
 * get this for free — page.tsx calls tripsNewHrefForPost. But ~100 markdown
 * files hand-write their own closing CTA as a literal
 * `[Plan My Paris Trip Free](/trips/new?destination=paris)`, and those sit at
 * the exact point where a reader has just finished the itinerary and is most
 * likely to act. This brings them to the same href.
 *
 * The derivation itself lives in lib/blog/trip-prefill.ts, where it is
 * typechecked and covered by tests. This script is only the I/O half — same
 * split as scripts/normalize-blog-tags.ts.
 *
 * Usage:
 *   npx tsx scripts/sync-blog-trip-ctas.ts --dry     # report only
 *   npx tsx scripts/sync-blog-trip-ctas.ts --write   # rewrite the links
 *
 * Safe to re-run: idempotent, and --write reports 0 written once files match.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT TOUCH
 *
 * 1. Link TEXT. It is per-locale prose written by a human ("Planificar mi viaje
 *    a París gratis"). Rewriting it from a template is how you end up with the
 *    ungrammatical headlines this repo has already had to revert once.
 *
 * 2. The `destination` param. Whatever slug is already in the link was chosen
 *    by whoever wrote the article — `rome` for the Italy itinerary, `santorini`
 *    for the Greek islands — and that judgement beats anything derived. The
 *    script only ADDS the params the link is missing. (This also keeps the
 *    script free of lib/destinations/data, which is `server-only` and cannot
 *    be imported under tsx at all.)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tripPrefillForPost } from "../lib/blog/trip-prefill";

const LOCALES = ["en", "es", "it", "pt"] as const;
const ROOT = join(process.cwd(), "content", "blog");

/** Any markdown link whose target is the wizard, with or without a query. */
const CTA_LINK = /\((\/trips\/new(?:\?[^)\s]*)?)\)/g;

/**
 * Rebuild one wizard href: keep the human-chosen destination, add the trip.
 * Param order is fixed so the output is stable across runs.
 */
function rebuild(existingHref: string, slug: string): string {
  const [, query = ""] = existingHref.split("?");
  const current = new URLSearchParams(query);
  const prefill = tripPrefillForPost(slug);

  const next = new URLSearchParams();
  const dest = current.get("destination");
  if (dest) next.set("destination", dest);

  // A route article opens the route builder; a `multi=1` already in the link
  // (the multi-city landing CTAs) is preserved either way.
  if (prefill.multi || current.get("multi") === "1") next.set("multi", "1");
  // Never a day span alongside multi-city — the wizard recomputes the end date
  // from per-city nights there.
  if (prefill.days && !next.has("multi")) next.set("days", String(prefill.days));
  if (prefill.budget) next.set("budget", prefill.budget);
  if (prefill.vibes?.length) next.set("vibes", prefill.vibes.join(","));

  // Carry through any tracking params the link already had.
  for (const [k, v] of current) {
    if (!next.has(k) && k.startsWith("utm_")) next.set(k, v);
  }

  const s = next.toString();
  return s ? `/trips/new?${s}` : "/trips/new";
}

function localeDir(locale: string): string {
  return locale === "en" ? ROOT : join(ROOT, locale);
}

function eachPost(fn: (locale: string, slug: string, path: string, raw: string) => void) {
  for (const locale of LOCALES) {
    const dir = localeDir(locale);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const path = join(dir, file);
      fn(locale, file.slice(0, -3), path, readFileSync(path, "utf8"));
    }
  }
}

const write = process.argv.includes("--write");
if (!write && !process.argv.includes("--dry")) {
  console.error("Pass --dry or --write.");
  process.exit(1);
}

let scanned = 0;
let changed = 0;
let already = 0;
const samples: string[] = [];

eachPost((locale, slug, path, raw) => {
  CTA_LINK.lastIndex = 0;
  if (!CTA_LINK.test(raw)) return;
  CTA_LINK.lastIndex = 0;
  scanned++;

  let firstBefore = "";
  let firstAfter = "";
  const next = raw.replace(CTA_LINK, (_m, href: string) => {
    const rebuilt = rebuild(href, slug);
    if (!firstBefore && rebuilt !== href) {
      firstBefore = href;
      firstAfter = rebuilt;
    }
    return `(${rebuilt})`;
  });

  if (next === raw) {
    already++;
    return;
  }
  if (samples.length < 8) {
    samples.push(`  ${locale}/${slug}\n      ${firstBefore}\n   -> ${firstAfter}`);
  }
  changed++;
  // Preserve the file's existing bytes apart from the match: rebuilding whole
  // blocks and replacing them is a silent no-op on CRLF files, which is a bug
  // class this repo has shipped before.
  if (write) writeFileSync(path, next, "utf8");
});

console.log(`files with a wizard link : ${scanned}`);
console.log(`already correct          : ${already}`);
console.log(`${write ? "rewritten                " : "would rewrite            "}: ${changed}`);
if (samples.length) {
  console.log("\nsamples:");
  console.log(samples.join("\n"));
}

// Re-read and assert what actually landed, rather than trusting the write call.
if (write && changed > 0) {
  let mismatched = 0;
  eachPost((locale, slug, _path, raw) => {
    for (const m of raw.matchAll(CTA_LINK)) {
      const expected = rebuild(m[1], slug);
      if (m[1] !== expected) {
        mismatched++;
        console.error(`  MISMATCH ${locale}/${slug}: ${m[1]} != ${expected}`);
      }
    }
  });
  console.log(`\nverified on disk, mismatches: ${mismatched}`);
  if (mismatched > 0) process.exit(1);
}
