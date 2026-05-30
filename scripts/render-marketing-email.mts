/**
 * Render a marketing email (blog digest or single-post announce) to a
 * standalone HTML file, ready to paste into a Resend Broadcast (or send via
 * the Broadcasts API). The unsubscribe link is the Resend broadcast token
 * `{{{RESEND_UNSUBSCRIBE_URL}}}`, which Resend substitutes per-recipient.
 *
 * Usage:
 *   npx tsx scripts/render-marketing-email.mts digest [count] [locale]
 *   npx tsx scripts/render-marketing-email.mts announce <slug> [locale]
 *
 * Writes ./out/marketing-<kind>-<locale>.html and prints the path + subject.
 * Does NOT send — sending is done from Resend Broadcasts (see
 * docs/MARKETING_EMAILS.md).
 */

import fs from "node:fs";
import path from "node:path";
import { render } from "@react-email/render";
import * as BlogDigestMod from "../lib/email/templates/BlogDigest";
import * as BlogAnnounceMod from "../lib/email/templates/BlogAnnounce";
import * as BlogApiMod from "../lib/blog/api";
import * as PopularityMod from "../lib/blog/popularity";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BlogDigest = (BlogDigestMod as any).default;
const BlogDigestEmail = BlogDigest.default;
const blogDigestSubject = BlogDigest.blogDigestSubject;
const BlogAnnounce = (BlogAnnounceMod as any).default;
const BlogAnnounceEmail = BlogAnnounce.default;
const blogAnnounceSubject = BlogAnnounce.blogAnnounceSubject;
const blogApi = (BlogApiMod as any).default ?? BlogApiMod;
const popularity = (PopularityMod as any).default ?? PopularityMod;
const getTopBlogSlugs = popularity.getTopBlogSlugs;

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
const UNSUB = "{{{RESEND_UNSUBSCRIBE_URL}}}"; // Resend broadcast token

// CLI:  digest [top] [count] [locale]   |   announce <slug> [locale]
const args = process.argv.slice(2);
const kind = args[0] || "digest";
const wantTop = args.includes("top");
const locale = (args.find((a) => ["en", "es", "it"].includes(a)) || "en") as
  | "en"
  | "es"
  | "it";
const count = Number(args.find((a) => /^\d+$/.test(a))) || 3;
const announceSlug = args
  .slice(1)
  .find((a) => a !== "top" && !["en", "es", "it"].includes(a) && !/^\d+$/.test(a));

function toCard(fm: any) {
  return {
    title: fm.title,
    excerpt: fm.description,
    url: `${APP}/blog/${fm.slug}`,
    imageUrl: fm.image?.startsWith("http") ? fm.image : `${APP}${fm.image}`,
    category: fm.category,
    readingTime: fm.readingTime,
    author: fm.author,
  };
}

async function main() {
  const all: any[] = blogApi.getAllFrontmatter(locale);
  let html: string;
  let subject: string;
  let selected: any[] = [];
  let ordering = "recent";

  if (kind === "announce") {
    const fm = all.find((f) => f.slug === announceSlug) ?? all[0];
    if (!fm) throw new Error("no posts found");
    selected = [fm];
    subject = blogAnnounceSubject(fm.title, locale);
    html = await render(
      BlogAnnounceEmail({
        locale,
        post: toCard(fm),
        blogUrl: `${APP}/blog`,
        unsubscribeUrl: UNSUB,
      })
    );
  } else {
    if (wantTop) {
      const ranked: string[] = await getTopBlogSlugs({ limit: count });
      if (ranked.length) {
        const bySlug = new Map(all.map((fm) => [fm.slug, fm]));
        selected = ranked
          .map((s) => bySlug.get(s))
          .filter(Boolean)
          .slice(0, count);
        ordering = "popular (PostHog pageviews)";
      } else {
        console.warn(
          "[render] popularity ranking unavailable (PostHog not configured or no data) — using newest posts"
        );
      }
    }
    if (!selected.length) selected = all.slice(0, count);
    subject = blogDigestSubject(locale);
    html = await render(
      BlogDigestEmail({
        locale,
        posts: selected.map(toCard),
        blogUrl: `${APP}/blog`,
        unsubscribeUrl: UNSUB,
      })
    );
  }

  const outDir = path.join(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `marketing-${kind}-${locale}.html`);
  fs.writeFileSync(file, html, "utf8");
  console.log(`Kind:     ${kind}  (ordering: ${ordering}, locale: ${locale})`);
  console.log(`Subject:  ${subject}`);
  console.log("Posts:");
  selected.forEach((fm, i) => console.log(`  ${i + 1}. ${fm.title}  [${fm.slug}]`));
  console.log(`Wrote:    ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
