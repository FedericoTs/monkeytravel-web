import { Link } from "@/lib/i18n/routing";
import type { TocItem } from "@/lib/blog/api";
import { Sparkles } from "lucide-react";

interface BlogSidebarProps {
  toc: TocItem[];
  tocLabel: string;
  ctaTitle: string;
  ctaDescription: string;
  ctaButton: string;
  ctaHref?: string;
}

/**
 * Desktop right-rail sidebar for blog detail pages. Sticky-positioned
 * below the navbar. Renders:
 *   1. Table of contents (h2 + nested h3 anchors)
 *   2. Compact AI-planner CTA
 *
 * Hidden on viewports below `lg`. The mobile collapsible ToC inside
 * BlogContent (BlogContentClient) handles small screens so the same
 * navigation surface exists everywhere.
 */
export default function BlogSidebar({
  toc,
  tocLabel,
  ctaTitle,
  ctaDescription,
  ctaButton,
  ctaHref = "/trips/new",
}: BlogSidebarProps) {
  // Group h3s under their preceding h2 for a 2-level outline.
  const tree: { h2: TocItem; h3s: TocItem[] }[] = [];
  for (const item of toc) {
    if (item.level === 2) {
      tree.push({ h2: item, h3s: [] });
    } else if (item.level === 3 && tree.length > 0) {
      tree[tree.length - 1].h3s.push(item);
    }
  }

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 flex flex-col gap-6">
        {tree.length > 0 && (
          <nav aria-label={tocLabel} className="text-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              {tocLabel}
            </p>
            <ul className="space-y-2.5 border-l border-slate-200">
              {tree.map(({ h2, h3s }) => (
                <li key={h2.id}>
                  <a
                    href={`#${h2.id}`}
                    className="block -ml-px pl-4 border-l-2 border-transparent text-slate-600 hover:text-[var(--primary)] hover:border-[var(--primary)] transition-colors leading-snug"
                  >
                    {h2.text}
                  </a>
                  {h3s.length > 0 && (
                    <ul className="mt-2 ml-4 space-y-2 border-l border-slate-200">
                      {h3s.map((h3) => (
                        <li key={h3.id}>
                          <a
                            href={`#${h3.id}`}
                            className="block -ml-px pl-3 border-l-2 border-transparent text-xs text-slate-500 hover:text-[var(--primary)] hover:border-[var(--primary)] transition-colors leading-snug"
                          >
                            {h3.text}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="rounded-2xl bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] p-5 text-white relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-[var(--accent)]/30 blur-2xl pointer-events-none" />
          <div className="relative">
            <div className="w-9 h-9 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center mb-3">
              <Sparkles className="w-4 h-4 text-[var(--accent)]" />
            </div>
            <h3 className="font-bold text-base mb-1.5 tracking-tight">{ctaTitle}</h3>
            <p className="text-xs text-white/80 leading-relaxed mb-4">{ctaDescription}</p>
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--accent)] text-slate-900 font-semibold text-xs hover:bg-[var(--accent)]/90 transition-all"
            >
              {ctaButton}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </aside>
  );
}
