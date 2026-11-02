import { getAllFrontmatter } from "@/lib/blog/api";
import { escapeXml } from "@/lib/utils/escape-xml";
import { SITE_URL } from "@/lib/seo/canonical";


/** Each locale's feed: its URL prefix and how its channel introduces itself. */
const CHANNELS = {
  en: {
    prefix: "",
    title: "MonkeyTravel Blog",
    description: "Practical travel planning tips, AI travel tools, and destination guides.",
    language: "en",
  },
  es: {
    prefix: "/es",
    title: "MonkeyTravel Blog - Español",
    description: "Consejos prácticos de viaje, herramientas AI para viajeros y guías de destinos.",
    language: "es",
  },
  it: {
    prefix: "/it",
    title: "MonkeyTravel Blog - Italiano",
    description: "Consigli pratici di viaggio, strumenti AI per viaggiatori e guide alle destinazioni.",
    language: "it",
  },
  pt: {
    prefix: "/pt",
    title: "MonkeyTravel Blog - Português",
    description: "Dicas práticas de viagem, ferramentas de AI para viajantes e guias de destinos.",
    language: "pt-BR",
  },
} as const;

export type FeedLocale = keyof typeof CHANNELS;

/** The blog's RSS feed for a locale, built from front matter alone: no post is rendered. */
export function blogFeedResponse(locale: FeedLocale): Response {
  const channel = CHANNELS[locale];
  const items = getAllFrontmatter(locale)
    .map((frontmatter) => {
      const url = `${SITE_URL}${channel.prefix}/blog/${frontmatter.slug}`;
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
    <title>${channel.title}</title>
    <link>${SITE_URL}${channel.prefix}/blog</link>
    <description>${channel.description}</description>
    <language>${channel.language}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}${channel.prefix}/feed.xml" rel="self" type="application/rss+xml" />
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
