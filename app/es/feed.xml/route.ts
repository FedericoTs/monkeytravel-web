import { getAllPosts } from "@/lib/blog/api";

const SITE_URL = "https://monkeytravel.app";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const posts = await getAllPosts("es");

  const items = posts
    .map((post) => {
      const { frontmatter } = post;
      const url = `${SITE_URL}/es/blog/${frontmatter.slug}`;
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
    <title>MonkeyTravel Blog - Español</title>
    <link>${SITE_URL}/es/blog</link>
    <description>Consejos prácticos de viaje, herramientas AI para viajeros y guías de destinos.</description>
    <language>es</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/es/feed.xml" rel="self" type="application/rss+xml" />
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
