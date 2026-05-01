import { Link } from "@/lib/i18n/routing";
import { Sparkles } from "lucide-react";

interface BlogInlineAiCtaProps {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref?: string;
}

/**
 * Mid-article CTA card. Server component — emits in static HTML so
 * Googlebot sees it on first crawl and the link is in the page graph.
 *
 * Rendered between the 2nd and 3rd <h2> of an article body via
 * BlogContent's inlineSlot prop. Replaces the newsletter-signup pattern
 * that other SaaS blogs use; for us the conversion target is /trips/new.
 */
export default function BlogInlineAiCta({
  title,
  description,
  ctaLabel,
  ctaHref = "/trips/new",
}: BlogInlineAiCtaProps) {
  return (
    <aside className="my-10 not-prose rounded-2xl bg-gradient-to-br from-[var(--primary)] via-[var(--primary)] to-[var(--primary-dark)] p-6 sm:p-8 text-white shadow-xl shadow-[var(--primary)]/10 relative overflow-hidden">
      {/* decorative grid pattern */}
      <div className="absolute inset-0 bg-grid-pattern opacity-20 pointer-events-none" />
      {/* glow blob */}
      <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-[var(--accent)]/30 blur-3xl pointer-events-none" />

      <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="shrink-0 w-12 h-12 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-[var(--accent)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg sm:text-xl font-bold mb-1 tracking-tight">{title}</h3>
          <p className="text-sm sm:text-base text-white/80 leading-relaxed">{description}</p>
        </div>
        <Link
          href={ctaHref}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full bg-[var(--accent)] text-slate-900 font-semibold text-sm hover:bg-[var(--accent)]/90 transition-all hover:-translate-y-0.5 hover:shadow-lg shadow-[var(--accent)]/20 min-h-[44px]"
        >
          {ctaLabel}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
      </div>
    </aside>
  );
}
