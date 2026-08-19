/**
 * Report which /blog/tag/* URLs the tag normalization retires.
 *
 * Any INDEXED slug (>= TAG_MIN_POSTS_FOR_INDEX posts, so in the sitemap and
 * eligible to rank) that does not survive needs an entry in
 * lib/blog/retired-tags.ts, or its accumulated link equity lands on /blog
 * instead of the archive that replaced it. Thin slugs (< 5 posts) are already
 * noindexed and excluded from the sitemap, so they are a count only.
 *
 * Usage:
 *   # before the pass has run, comparing working tree against the taxonomy
 *   npx tsx scripts/check-tag-url-impact.ts
 *
 *   # after the pass has run, comparing against the content as it was at <ref>
 *   git archive <ref> content/blog | tar -x -C /tmp/oldblog
 *   npx tsx scripts/check-tag-url-impact.ts --old /tmp/oldblog/content/blog
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tagsFor, LOCALES } from "../lib/blog/tag-taxonomy";
import { slugifyTag } from "../lib/blog/tags";

const DIR = "content/blog";
const MIN_FOR_INDEX = 5; // mirrors TAG_MIN_POSTS_FOR_INDEX

/**
 * Where to read the BEFORE state from. Defaults to the working tree, which is
 * only meaningful while the pass is still pending; pass --old to point at an
 * extracted copy of the pre-pass content once it has landed.
 */
const oldFlag = process.argv.indexOf("--old");
const OLD_DIR = oldFlag !== -1 ? process.argv[oldFlag + 1] : DIR;

const slugs = readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));

/**
 * The tags field as ONE block: the key line plus its indented list items.
 *
 * The first version of this used `/^tags:\s*(.*)$/m` and then walked the lines
 * after the match. `\s*` matches newlines, so on a YAML block list it consumed
 * "tags:\n  - first-item" as the match and the walk started at the SECOND item
 * — hiding one tag on every block-format post. That under-reported the archives
 * this pass would retire by two, both of which were indexed. Match the block.
 */
const TAG_BLOCK = /^tags:[^\r\n]*(?:\r?\n[ \t]*-[^\r\n]*)*/m;

function currentTags(path: string): string[] {
  const fm = readFileSync(path, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const block = fm.match(TAG_BLOCK)?.[0];
  if (!block) return [];

  const inline = block.slice("tags:".length).trim();
  if (inline.startsWith("[")) {
    return inline
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return block
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.replace(/^\s*-\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

let retiredIndexed = 0;
for (const locale of LOCALES) {
  const before = new Map<string, number>();
  const after = new Set<string>();
  for (const slug of slugs) {
    const path = locale === "en" ? join(OLD_DIR, `${slug}.md`) : join(OLD_DIR, locale, `${slug}.md`);
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
  console.log(`  indexed before: ${indexedBefore.length}`);
  console.log(`  KEPT indexed:    ${indexedBefore.filter(([s]) => after.has(s)).map(([s, n]) => `${s}(${n})`).join(", ") || "-"}`);
  console.log(`  RETIRED indexed: ${lostIndexed.map(([s, n]) => `${s}(${n})`).join(", ") || "-"}   <-- need redirects`);
  console.log(`  retired thin (already noindexed, redirect to /blog): ${lostThin.length}`);
}

console.log(`\nTotal indexed slugs needing a redirect entry: ${retiredIndexed}`);
