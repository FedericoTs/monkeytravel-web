"use client";

import { useRef, useEffect, useState } from "react";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface BlogContentClientProps {
  html: string;
  tocLabel?: string;
}

// Mirrors slugifyHeading in lib/blog/api.ts — server and client must
// produce identical IDs so the ToC anchors line up after hydration.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Client component for interactive blog features:
 * - Table of Contents (extracted from headings after hydration)
 * - Table wrapper styling for scroll/rounded corners
 *
 * The actual blog HTML is rendered by the server-side BlogContent parent.
 * This component adds IDs to headings and builds the ToC on mount.
 */
export default function BlogContentClient({ html, tocLabel = "Table of Contents" }: BlogContentClientProps) {
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    // Find the server-rendered article element
    const article = document.querySelector("article.blog-prose");
    if (!article) return;

    // Generate anchor IDs for headings and build ToC
    const headings = article.querySelectorAll("h2, h3");
    const items: TocItem[] = [];

    headings.forEach((heading) => {
      const text = heading.textContent || "";
      const id = slugify(text);
      heading.id = id;
      items.push({
        id,
        text,
        level: heading.tagName === "H2" ? 2 : 3,
      });
    });

    setToc(items);

    // Wrap each <table> in a styled container for rounded corners and scroll
    const tables = article.querySelectorAll("table");
    tables.forEach((table) => {
      if (table.parentElement?.classList.contains("table-wrapper-scroll")) return;
      const wrapper = document.createElement("div");
      wrapper.className = "table-wrapper";
      const scroll = document.createElement("div");
      scroll.className = "table-wrapper-scroll";
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(scroll);
      scroll.appendChild(table);
    });
  }, [html]);

  const h2Items = toc.filter((item) => item.level === 2);

  if (h2Items.length <= 2) return null;

  return (
    <nav className="my-8 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
      <button
        onClick={() => setTocOpen(!tocOpen)}
        className="flex items-center justify-between w-full px-5 py-4 text-left font-semibold text-slate-800 hover:bg-slate-100 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10M4 18h10" />
          </svg>
          {tocLabel}
        </span>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform ${tocOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {tocOpen && (
        <ul className="px-5 pb-4 space-y-1">
          {toc.map((item) => (
            <li key={item.id} className={item.level === 3 ? "pl-4" : ""}>
              <a
                href={`#${item.id}`}
                className={`block py-1.5 text-sm hover:text-[var(--primary)] transition-colors ${
                  item.level === 2
                    ? "text-slate-700 font-medium"
                    : "text-slate-500"
                }`}
                onClick={() => setTocOpen(false)}
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
