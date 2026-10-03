import { getAllFrontmatter } from "@/lib/blog/api";

const SITE_URL = "https://monkeytravel.app";

// Built once and refreshed hourly, like sitemap-trips.xml: the feed only
// needs front matter, so it never renders the posts themselves.
export const revalidate = 3600;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const items = getAllFrontmatter("en")
    .map((frontmatter) => {
      const url = `${SITE_URL}/blog/${frontmatter.slug}`;
      const pubDate = new Date(frontmatter.publishedAt).toUTCString();

      return `    <item>
      <title>${escapeXml(frontmatter.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escapeXml(frontmatter.description)}</description>
      <pubDate>${pubDate}</pubDate>
      <category>${escapeXml(frontmatter.category)}</category>
      <author>support@monkeytravel.app (${escapeXml(frontmatter.author)})</author>
    </item>`;
    })
    .join("\n");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>MonkeyTravel Blog</title>
    <link>${SITE_URL}/blog</link>
    <description>Practical travel planning tips, AI travel tools, and destination guides.</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
