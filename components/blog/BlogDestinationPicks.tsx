import ImageWithFallback from "@/components/ui/ImageWithFallback";
import PartnerButton from "@/components/booking/PartnerButton";
import { Link } from "@/lib/i18n/routing";
import { getHostelworldSearchUrl, isHostelworldAffiliateActive } from "@/lib/affiliates/hostelworld";
import { seasonalStayWindow } from "@/lib/blog/seasonal-window";
import { tripsNewHrefForPost } from "@/lib/blog/trip-prefill";
import type { Destination, Locale, SampleActivity } from "@/lib/destinations/types";

/**
 * End-of-article destination block for the seasonal round-ups.
 *
 * WHAT PROBLEM THIS SOLVES
 * lib/destinations/data.ts holds hand-written, four-language day plans for 35
 * cities — real named places, not generated filler. Those plans live on
 * /destinations/[slug], which earns 66 organic clicks per QUARTER across 75
 * URLs. The seasonal blog posts earn roughly 975 sessions a MONTH. This block
 * puts the content in front of the traffic, and gives those orphaned
 * destination pages an internal link from the part of the site that has
 * authority.
 *
 * WHY THE ACTIVITY LINES ARE SAFE TO PRINT
 * Every line comes from `destination.content.sampleDay.activities` — the same
 * entries already rendered on the destination page. Nothing here is generated
 * at request time, so this cannot reintroduce the fabricated-citation problem:
 * if a place named below is wrong, it is wrong in one reviewable data file, in
 * all four languages at once.
 */

interface BlogDestinationPicksProps {
  destinations: Destination[];
  locale: Locale;
  /** Post slug — drives both the trip prefill and the stay window. */
  postSlug: string;
  labels: {
    /** Section heading. */
    heading: string;
    /** Label above the activity list, e.g. "What to do". */
    thingsToDo: string;
    /** Label above the food line, e.g. "Where to eat". */
    whereToEat: string;
    /** Planner CTA. Contains a literal {city} placeholder. */
    planCta: string;
    /** Accommodation CTA, e.g. "Find a place to stay". */
    stayCta: string;
    /** Affiliate disclosure shown under the stay CTA. */
    affiliateNote: string;
  };
}

/** Activity types that read as "a thing you go and do". */
const DOING: ReadonlyArray<SampleActivity["type"]> = [
  "sightseeing",
  "museum",
  "walk",
  "activity",
  "nightlife",
  "shopping",
];

/** Activity types that name somewhere to eat. */
const EATING: ReadonlyArray<SampleActivity["type"]> = ["breakfast", "lunch", "dinner"];

export default function BlogDestinationPicks({
  destinations,
  locale,
  postSlug,
  labels,
}: BlogDestinationPicksProps) {
  if (destinations.length === 0) return null;

  const stayWindow = seasonalStayWindow(postSlug);

  // Only surface an outbound stay link when it actually pays us. On a trip
  // page the reader has already committed to a destination, so the link helps
  // them either way — which is why BackpackerHostelCta renders it
  // unconditionally. A seasonal article is the opposite case: the reader has
  // chosen nothing yet, and an un-monetised outbound link would compete with
  // the planner CTA on our highest-traffic pages for no return at all.
  const affiliateActive = isHostelworldAffiliateActive();
  const showStay = Boolean(stayWindow) && affiliateActive;

  return (
    <section className="py-14 bg-[var(--background-warm)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold text-[var(--foreground)] mb-8 text-center">
          {labels.heading}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {destinations.map((dest) => {
            const acts = dest.content.sampleDay.activities;
            const toDo = acts.filter((a) => DOING.includes(a.type)).slice(0, 3);
            const eat = acts.find((a) => EATING.includes(a.type));
            const city = dest.name[locale];

            return (
              <article
                key={dest.slug}
                className="flex flex-col rounded-2xl overflow-hidden bg-[var(--background-alt)] border border-slate-200/80"
              >
                <Link
                  href={`/destinations/${dest.slug}`}
                  className="group relative block h-36 overflow-hidden bg-gradient-to-br from-[var(--primary)]/15 to-[var(--accent)]/15"
                >
                  <ImageWithFallback
                    src={`/images/destinations/${dest.slug}.jpg`}
                    alt={city}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                    sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    loading="lazy"
                  />
                </Link>

                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div>
                    <h3 className="text-lg font-bold text-[var(--foreground)]">
                      <Link
                        href={`/destinations/${dest.slug}`}
                        className="hover:text-[var(--primary-ink)] transition-colors"
                      >
                        {city}
                      </Link>
                    </h3>
                    <p className="mt-1 text-sm text-[var(--foreground-muted)]">
                      {dest.content.tagline[locale]}
                    </p>
                  </div>

                  {toDo.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
                        {labels.thingsToDo}
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {toDo.map((a, i) => (
                          <li
                            key={`${dest.slug}-do-${i}`}
                            className="flex gap-2 text-sm text-[var(--foreground)]"
                          >
                            <span aria-hidden className="text-[var(--primary-ink)]">
                              &middot;
                            </span>
                            <span>{a.title[locale]}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {eat && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
                        {labels.whereToEat}
                      </p>
                      <p className="mt-1 text-sm text-[var(--foreground)]">{eat.title[locale]}</p>
                    </div>
                  )}

                  {/* mt-auto pins the actions to the card bottom, so a card
                      with fewer activities still lines its buttons up with
                      its taller neighbours. */}
                  <div className="mt-auto flex flex-col gap-2 pt-2">
                    <Link
                      href={tripsNewHrefForPost(postSlug, dest.slug)}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--primary)] px-4 text-center text-sm font-semibold text-white transition-transform hover:scale-[1.01] active:scale-[0.99]"
                    >
                      {labels.planCta.replace("{city}", city)}
                    </Link>

                    {showStay && stayWindow && (
                      <>
                        <PartnerButton
                          partner="other"
                          href={getHostelworldSearchUrl({
                            destination: city,
                            startDate: stayWindow.start,
                            endDate: stayWindow.end,
                          })}
                          destination={city}
                          partnerName="Hostelworld"
                          category="hostels"
                          surface="blog_destination_picks"
                          variant="custom"
                          showIcon={false}
                          showExternal={false}
                          extraEventProps={{ post_slug: postSlug, is_affiliate_active: true }}
                          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-slate-300 px-4 text-sm font-semibold text-[var(--foreground)] transition-colors hover:border-[var(--primary)]"
                        >
                          {labels.stayCta}
                        </PartnerButton>
                        <p className="text-center text-[11px] text-[var(--foreground-muted)]">
                          {labels.affiliateNote}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
