import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import html from "remark-html";
import type { BlogFrontmatter, BlogPost } from "./types";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

/**
 * Strip the markdown's leading H1 line if present.
 *
 * Each blog page renders its own <h1> from `messages/{locale}/blog.json`
 * (the SEO title). Authors typically also write a `# Title` at the top of
 * the markdown body which would render a SECOND <h1>, hurting the
 * one-h1-per-page best practice. This removes that duplicate.
 */
function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]+\n+/, "");
}

/**
 * GitHub-style admonition labels. The author writes:
 *
 *     > [!TIP]
 *     > body content here
 *     > over multiple lines
 *
 * and gets a styled callout block. We emit a <blockquote class="callout
 * callout-tip"> rather than a <div> so it survives remark-html's default
 * sanitization (blockquote + class attribute is in the safe schema).
 */
const CALLOUT_LABELS: Record<string, { cls: string; emoji: string; label: string }> = {
  TIP:       { cls: "callout-tip",       emoji: "💡", label: "Tip" },
  NOTE:      { cls: "callout-note",      emoji: "📘", label: "Note" },
  IMPORTANT: { cls: "callout-important", emoji: "🔔", label: "Important" },
  WARNING:   { cls: "callout-warning",   emoji: "⚠️", label: "Warning" },
  CAUTION:   { cls: "callout-caution",   emoji: "🛑", label: "Caution" },
  INFO:      { cls: "callout-note",      emoji: "ℹ️", label: "Info" },
};

function parseAdmonitions(markdown: string): string {
  // Match a blockquote that opens with `> [!LABEL]` followed by any number
  // of contiguous `> ...` lines. The opening label line is consumed; the
  // remaining lines become the callout body.
  const pattern = /^>\s*\[!(TIP|NOTE|IMPORTANT|WARNING|CAUTION|INFO)\]\s*\n((?:^>.*(?:\n|$))*)/gm;
  return markdown.replace(pattern, (_match, type: string, body: string) => {
    const meta = CALLOUT_LABELS[type] ?? CALLOUT_LABELS.NOTE;
    // Strip the leading `> ` from each body line
    const cleanBody = body.replace(/^>\s?/gm, "").trim();
    // Emit as a styled blockquote — survives remark-html sanitization.
    // A blank line between the header paragraph and the body is required
    // for remark to parse the body as separate paragraphs.
    return `<blockquote class="callout ${meta.cls}">\n\n**${meta.emoji} ${meta.label}**\n\n${cleanBody}\n\n</blockquote>\n`;
  });
}

async function markdownToHtml(markdown: string): Promise<string> {
  const preprocessed = parseAdmonitions(stripLeadingH1(markdown));
  // sanitize: true enables GitHub-style HTML sanitization, stripping
  // dangerous tags (<script>, event handlers) while allowing safe HTML
  const result = await remark()
    .use(remarkGfm)
    .use(html, { sanitize: true })
    .process(preprocessed);
  return styleDestinationLinks(addHeadingIds(result.toString()));
}

/**
 * Tag any inline link to /destinations/<slug> with a `dest-chip` class
 * so we can give it editorial highlighter styling + a 'Plan with AI'
 * affordance on hover. The conversion target stays the same — the user
 * lands on the destination page where the AI planner is one tap away —
 * but the visual treatment signals "this is more than just a link, it's
 * a way into the product."
 *
 * The class attribute is permitted on <a> in remark-html's default safe
 * schema so this survives sanitization.
 */
function styleDestinationLinks(html: string): string {
  return html.replace(
    /<a(\s+[^>]*?)?href="(\/(?:[a-z]{2}\/)?destinations\/[a-z0-9-]+)"([^>]*?)>/g,
    (match, beforeAttrs: string | undefined, href: string, afterAttrs: string) => {
      // Skip if the link already carries a class
      if ((beforeAttrs && /\sclass=/.test(beforeAttrs)) || /\sclass=/.test(afterAttrs)) {
        return match;
      }
      const before = beforeAttrs ?? "";
      return `<a${before}href="${href}"${afterAttrs} class="dest-chip">`;
    }
  );
}

/**
 * Slugify a heading's plain text into a URL anchor id.
 * Matches the algorithm in components/blog/BlogContentClient.tsx so server
 * and client converge on the same id for the same heading text.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Inject `id="..."` attributes into rendered <h2>/<h3> tags that don't
 * already have them. Lets both the server-rendered sidebar ToC and the
 * client-side collapsible ToC link to the same anchors.
 */
function addHeadingIds(html: string): string {
  return html.replace(
    /<h([2-3])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g,
    (_match, level: string, attrs: string | undefined, inner: string) => {
      // Skip if there's already an id attribute on the tag
      if (attrs && /\sid=/.test(attrs)) {
        return _match;
      }
      const text = inner.replace(/<[^>]*>/g, "").trim();
      const id = slugifyHeading(text);
      const existingAttrs = attrs ?? "";
      return `<h${level}${existingAttrs} id="${id}">${inner}</h${level}>`;
    }
  );
}

export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

/**
 * Extract a flat ToC from rendered article HTML. Run after markdownToHtml
 * so the ids match the ones we injected. Used by the sticky desktop
 * sidebar.
 */
export function extractToc(html: string): TocItem[] {
  const items: TocItem[] = [];
  const re = /<h([2-3])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const level = parseInt(match[1], 10) as 2 | 3;
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    if (text) items.push({ id: slugifyHeading(text), text, level });
  }
  return items;
}

function parseFrontmatter(slug: string, locale = "en"): { frontmatter: BlogFrontmatter; content: string } | null {
  // Try locale-specific file first, fall back to English
  const localePath = path.join(BLOG_DIR, locale, `${slug}.md`);
  const defaultPath = path.join(BLOG_DIR, `${slug}.md`);
  const filePath = locale !== "en" && fs.existsSync(localePath) ? localePath : defaultPath;

  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  return { frontmatter: data as BlogFrontmatter, content };
}

export function getPostTags(slug: string): string[] {
  const parsed = parseFrontmatter(slug);
  return parsed?.frontmatter.tags ?? [];
}

export function getPostDates(slug: string): { publishedAt: string; updatedAt: string } | null {
  const parsed = parseFrontmatter(slug);
  if (!parsed) return null;
  return {
    publishedAt: parsed.frontmatter.publishedAt,
    updatedAt: parsed.frontmatter.updatedAt,
  };
}

export function getAllSlugs(): string[] {
  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));
  return files.map((f) => f.replace(/\.md$/, ""));
}

/**
 * Lightweight: returns only frontmatter for all posts (no HTML rendering).
 * Use this when you only need metadata, not full post content.
 */
export function getAllFrontmatter(locale = "en"): BlogFrontmatter[] {
  const slugs = getAllSlugs();
  return slugs
    .map((slug) => parseFrontmatter(slug, locale)?.frontmatter)
    .filter((fm): fm is BlogFrontmatter => fm !== undefined)
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}

export async function getAllPosts(locale = "en"): Promise<BlogPost[]> {
  const slugs = getAllSlugs();
  const posts = await Promise.all(slugs.map((slug) => getPostBySlug(slug, locale)));
  return posts
    .filter((p): p is BlogPost => p !== null)
    .sort(
      (a, b) =>
        new Date(b.frontmatter.publishedAt).getTime() -
        new Date(a.frontmatter.publishedAt).getTime()
    );
}

export async function getPostBySlug(slug: string, locale = "en"): Promise<BlogPost | null> {
  const parsed = parseFrontmatter(slug, locale);
  if (!parsed) return null;

  const postHtml = await markdownToHtml(parsed.content);
  return {
    frontmatter: parsed.frontmatter,
    content: parsed.content,
    html: postHtml,
  };
}

/**
 * Find the previous (newer) and next (older) post in chronological order.
 * Used by the prev/next navigation block at the end of detail pages.
 * Returns nulls at the boundaries (newest post has no prev; oldest has no next).
 */
export function getPrevNextPosts(
  slug: string,
  locale = "en"
): { prev: BlogFrontmatter | null; next: BlogFrontmatter | null } {
  const all = getAllFrontmatter(locale);
  const idx = all.findIndex((fm) => fm.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? all[idx - 1] : null,
    next: idx < all.length - 1 ? all[idx + 1] : null,
  };
}

export function getRelatedPosts(
  slug: string,
  limit = 3,
  locale = "en"
): BlogFrontmatter[] {
  const current = parseFrontmatter(slug);
  if (!current) return [];

  const all = getAllFrontmatter(locale);
  const currentTags = new Set(current.frontmatter.tags);

  return all
    .filter((fm) => fm.slug !== slug)
    .map((fm) => ({
      fm,
      score:
        fm.tags.filter((t) => currentTags.has(t)).length +
        (fm.category === current.frontmatter.category ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.fm);
}
