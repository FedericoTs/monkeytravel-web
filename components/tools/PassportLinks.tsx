import { Link } from "@/lib/i18n/routing";
import {
  PASSPORT_PAGE_CODES,
  getPassportSummary,
  passportSlug,
  type PassportCode,
} from "@/lib/visa/passport-pages";

/**
 * Links to every per-passport page. Without them those pages were reachable
 * only from the sitemap. `exclude` drops the page's own passport.
 */
export default function PassportLinks({
  locale,
  title,
  exclude,
  className,
}: {
  locale: string;
  title: string;
  exclude?: PassportCode;
  className?: string;
}) {
  return (
    <nav aria-label={title} className={className}>
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {PASSPORT_PAGE_CODES.filter((c) => c !== exclude).map((c) => {
          const summary = getPassportSummary(c, locale);
          if (!summary) return null;
          return (
            <li key={c}>
              <Link
                href={`/passport/${passportSlug(c)}`}
                className="inline-flex min-h-11 items-center text-[var(--foreground)] underline decoration-slate-300 underline-offset-4 hover:decoration-[var(--primary)]"
              >
                <span aria-hidden="true">{summary.flag}</span>&nbsp;{summary.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
