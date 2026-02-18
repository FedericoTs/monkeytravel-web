import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { remark } from "remark";
import html from "remark-html";
import type { BlogFrontmatter, BlogPost } from "./types";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

async function markdownToHtml(markdown: string): Promise<string> {
  const result = await remark().use(html).process(markdown);
  return result.toString();
}

function parseFrontmatter(slug: string): { frontmatter: BlogFrontmatter; content: string } | null {
  const filePath = path.join(BLOG_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  return { frontmatter: data as BlogFrontmatter, content };
}

export function getAllSlugs(): string[] {
  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));
  return files.map((f) => f.replace(/\.md$/, ""));
}

export async function getAllPosts(): Promise<BlogPost[]> {
  const slugs = getAllSlugs();
  const posts = await Promise.all(slugs.map((slug) => getPostBySlug(slug)));
  return posts
    .filter((p): p is BlogPost => p !== null)
    .sort(
      (a, b) =>
        new Date(b.frontmatter.publishedAt).getTime() -
        new Date(a.frontmatter.publishedAt).getTime()
    );
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const parsed = parseFrontmatter(slug);
  if (!parsed) return null;

  const postHtml = await markdownToHtml(parsed.content);
  return {
    frontmatter: parsed.frontmatter,
    content: parsed.content,
    html: postHtml,
  };
}

export async function getRelatedPosts(
  slug: string,
  limit = 3
): Promise<BlogPost[]> {
  const current = parseFrontmatter(slug);
  if (!current) return [];

  const all = await getAllPosts();
  const currentTags = new Set(current.frontmatter.tags);

  return all
    .filter((p) => p.frontmatter.slug !== slug)
    .map((p) => ({
      post: p,
      score:
        p.frontmatter.tags.filter((t) => currentTags.has(t)).length +
        (p.frontmatter.category === current.frontmatter.category ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.post);
}
