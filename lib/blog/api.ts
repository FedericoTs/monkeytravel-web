import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import html from "remark-html";
import type { BlogFrontmatter, BlogPost } from "./types";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

async function markdownToHtml(markdown: string): Promise<string> {
  const result = await remark().use(remarkGfm).use(html).process(markdown);
  return result.toString();
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
