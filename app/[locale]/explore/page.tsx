import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/routing";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import { PullToRefreshWrapper } from "@/components/ui/PullToRefreshWrapper";
import TripCard from "@/components/explore/TripCard";
import ExploreFilters from "@/components/explore/ExploreFilters";
import { fetchExploreFeed } from "@/lib/explore/fetcher";
import type { BudgetTier } from "@/lib/explore/types";

const SITE_URL = "https://monkeytravel.app";

/**
 * /explore — public UGC + seed-data trip feed.
 *
 * Rewritten 2026-05-28 (Week 2 closure, task #117): replaced the legacy
 * client-only `ExploreClient` with a server-rendered page that consumes
 * `fetchExploreFeed` + the new `TripCard` (engagement counts, Backpacker
 * badge, Editor's Pick) + URL-state `ExploreFilters`. This is the
 * surface the publish auto-prompt feeds into; the legacy renderer was
 * missing the new fields the auto-prompt depends on.
 *
 * Architecture:
 *   - Server-rendered grid (good for SEO + initial paint with 7+ seeds)
 *   - ExploreFilters is a thin client island that writes to the URL;
 *     navigation re-renders the page server-side with new filters
 *   - Pagination is plain <Link> with ?page=N — also server-rendered
 *   - When EXPLORE_UGC_ENABLED is OFF, fetchExploreFeed returns null;
 *     we fall back to a "coming soon" block so the route stays linkable
 */

// Locale-aware metadata generator. The previous static export hardcoded
// English titles, breaking SEO + hreflang signals for /it /es. Localized
// 2026-05-28 (bug-fix sweep). Hardened 2026-05-29 (tasks #209 + #210):
//   - setRequestLocale is now called BEFORE getTranslations so the
//     request scope is set for metadata resolution; without it next-intl
//     can render with a fallback locale and Next's metadata cache may
//     drop dynamically-built `alternates.languages` keys.
//   - `alternates.languages` is now an inline object literal (matching
//     the homepage + weekend-trip-planner pattern that ships hreflang
//     correctly), not a computed for-loop. Computed bracket-assignment
//     on a Record<string, string> was the only shape difference between
//     this page and the pages where hreflang emits — swap eliminates the
//     variable while we keep the parent route's default robots policy.
//   - `robots` is now explicit. The root layout already publishes
//     `index, follow`, but stating it on this leaf prevents any parent
//     metadata cascade or Next.js error-fallback from silently turning
//     /explore into `noindex` (which is what the #210 probe caught on
//     /it/explore: the conflicting tags came from an error-boundary
//     render falling back to noindex on top of the root's `index, follow`).
//     /explore is the public discovery surface for /it /es /en — must
//     be indexable.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common.share.explore" });

  // hreflang map — inline literal matching homepage shape (task #209
  // fix). Routing uses `localePrefix: 'as-needed'` with default 'en',
  // so English URLs are unprefixed and IT/ES carry the locale segment.
  // Without these tags Google can't deduplicate /explore, /it/explore,
  // /es/explore — they get treated as three competing pages.
  const languages = {
    en: `${SITE_URL}/explore`,
    es: `${SITE_URL}/es/explore`,
    it: `${SITE_URL}/it/explore`,
    "x-default": `${SITE_URL}/explore`,
  } as const;
  const canonical =
    languages[locale as keyof typeof languages] ?? languages["x-default"];

  return {
    // Root layout's title.template appends " | MonkeyTravel" — don't add
    // the suffix here or the rendered <title> doubles.
    title: t("pageTitle"),
    description: t("metaDescription"),
    // Explicit indexable policy — see header docblock for the #210
    // rationale. Mirrors the root-layout default; stating it here pins
    // intent so a future error-boundary or wrapping layout can't
    // silently flip the page to noindex.
    robots: { index: true, follow: true },
    openGraph: {
      title: `${t("pageTitle")} | MonkeyTravel`,
      description: t("metaDescription"),
      type: "website",
      url: canonical,
    },
    alternates: {
      canonical,
      languages,
    },
  };
}

type SearchParams = {
  destination?: string;
  budget?: string;
  tags?: string;
  duration_min?: string;
  duration_max?: string;
  travel_style?: string;
  page?: string;
};

function parseFilters(sp: SearchParams) {
  const budget: BudgetTier | undefined =
    sp.budget === "budget" || sp.budget === "balanced" || sp.budget === "premium"
      ? sp.budget
      : undefined;
  const durationMin = sp.duration_min
    ? Number.parseInt(sp.duration_min, 10)
    : undefined;
  const durationMax = sp.duration_max
    ? Number.parseInt(sp.duration_max, 10)
    : undefined;
  const page = sp.page ? Math.max(1, Number.parseInt(sp.page, 10) || 1) : 1;
  return {
    destination: sp.destination?.trim() || undefined,
    budget,
    tag: sp.tags?.trim() || undefined,
    durationMin: Number.isFinite(durationMin) ? durationMin : undefined,
    durationMax: Number.isFinite(durationMax) ? durationMax : undefined,
    page,
    // travel_style is filtered inside /api/explore/trips, but the
    // fetcher doesn't expose it on the typed Filters. We pass it via the
    // URL we build inside fetchExploreFeed by reading window.search; for
    // SSR it's already on the URL the page receives. The API route reads
    // it from request.url directly, so we just forward.
  } as const;
}

export default async function ExplorePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common.share.explore" });

  const sp = await searchParams;
  const filters = parseFilters(sp);

  // travel_style needs to be forwarded to the API; the existing
  // fetchExploreFeed doesn't accept it, so we call the API directly with
  // the same forwarding behaviour. Cheap: same host, server-side fetch,
  // 60s revalidate via the wrapper still applies for the standard path.
  const feed = await fetchExploreFeedWithStyle(filters, sp.travel_style);

  const trips = feed?.trips ?? [];
  const totalPages = feed?.totalPages ?? 0;
  const currentPage = feed?.page ?? 1;
  const total = feed?.total ?? 0;

  // Build the pagination link helper — preserves existing filter params
  // so back/forward + bookmarking work as expected.
  const buildPageUrl = (n: number) => {
    const next = new URLSearchParams();
    if (sp.destination) next.set("destination", sp.destination);
    if (sp.budget) next.set("budget", sp.budget);
    if (sp.tags) next.set("tags", sp.tags);
    if (sp.duration_min) next.set("duration_min", sp.duration_min);
    if (sp.duration_max) next.set("duration_max", sp.duration_max);
    if (sp.travel_style) next.set("travel_style", sp.travel_style);
    if (n > 1) next.set("page", String(n));
    const q = next.toString();
    return q ? `/explore?${q}` : "/explore";
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Navbar />

      {/* Hero — kept short so filters + grid are immediately visible. */}
      <section className="relative bg-gradient-to-br from-[var(--primary)] to-[#0A6B9E] text-white">
        <div className="absolute inset-0 bg-[url('/images/pattern-dots.svg')] opacity-10" />
        <div className="relative max-w-7xl mx-auto px-4 py-10 sm:py-14">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
            {t("h1")}
          </h1>
          <p className="text-white/85 text-base sm:text-lg max-w-2xl">
            {t("lede")}
          </p>
        </div>
      </section>

      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 sm:py-10 w-full">
        <nav className="text-sm text-slate-500 mb-4" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-slate-700">
            {t("breadcrumbHome")}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{t("breadcrumbCurrent")}</span>
        </nav>

        <ExploreFilters />

        {/* Coming-soon block: shown when the env flag is off (fetcher
            returns null). Keeps the route valid for SEO + indexed URLs. */}
        {feed === null && (
          <div className="mt-8 rounded-2xl bg-amber-50 border border-amber-200 p-8 text-center">
            <p className="text-slate-700">{t("comingSoon")}</p>
            <Link
              href="/trips/new"
              className="mt-4 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[var(--primary)] text-white font-semibold hover:opacity-90 transition-all shadow-sm"
            >
              {t("planATrip")} →
            </Link>
          </div>
        )}

        {/* Real feed path */}
        {feed !== null && (
          <>
            <div className="mt-6 mb-5 flex items-center justify-between">
              <p className="text-sm text-slate-500">
                {total === 0
                  ? t("noResults")
                  : total === 1
                    ? t("tripCountSingular", { count: total })
                    : t("tripCountPlural", { count: total })}
              </p>
              {totalPages > 1 && (
                <p className="text-sm text-slate-500">
                  {t("pageOfPages", { current: currentPage, total: totalPages })}
                </p>
              )}
            </div>

            {trips.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-10 text-center">
                <div className="text-5xl mb-3">🧭</div>
                <h2 className="text-xl font-semibold text-slate-900 mb-2">
                  {t("nothingHereYet")}
                </h2>
                <p className="text-slate-600 mb-5 max-w-md mx-auto">
                  {t("beTheFirstToPublish")}
                </p>
                <Link
                  href="/explore"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-slate-300 text-slate-700 font-medium hover:bg-white transition-all"
                >
                  {t("clearFilters")}
                </Link>
              </div>
            ) : (
              <div
                className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6"
                data-testid="explore-feed-grid"
              >
                {trips.map((trip) => (
                  <TripCard key={trip.id} trip={trip} />
                ))}
              </div>
            )}

            {/* Pagination — simple prev/next + page numbers around the
                current page. Plain Links so server re-renders with new
                filters on click. */}
            {totalPages > 1 && (
              <div className="mt-10 flex items-center justify-center gap-2">
                {currentPage > 1 ? (
                  <Link
                    href={buildPageUrl(currentPage - 1) as never}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors text-sm"
                    rel="prev"
                  >
                    {t("prev")}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="px-3 py-2 rounded-lg border border-slate-200 text-slate-300 text-sm cursor-not-allowed"
                  >
                    {t("prev")}
                  </span>
                )}

                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let n: number;
                  if (totalPages <= 5) n = i + 1;
                  else if (currentPage <= 3) n = i + 1;
                  else if (currentPage >= totalPages - 2)
                    n = totalPages - 4 + i;
                  else n = currentPage - 2 + i;
                  const isActive = n === currentPage;
                  return isActive ? (
                    <span
                      key={n}
                      aria-current="page"
                      className="w-10 h-10 flex items-center justify-center rounded-lg bg-[var(--primary)] text-white font-medium text-sm"
                    >
                      {n}
                    </span>
                  ) : (
                    <Link
                      key={n}
                      href={buildPageUrl(n) as never}
                      className="w-10 h-10 flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 transition-colors text-sm"
                    >
                      {n}
                    </Link>
                  );
                })}

                {currentPage < totalPages ? (
                  <Link
                    href={buildPageUrl(currentPage + 1) as never}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors text-sm"
                    rel="next"
                  >
                    {t("next")}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="px-3 py-2 rounded-lg border border-slate-200 text-slate-300 text-sm cursor-not-allowed"
                  >
                    {t("next")}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <Footer />

      {/* Native polish layer — pull-to-refresh on the explore feed
          and the bottom tab bar highlighting the Explore slot. */}
      <PullToRefreshWrapper />
      <MobileBottomNav activePage="explore" />
    </div>
  );
}

/**
 * Local extension of fetchExploreFeed that also forwards `travel_style`.
 * The base fetcher's typed Filters interface doesn't expose travel_style
 * (it's a UI-layer concept), but the API route accepts it. We rebuild
 * the URL with the extra param when present.
 *
 * Falls back to the standard fetcher when travel_style isn't set — so
 * the 60s revalidate cache from the wrapper still kicks in for the
 * default-filter path (which is what most visitors hit).
 */
async function fetchExploreFeedWithStyle(
  filters: ReturnType<typeof parseFilters>,
  travelStyle?: string
) {
  if (travelStyle !== "backpacker") {
    return fetchExploreFeed(filters);
  }
  // Manual fetch with travel_style appended. Same host + 60s revalidate
  // to stay consistent with the wrapper.
  const { headers } = await import("next/headers");
  const h = await headers();
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "monkeytravel.app";
  const proto = h.get("x-forwarded-proto") ?? "https";

  const params = new URLSearchParams();
  if (filters.destination) params.set("destination", filters.destination);
  if (filters.budget) params.set("budget", filters.budget);
  if (filters.tag) params.set("tags", filters.tag);
  if (filters.durationMin)
    params.set("duration_min", String(filters.durationMin));
  if (filters.durationMax)
    params.set("duration_max", String(filters.durationMax));
  if (filters.page) params.set("page", String(filters.page));
  params.set("travel_style", "backpacker");

  const url = `${proto}://${host}/api/explore/trips?${params.toString()}`;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) {
      if (res.status === 404) return null;
      return null;
    }
    const json = await res.json();
    if (!Array.isArray(json?.trips)) return null;
    return json as Awaited<ReturnType<typeof fetchExploreFeed>>;
  } catch {
    return null;
  }
}
