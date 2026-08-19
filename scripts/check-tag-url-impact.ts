/**
 * Report which /blog/tag/* URLs the normalization pass would retire.
 *
 * Run BEFORE `normalize-blog-tags.mts --write`, against the pre-normalization
 * content. Any currently-INDEXED slug (>= TAG_MIN_POSTS_FOR_INDEX posts, so in
 * the sitemap and eligible for search) that does not survive needs an entry in
 * lib/blog/retired-tags.ts, or its accumulated link equity lands on /blog
 * instead of the archive that replaced it.
 *
 * Thin slugs (< 5 posts) are already noindexed and excluded from the sitemap,
 * so they are reported as a count only.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tagsFor, LOCALES } from "../lib/blog/tag-taxonomy";
import { slugifyTag } from "../lib/blog/tags";

const DIR = "content/blog";
const MIN_FOR_INDEX = 5; // mirrors TAG_MIN_POSTS_FOR_INDEX

const slugs = readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));

function currentTags(path: string): string[] {
  const m = readFileSync(path, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return [];
  const fm = m[1];
  const tl = fm.match(/^tags:\s*(.*)$/m);
  if (!tl) return [];
  const inline = tl[1].trim();
  if (inline.startsWith("[")) {
    return inline.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  const after = fm.slice(fm.indexOf(tl[0]) + tl[0].length);
  const out: string[] = [];
  for (const line of after.split(/\r?\n/)) {
    const im = line.match(/^\s*-\s*(.+?)\s*$/);
    if (im) out.push(im[1].replace(/^["']|["']$/g, ""));
    else if (line.trim() !== "") break;
  }
  return out;
}

let retiredIndexed = 0;
for (const locale of LOCALES) {
  const before = new Map<string, number>();
  const after = new Set<string>();
  for (const slug of slugs) {
    const path = locale === "en" ? join(DIR, `${slug}.md`) : join(DIR, locale, `${slug}.md`);
    if (!existsSync(path)) continue;
    for (const t of currentTags(path)) {
      const s = slugifyTag(t);
      if (s) before.set(s, (before.get(s) ?? 0) + 1);
    }
    for (const t of tagsFor(slug, locale)) after.add(slugifyTag(t));
  }

  const indexedBefore = [...before.entries()].filter(([, n]) => n >= MIN_FOR_INDEX);
  const lostIndexed = indexedBefore.filter(([s]) => !after.has(s));
  const lostThin = [...before.keys()].filter((s) => !after.has(s) && (before.get(s) ?? 0) < MIN_FOR_INDEX);
  retiredIndexed += lostIndexed.length;

  console.log(`\n${locale}:`);
  console.log(`  indexed before: ${indexedBefore.length}   indexed after: ${[...after].length ? "(see normalize --dry)" : "?"}`);
  console.log(`  KEPT indexed:    ${indexedBefore.filter(([s]) => after.has(s)).map(([s, n]) => `${s}(${n})`).join(", ") || "-"}`);
  console.log(`  RETIRED indexed: ${lostIndexed.map(([s, n]) => `${s}(${n})`).join(", ") || "-"}   <-- need redirects`);
  console.log(`  retired thin (already noindexed, redirect to /blog): ${lostThin.length}`);
}

console.log(`\nTotal indexed slugs needing a redirect entry: ${retiredIndexed}`);
