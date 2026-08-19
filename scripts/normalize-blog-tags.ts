/**
 * Write the controlled tag vocabulary into blog frontmatter.
 *
 * The taxonomy itself — the concepts, their per-locale wording, and the
 * per-post assignment — lives in lib/blog/tag-taxonomy.ts, where it is
 * typechecked and testable. This script is only the I/O half: it renders that
 * definition into each markdown file's `tags:` field and verifies the result.
 *
 * Usage:
 *   npx tsx scripts/normalize-blog-tags.mts --dry    # report only
 *   npx tsx scripts/normalize-blog-tags.mts --write  # rewrite frontmatter
 *
 * Safe to re-run: it is idempotent, and --write reports 0 written once the
 * files already match.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LOCALES, tagsFor } from "../lib/blog/tag-taxonomy";
import { slugifyTag } from "../lib/blog/tags";

const DIR = "content/blog";

/**
 * The frontmatter `tags:` field: the key line, plus any indented "- item" lines
 * that follow it when the file uses YAML block form.
 *
 * Matched with a regex over the raw text rather than by reconstructing the
 * block from split lines. An earlier version did the latter, rejoining with
 * "\n" — which silently failed on every CRLF file, because the rebuilt block
 * never matched the original and String.replace returned the input untouched.
 * The script then wrote byte-identical content while reporting success, so 77
 * of 336 files were quietly skipped. Never reconstruct what you can match.
 */
const TAG_BLOCK = /^tags:[^\r\n]*(?:\r?\n[ \t]*-[^\r\n]*)*/m;

/** Replace the frontmatter `tags:` block, leaving every other byte untouched. */
function rewrite(path: string, newTags: string[]): "written" | "unchanged" {
  const raw = readFileSync(path, "utf8");
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) throw new Error(`no frontmatter: ${path}`);
  const fm = fmMatch[1];
  if (!TAG_BLOCK.test(fm)) throw new Error(`no tags field: ${path}`);

  const rendered = `tags: [${newTags.map((t) => JSON.stringify(t)).join(", ")}]`;
  const nextFm = fm.replace(TAG_BLOCK, rendered);
  if (nextFm === fm) return "unchanged";

  // Splice by index so only the frontmatter region can possibly be touched.
  const at = raw.indexOf(fm);
  writeFileSync(path, raw.slice(0, at) + nextFm + raw.slice(at + fm.length));
  return "written";
}

/** Read the tags back out of a file, to verify what was actually persisted. */
function readTags(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const block = fm.match(TAG_BLOCK)?.[0] ?? "";
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

// ---------------------------------------------------------------------------

const write = process.argv.includes("--write");
const slugs = readdirSync(DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.replace(/\.md$/, ""));

const pathFor = (slug: string, locale: string) =>
  locale === "en" ? join(DIR, `${slug}.md`) : join(DIR, locale, `${slug}.md`);

let written = 0;
let unchanged = 0;
let absent = 0;
for (const locale of LOCALES) {
  for (const slug of slugs) {
    const path = pathFor(slug, locale);
    if (!existsSync(path)) {
      absent++;
      continue;
    }
    const tags = tagsFor(slug, locale);
    if (!write) {
      unchanged++;
      continue;
    }
    if (rewrite(path, tags) === "written") written++;
    else unchanged++;
  }
}

// Post-condition: re-read every file and confirm what is on disk is what we
// meant to write. Reporting "written" is not evidence that anything changed —
// the CRLF bug above proved that the hard way.
if (write) {
  const wrong: string[] = [];
  for (const locale of LOCALES) {
    for (const slug of slugs) {
      const path = pathFor(slug, locale);
      if (!existsSync(path)) continue;
      const expected = tagsFor(slug, locale).join("|");
      const actual = readTags(path).join("|");
      if (expected !== actual) {
        wrong.push(`${path}\n     expected: ${expected}\n     actual:   ${actual}`);
      }
    }
  }
  if (wrong.length) {
    console.error(
      `\nFAIL ${wrong.length} files do not match the taxonomy after writing:\n   ${wrong.slice(0, 5).join("\n   ")}`
    );
    process.exit(1);
  }
  console.log(`\nverified: all ${LOCALES.length * slugs.length - absent} files match the taxonomy on disk`);
}

console.log(`\n${write ? "WROTE" : "DRY RUN"} - ${written} written, ${unchanged} unchanged, ${absent} files absent\n`);

for (const locale of LOCALES) {
  const counts = new Map<string, number>();
  for (const slug of slugs) {
    for (const t of tagsFor(slug, locale)) {
      const s = slugifyTag(t);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  const indexable = [...counts.values()].filter((n) => n >= 5).length;
  const singles = [...counts.values()].filter((n) => n === 1).length;
  console.log(`${locale}: distinct=${counts.size}  indexable(>=5)=${indexable}  singletons=${singles}`);
  if (locale === "en") {
    console.log(
      "   " + [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}(${n})`).join(", ")
    );
  }
}
