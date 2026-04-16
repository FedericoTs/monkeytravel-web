import BlogContentClient from "./BlogContentClient";

interface BlogContentProps {
  html: string;
  tocLabel?: string;
}

/**
 * Server component that renders blog HTML as static content.
 * The actual HTML is rendered server-side so bots, Medium, Flipboard,
 * and Google can see the full content without executing JavaScript.
 *
 * Interactive features (ToC, table wrapping) are handled by the
 * client-side BlogContentClient component.
 */
export default function BlogContent({ html, tocLabel = "Table of Contents" }: BlogContentProps) {
  return (
    <>
      {/* Client component handles ToC extraction + table wrapping after hydration */}
      <BlogContentClient html={html} tocLabel={tocLabel} />

      {/* Server-rendered blog content — visible to all bots and importers */}
      <article
        className="blog-prose"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
