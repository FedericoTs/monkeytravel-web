import { Suspense, type ReactNode } from "react";
import type { TocItem } from "@/lib/blog/api";
import BlogContentClient from "./BlogContentClient";

interface BlogContentProps {
  html: string;
  /** The article's headings, from extractToc(html). */
  toc: TocItem[];
  tocLabel?: string;
  /**
   * Optional content (typically an inline CTA) injected immediately
   * before the Nth <h2> heading in the article body. Defaults to N=3
   * (so the slot lands after intro + 2 sections, roughly mid-article).
   */
  inlineSlot?: ReactNode;
  inlineSlotBeforeH2Index?: number;
}

/**
 * Split the rendered article HTML at the boundary of the Nth <h2>.
 * Returns [before, after]. If the article has fewer than N h2s, returns
 * [html, ""] and the inline slot is suppressed by the caller.
 */
function splitAtNthH2(html: string, n: number): [string, string] {
  const re = /<h2[\s>]/g;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    count++;
    if (count === n) {
      return [html.slice(0, match.index), html.slice(match.index)];
    }
  }
  return [html, ""];
}

/**
 * Server component that renders blog HTML as static content, in the
 * initial SSR HTML (Googlebot's first-pass crawl reads it before any RSC
 * streaming). The collapsible ToC comes first, above the article, on screens
 * without the desktop sidebar. It renders on the server too; its Suspense
 * boundary keeps the client child from ever holding the article back.
 *
 * If `inlineSlot` is provided, it's injected mid-article right before
 * the Nth <h2> heading (default 3rd) — a single <article> is preserved
 * so semantic structure stays intact.
 */
export default function BlogContent({
  html,
  toc,
  tocLabel = "Table of Contents",
  inlineSlot,
  inlineSlotBeforeH2Index = 3,
}: BlogContentProps) {
  const [before, after] = inlineSlot ? splitAtNthH2(html, inlineSlotBeforeH2Index) : [html, ""];

  return (
    <>
      <Suspense fallback={null}>
        <BlogContentClient toc={toc} tocLabel={tocLabel} />
      </Suspense>
      <article className="blog-prose">
        <div dangerouslySetInnerHTML={{ __html: before }} />
        {after && inlineSlot}
        {after && <div dangerouslySetInnerHTML={{ __html: after }} />}
      </article>
    </>
  );
}
