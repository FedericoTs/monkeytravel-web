import PartnerButton from "@/components/booking/PartnerButton";
import { Link } from "@/lib/i18n/routing";
import { getHostelworldSearchUrl } from "@/lib/affiliates/hostelworld";
import { destinations } from "@/lib/destinations/data";
import type { Locale } from "@/lib/destinations/types";
import type { LeaderboardEntry } from "@/lib/leaderboard/destinations";

/**
 * "What people are actually planning" — a live leaderboard on the homepage.
 *
 * Replaces a grid that was `destinations.slice(0, 6)`: the first six entries
 * of a hand-maintained array, presented under the heading "Popular
 * Destinations" despite encoding no popularity at all. Every number below
 * comes from real trips (see lib/leaderboard/destinations.ts), so the board
 * reorders itself without anyone editing a list.
 *
 * WHAT IS DELIBERATELY NOT SHOWN
 * Absolute trip counts per destination. The rank order is real and is the
 * claim being made; publishing "6 trips" next to #6 advertises the size of
 * the denominator rather than the insight. Activity counts ARE shown, because
 * "planned 12x" is meaningful on its own terms — it says this is the thing
 * people converge on in that city, which is the actual useful signal.
 *
 * Accommodation is a live search link, never a ranking — the itinerary data
 * cannot support a "top hotels" claim. The reasoning is documented in full in
 * lib/leaderboard/destinations.ts.
 */

interface DestinationLeaderboardProps {
  entries: LeaderboardEntry[];
  locale: Locale;
  labels: {
    /** Section heading. */
    heading: string;
    /** Section subheading. */
    subheading: string;
    /** Badge on destinations where recent demand is concentrated. */
    rising: string;
    /** Label above the activity list. */
    mostPlanned: string;
    /** Suffix for an activity count, e.g. "12x" -> `${n}${plannedTimes}`. */
    plannedTimes: string;
    /** Planner CTA. Contains a literal {city} placeholder. */
    planCta: string;
    /** Accommodation search link. */
    stayCta: string;
  };
}

/**
 * A destination is "rising" when most of its lifetime demand arrived in the
 * last 30 days. Requires an absolute floor too — 2 trips out of 2 is 100%
 * and means nothing.
 */
function isRising(entry: LeaderboardEntry): boolean {
  return entry.trips30d >= 3 && entry.trips30d / entry.tripsAllTime >= 0.5;
}

/**
 * Hostelworld requires dates. The homepage carries no date signal at all
 * (unlike a seasonal article, which at least names a month), so this is an
 * explicit browse default: a 4-night window a month out. The reader changes
 * it on arrival — the point is to land on a populated results page rather
 * than an empty one.
 */
function browseStayWindow(now: Date): { start: string; end: string } {
  const startMs = now.getTime() + 30 * 24 * 60 * 60 * 1000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: iso(startMs), end: iso(startMs + 4 * 24 * 60 * 60 * 1000) };
}

/** Title-case a normalised RPC key for cities with no destination page. */
function titleCase(key: string): string {
  return key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export default function DestinationLeaderboard({
  entries,
  locale,
  labels,
}: DestinationLeaderboardProps) {
  if (entries.length === 0) return null;

  const stay = browseStayWindow(new Date());
  const bySlug = new Map(destinations.map((d) => [d.slug, d]));

  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
          {labels.heading}
        </h2>
        <p className="text-lg text-[var(--foreground-muted)] max-w-2xl mx-auto">
          {labels.subheading}
        </p>
      </div>

      <ol className="space-y-4">
        {entries.map((entry, i) => {
          // The RPC's normalised key doubles as the destination slug for
          // every city that has a page; the rest still rank, they just link
          // to the planner instead.
          const dest = bySlug.get(entry.city);
          // `locale` is whatever segment the [locale] route matched. The layout
          // notFound()s on an unknown one, but the page renders in parallel with
          // it, so a bogus segment (e.g. /apple-touch-icon-precomposed.png) still
          // reaches here and indexes the name map to undefined — which used to
          // throw in getHostelworldSearchUrl. Fall back to the slug's title case.
          const city = dest?.name[locale] ?? titleCase(entry.city);
          const country = dest?.country[locale];
          const rising = isRising(entry);

          return (
            <li
              key={entry.city}
              className="group relative flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-[var(--background-alt)] p-5 sm:flex-row sm:items-start sm:gap-6 sm:p-6"
            >
              {/* Rank. tabular-nums so the column stays aligned as it grows
                  past single digits (DESIGN.md). */}
              <div
                aria-hidden
                className="font-[family-name:var(--font-display)] text-4xl font-bold leading-none text-[var(--primary)] [font-variant-numeric:tabular-nums] sm:text-5xl"
              >
                {i + 1}
              </div>

              <div className="flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 className="text-xl font-bold text-[var(--foreground)]">
                    {dest ? (
                      <Link
                        href={`/destinations/${dest.slug}`}
                        className="transition-colors hover:text-[var(--primary-ink)]"
                      >
                        {city}
                      </Link>
                    ) : (
                      city
                    )}
                  </h3>
                  {country && (
                    <span className="text-sm text-[var(--foreground-muted)]">{country}</span>
                  )}
                  {rising && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--secondary)]/10 px-2.5 py-0.5 text-xs font-semibold text-[var(--secondary-ink)]">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                      {labels.rising}
                    </span>
                  )}
                </div>

                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
                  {labels.mostPlanned}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {entry.topActivities.map((a) => (
                    <li
                      key={a.name}
                      className="inline-flex items-baseline gap-1.5 rounded-full bg-[var(--primary)]/5 px-3 py-1 text-sm text-[var(--foreground)]"
                    >
                      <span>{a.name}</span>
                      <span className="text-xs text-[var(--foreground-muted)] [font-variant-numeric:tabular-nums]">
                        {a.times}
                        {labels.plannedTimes}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-2 sm:w-44 sm:flex-shrink-0">
                <Link
                  href={`/trips/new?destination=${encodeURIComponent(dest?.slug ?? entry.city)}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--primary)] px-4 text-center text-sm font-semibold text-white transition-transform hover:scale-[1.01] active:scale-[0.99]"
                >
                  {labels.planCta.replace("{city}", city)}
                </Link>
                <PartnerButton
                  partner="other"
                  href={getHostelworldSearchUrl({
                    destination: city,
                    startDate: stay.start,
                    endDate: stay.end,
                  })}
                  destination={city}
                  partnerName="Hostelworld"
                  category="hostels"
                  surface="home_leaderboard"
                  variant="custom"
                  showIcon={false}
                  showExternal={false}
                  // Not an affiliate link until an AWIN id exists — see the
                  // same reasoning in BlogDestinationPicks.tsx.
                  rel="noopener nofollow"
                  extraEventProps={{ rank: i + 1, city: entry.city }}
                  className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-[var(--foreground)] transition-colors hover:border-[var(--primary)]"
                >
                  {labels.stayCta}
                </PartnerButton>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
