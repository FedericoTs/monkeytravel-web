import { Link } from "@/lib/i18n/routing";
import type { Destination, Locale } from "@/lib/destinations/types";

interface DestinationPrevNextProps {
  prev: Destination | null;
  next: Destination | null;
  locale: Locale;
  prevLabel: string;
  nextLabel: string;
}

/**
 * Two-card navigation between destinations within the same continent
 * (alphabetical). Boundary cells stay empty so the grid keeps width
 * on both sides.
 */
export default function DestinationPrevNext({
  prev,
  next,
  locale,
  prevLabel,
  nextLabel,
}: DestinationPrevNextProps) {
  if (!prev && !next) return null;

  return (
    <nav className="my-12 grid sm:grid-cols-2 gap-4" aria-label="Destination navigation">
      {prev ? (
        <Link
          href={`/destinations/${prev.slug}`}
          className="group flex flex-col gap-1.5 p-5 rounded-2xl border border-slate-200/80 bg-white hover:border-[var(--accent)]/40 hover:shadow-md transition-all"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 group-hover:text-[var(--primary)] transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            {prevLabel}
          </span>
          <h3 className="text-base font-semibold text-slate-900 group-hover:text-[var(--primary)] transition-colors">
            {prev.name[locale]}
          </h3>
          <p className="text-xs text-slate-500">{prev.country[locale]}</p>
        </Link>
      ) : (
        <div aria-hidden className="hidden sm:block" />
      )}

      {next ? (
        <Link
          href={`/destinations/${next.slug}`}
          className="group flex flex-col items-end gap-1.5 p-5 rounded-2xl border border-slate-200/80 bg-white hover:border-[var(--accent)]/40 hover:shadow-md transition-all text-right"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 group-hover:text-[var(--primary)] transition-colors">
            {nextLabel}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </span>
          <h3 className="text-base font-semibold text-slate-900 group-hover:text-[var(--primary)] transition-colors">
            {next.name[locale]}
          </h3>
          <p className="text-xs text-slate-500">{next.country[locale]}</p>
        </Link>
      ) : (
        <div aria-hidden className="hidden sm:block" />
      )}
    </nav>
  );
}
