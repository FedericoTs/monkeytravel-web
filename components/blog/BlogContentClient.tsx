"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import type { TocItem } from "@/lib/blog/api";

interface BlogContentClientProps {
  html: string;
  toc: TocItem[];
  tocLabel?: string;
}

/**
 * Client component for interactive blog features:
 * - Collapsible Table of Contents
 * - Table wrapper styling for scroll/rounded corners
 *
 * The actual blog HTML is rendered by the server-side BlogContent parent.
 * The ToC and the heading ids come from the server (lib/blog/api), the same
 * list the desktop sidebar shows.
 */
export default function BlogContentClient({ html, toc, tocLabel = "Table of Contents" }: BlogContentClientProps) {
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    // Find the server-rendered article element
    const article = document.querySelector("article.blog-prose");
    if (!article) return;

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
          className={`w-5 h-5 text-slate-500 transition-transform ${tocOpen ? "rotate-180" : ""}`}
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
                className={`block py-1.5 text-sm hover:text-[var(--primary-ink)] transition-colors ${
                  item.level === 2
                    ? "text-slate-700 font-medium"
                    : "text-slate-500"
                }`}
                onClick={(event) => {
                  // The list sits above every heading: collapse it before
                  // scrolling, or the page shrinks mid-scroll and the heading
                  // lands under the navbar.
                  event.preventDefault();
                  flushSync(() => setTocOpen(false));
                  document.getElementById(item.id)?.scrollIntoView();
                  if (location.hash !== `#${item.id}`) history.pushState(null, "", `#${item.id}`);
                }}
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
