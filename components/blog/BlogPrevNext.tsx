import { Link } from "@/lib/i18n/routing";
import type { BlogFrontmatter } from "@/lib/blog/types";

interface BlogPrevNextProps {
  prev: BlogFrontmatter | null;
  prevTitle: string | null;
  next: BlogFrontmatter | null;
  nextTitle: string | null;
  prevLabel: string;
  nextLabel: string;
}

/**
 * Two-card navigation between posts. Renders empty cells when at the
 * boundary so the grid keeps the same width on both sides.
 */
export default function BlogPrevNext({
  prev,
  prevTitle,
  next,
  nextTitle,
  prevLabel,
  nextLabel,
}: BlogPrevNextProps) {
  if (!prev && !next) return null;

  return (
    <nav className="my-12 not-prose grid sm:grid-cols-2 gap-4" aria-label="Article navigation">
      {prev && prevTitle ? (
        <Link
          href={`/blog/${prev.slug}`}
          className="group flex flex-col gap-1.5 p-5 rounded-2xl border border-slate-200/80 bg-white hover:border-[var(--accent)]/40 hover:shadow-md transition-all"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 group-hover:text-[var(--primary)] transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            {prevLabel}
          </span>
          <h3 className="text-base font-semibold text-slate-900 group-hover:text-[var(--primary)] transition-colors leading-snug line-clamp-2">
            {prevTitle}
          </h3>
        </Link>
      ) : (
        <div aria-hidden className="hidden sm:block" />
      )}

      {next && nextTitle ? (
        <Link
          href={`/blog/${next.slug}`}
          className="group flex flex-col items-end gap-1.5 p-5 rounded-2xl border border-slate-200/80 bg-white hover:border-[var(--accent)]/40 hover:shadow-md transition-all text-right"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 group-hover:text-[var(--primary)] transition-colors">
            {nextLabel}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </span>
          <h3 className="text-base font-semibold text-slate-900 group-hover:text-[var(--primary)] transition-colors leading-snug line-clamp-2">
            {nextTitle}
          </h3>
        </Link>
      ) : (
        <div aria-hidden className="hidden sm:block" />
      )}
    </nav>
  );
}
