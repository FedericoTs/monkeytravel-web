import { Suspense } from "react";
import BlogContentClient from "./BlogContentClient";

interface BlogContentProps {
  html: string;
  tocLabel?: string;
}

/**
 * Server component that renders blog HTML as static content.
 * Article is emitted FIRST so it's present in the initial SSR HTML
 * (Googlebot's first-pass crawl reads this before any RSC streaming).
 * The interactive ToC/table-wrap client child is wrapped in Suspense
 * so it can't pull the article into the streaming bucket.
 */
export default function BlogContent({ html, tocLabel = "Table of Contents" }: BlogContentProps) {
  return (
    <>
      <article
        className="blog-prose"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <Suspense fallback={null}>
        <BlogContentClient html={html} tocLabel={tocLabel} />
      </Suspense>
    </>
  );
}
