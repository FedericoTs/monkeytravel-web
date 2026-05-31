import { headers } from "next/headers";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Link } from "@/lib/i18n/routing";
import {
  generateFAQSchema,
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { getNonce } from "@/lib/security/nonce";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
// /explore Week 3 (2026-05-29): surface real backpacker trips on the
// Hostelworld wedge landing page. The exact social-proof asset that
// would convert this segment was already built (/explore feed +
// TripCard) but had no link from /backpacker — closing the loop.
import TripCard from "@/components/explore/TripCard";
import type { ExploreFeedResponse } from "@/lib/explore/types";

/**
 * Server-side fetch for the 30-day Hostelworld click stats.
 *
 * Powers the social-proof counter below the hero. Caches at the Vercel
 * edge for 1h via the route handler — this fetch reuses that cache so
 * /backpacker page generation stays sub-100ms even under burst load.
 *
 * Returns null (and the page renders without the block) when stats
 * aren't meaningful yet (zero traffic, env missing, fetch failed). We
 * deliberately don't show "0 backpackers found hostels" — that hurts
 * the partnership narrative more than the absent block would.
 */
async function fetchHostelworldStats(): Promise<{
  clicks30d: number;
  uniqueTrips30d: number;
  uniqueVisitors30d: number;
} | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "monkeytravel.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  try {
    const res = await fetch(`${proto}://${host}/api/affiliates/hostelworld/stats`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.clicks30d !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Fetch /api/explore/trips filtered to travel_style=backpacker.
 *
 * Mirrors the helper in app/[locale]/explore/page.tsx — the typed
 * fetchExploreFeed wrapper doesn't expose travel_style on its Filters
 * interface (it's a UI-layer concept) but the API route reads it
 * from the URL. Same host + 60s revalidate so this stays consistent
 * with the cached default-filter path on the /explore page.
 */
async function fetchBackpackerTrips(): Promise<ExploreFeedResponse | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "monkeytravel.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}/api/explore/trips?travel_style=backpacker&page=1`;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json?.trips)) return null;
    return json as ExploreFeedResponse;
  } catch {
    return null;
  }
}

/**
 * /backpacker landing page.
 *
 * Shipped 2026-05-28 as Phase B3 of the Backpacker Mode / Hostelworld
 * partnership wedge. Purpose:
 *   1. SEO surface for "backpacker trip planner / AI hostel itinerary /
 *      backpacker route europe" type queries.
 *   2. Cold-open asset — the URL we send to Hostelworld (and any other
 *      backpacker-adjacent partner) when starting a conversation. "Look
 *      at the product we built for your demographic."
 *   3. Single-purpose conversion funnel: every CTA lands on /trips/new
 *      where the Backpacker Mode toggle is one click away.
 *
 * Localised 2026-05-29 (task #141) — copy now flows through the
 * `backpacker` next-intl namespace for en / es / it. Sample-route city
 * names stay in English (proper nouns / SEO-stable), but neighbourhood
 * labels translate through the per-route `items.*.neighbourhood` keys.
 */

const BASE_URL = "https://monkeytravel.app";
const PAGE_PATH = "/backpacker";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "backpacker" });
  const prefix = locale === "en" ? "" : `/${locale}`;
  const title = t("meta.title");
  const description = t("meta.description");
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}${prefix}${PAGE_PATH}`,
      languages: {
        en: `${BASE_URL}${PAGE_PATH}`,
        es: `${BASE_URL}/es${PAGE_PATH}`,
        it: `${BASE_URL}/it${PAGE_PATH}`,
        "x-default": `${BASE_URL}${PAGE_PATH}`,
      },
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${BASE_URL}${prefix}${PAGE_PATH}`,
      images: [
        {
          url: `${BASE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: t("meta.ogAlt"),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${BASE_URL}/og-image.png`],
    },
  };
}

// City names stay English (proper nouns + SEO-stable across locales).
// Neighbourhood labels resolve per-locale via `routes.items.<key>.neighbourhood`.
const ROUTES = [
  { key: "lisbon", name: "Lisbon", days: "5", emoji: "🇵🇹" },
  { key: "barcelona", name: "Barcelona", days: "5", emoji: "🇪🇸" },
  { key: "berlin", name: "Berlin", days: "4", emoji: "🇩🇪" },
  { key: "prague", name: "Prague", days: "4", emoji: "🇨🇿" },
  { key: "budapest", name: "Budapest", days: "4", emoji: "🇭🇺" },
  { key: "athens", name: "Athens", days: "4", emoji: "🇬🇷" },
  { key: "bangkok", name: "Bangkok", days: "5", emoji: "🇹🇭" },
  { key: "tokyo", name: "Tokyo", days: "6", emoji: "🇯🇵" },
] as const;

const FEATURE_KEYS = [
  { key: "hostels", color: "bg-emerald-50 text-emerald-600", icon: "🎒" },
  { key: "walking", color: "bg-amber-50 text-amber-600", icon: "🚶" },
  { key: "food", color: "bg-rose-50 text-rose-600", icon: "🍜" },
  { key: "transit", color: "bg-blue-50 text-blue-600", icon: "🚆" },
  { key: "social", color: "bg-violet-50 text-violet-600", icon: "🍻" },
  { key: "overland", color: "bg-cyan-50 text-cyan-600", icon: "🗺️" },
] as const;

const STEP_KEYS = [
  { key: "toggle", n: "1" },
  { key: "generate", n: "2" },
  { key: "book", n: "3" },
] as const;

const FAQ_KEYS = [
  "different",
  "free",
  "vsHostelworld",
  "neighbourhoods",
  "multiCity",
  "comfort",
] as const;

export default async function BackpackerLandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "backpacker" });
  const prefix = locale === "en" ? "" : `/${locale}`;

  const breadcrumbItems = [
    { name: t("breadcrumbs.home"), url: `${BASE_URL}${prefix}` },
    { name: t("breadcrumbs.backpacker"), url: `${BASE_URL}${prefix}${PAGE_PATH}` },
  ];

  // Build FAQ entries for both the JSON-LD schema and the rendered list
  // from a single source of truth — keeps schema and DOM in sync.
  const faqItems = FAQ_KEYS.map((k) => ({
    question: t(`faq.items.${k}.question`),
    answer: t(`faq.items.${k}.answer`),
  }));

  const trustSignals = [
    t("hero.trustSignals.free"),
    t("hero.trustSignals.noSignup"),
    t("hero.trustSignals.fast"),
  ];

  // Social-proof stats (30-day Hostelworld clicks). Render the block
  // whenever the API responds — including the early-traffic window where
  // counts are small. Previously gated at clicks30d >= 10, which kept the
  // counter invisible for weeks after launch despite Task #133 wiring it
  // in (Day-6 audit caught the regression: no number ever reached the
  // DOM). The "don't show zero" intent is preserved at a lower bar — we
  // only hide if EVERY counter is genuinely zero, so we never advertise
  // "0 backpackers". Any non-zero signal is worth showing as proof the
  // funnel is live.
  const stats = await fetchHostelworldStats();
  const showStatsBlock =
    stats !== null &&
    (stats.clicks30d > 0 ||
      stats.uniqueTrips30d > 0 ||
      stats.uniqueVisitors30d > 0);

  // /explore Week 3 (2026-05-29): live backpacker trips for the
  // social-proof block below sample routes. Renders nothing when there
  // are no published trips yet — empty section would weaken the
  // partnership narrative more than its absence would.
  const backpackerFeed = await fetchBackpackerTrips();
  const backpackerTrips = backpackerFeed?.trips?.slice(0, 6) ?? [];

  // Locale-aware number formatting for the stats counters. en-US, es-ES,
  // it-IT all format thousands identically in the user-perceived sense
  // (10,234 vs 10.234) — picking the right one is just polish.
  const numberLocale =
    locale === "es" ? "es-ES" : locale === "it" ? "it-IT" : "en-US";

  const nonce = await getNonce();

  return (
    <>
      <script
        {...jsonLdScriptProps([
          generateFAQSchema(faqItems),
          generateBreadcrumbSchema(breadcrumbItems),
        ], nonce)}
      />

      <Navbar />

      <main className="min-h-screen">
        {/* ============== HERO ============== */}
        <section className="relative min-h-[70vh] pt-20 pb-16 overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-amber-50">
          <div className="absolute top-32 left-[10%] w-72 h-72 bg-emerald-400/10 rounded-full blur-[100px]" />
          <div className="absolute top-64 right-[5%] w-96 h-96 bg-amber-400/10 rounded-full blur-[120px]" />

          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-center min-h-[55vh] text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-8">
              <span className="text-lg" aria-hidden>🎒</span>
              <span className="text-sm font-semibold text-emerald-700">
                {t("hero.badge")}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 leading-[1.08] tracking-tight mb-6">
              {t("hero.titleLead")}{" "}
              <span className="text-emerald-600">{t("hero.titleHighlight")}</span>
            </h1>

            <p className="text-lg sm:text-xl text-slate-600 mb-10 max-w-2xl leading-relaxed">
              {t("hero.subtitle")}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <Link
                href="/trips/new?utm_source=hostelworld&utm_medium=backpacker_landing"
                className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/30"
              >
                <span aria-hidden>🎒</span>
                <span>{t("hero.ctaPrimary")}</span>
                <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <a
                href="#routes"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white border-2 border-slate-200 text-slate-700 font-semibold rounded-xl hover:border-emerald-500 hover:text-emerald-700 transition-all"
              >
                {t("hero.ctaSecondary")}
              </a>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-sm text-slate-600">
              {trustSignals.map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============== SOCIAL PROOF (live Hostelworld clicks) ============== */}
        {/* Render only when stats are meaningful (≥10 clicks in 30d) — see
            fetchHostelworldStats for "don't show zero" rationale.
            Numbers come straight from public.hostelworld_clicks. The
            Hostelworld partnership manager can quote this internally
            without us having to send a report. */}
        {showStatsBlock && stats && (
          <section className="py-12 bg-emerald-600 text-white">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
              <p className="text-center text-emerald-50 text-sm font-medium uppercase tracking-wider mb-6">
                {t("stats.label")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
                <div className="text-center">
                  <div className="text-4xl sm:text-5xl font-bold tabular-nums">
                    {stats.clicks30d.toLocaleString(numberLocale)}
                  </div>
                  <p className="mt-2 text-emerald-100 text-sm">
                    {t("stats.clicks")}
                  </p>
                </div>
                <div className="text-center">
                  <div className="text-4xl sm:text-5xl font-bold tabular-nums">
                    {stats.uniqueTrips30d.toLocaleString(numberLocale)}
                  </div>
                  <p className="mt-2 text-emerald-100 text-sm">
                    {t("stats.trips")}
                  </p>
                </div>
                <div className="text-center">
                  <div className="text-4xl sm:text-5xl font-bold tabular-nums">
                    {stats.uniqueVisitors30d.toLocaleString(numberLocale)}
                  </div>
                  <p className="mt-2 text-emerald-100 text-sm">
                    {t("stats.visitors")}
                  </p>
                </div>
              </div>
              <p className="text-center text-emerald-100/80 text-xs mt-6">
                {t("stats.footnote")}
              </p>
            </div>
          </section>
        )}

        {/* ============== FEATURES ============== */}
        <section className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                {t("features.title")}
              </h2>
              <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                {t("features.subtitle")}
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {FEATURE_KEYS.map((f) => (
                <div key={f.key} className="p-6 rounded-2xl border border-slate-200 hover:shadow-md transition-shadow">
                  <div className={`w-12 h-12 rounded-xl ${f.color} flex items-center justify-center mb-4 text-2xl`} aria-hidden>
                    {f.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    {t(`features.items.${f.key}.title`)}
                  </h3>
                  <p className="text-slate-600 leading-relaxed text-sm">
                    {t(`features.items.${f.key}.body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============== HOW IT WORKS ============== */}
        <section className="py-20 bg-slate-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                {t("howItWorks.title")}
              </h2>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {STEP_KEYS.map((step) => (
                <div key={step.n} className="bg-white rounded-2xl p-6 border border-slate-200 relative">
                  <div className="w-10 h-10 rounded-full bg-emerald-500 text-white font-bold text-lg flex items-center justify-center mb-4">
                    {step.n}
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    {t(`howItWorks.steps.${step.key}.title`)}
                  </h3>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    {t(`howItWorks.steps.${step.key}.body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============== SAMPLE ROUTES ============== */}
        <section id="routes" className="py-20 bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                {t("routes.title")}
              </h2>
              <p className="text-lg text-slate-600">
                {t("routes.subtitle")}
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {ROUTES.map((r) => (
                <Link
                  key={r.key}
                  href={"/trips/new?utm_source=hostelworld&utm_medium=backpacker_landing" as never}
                  className="group p-5 rounded-2xl border border-slate-200 hover:border-emerald-500 hover:shadow-md bg-white transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl" aria-hidden>{r.emoji}</span>
                    <span className="text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                      {t("routes.daysLabel", { days: r.days })}
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-slate-900 group-hover:text-emerald-700 transition-colors">
                    {r.name}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {t("routes.hostelZoneLabel", {
                      neighbourhood: t(`routes.items.${r.key}.neighbourhood`),
                    })}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ============== TRENDING BACKPACKER TRIPS ============== */}
        {/* /explore Week 3 (2026-05-29): live community trips filtered to
            Backpacker mode. Sits between sample routes and FAQ so visitors
            who liked the curated routes see proof other travelers actually
            use the product. Renders nothing on empty feed — see
            fetchBackpackerTrips rationale. */}
        {backpackerTrips.length > 0 && (
          <section className="py-20 bg-emerald-50/30 border-t border-emerald-100">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-10">
                <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">
                  {t("trendingTrips.title")}
                </h2>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  {t("trendingTrips.subtitle")}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                {backpackerTrips.map((trip) => (
                  <TripCard key={trip.id} trip={trip} variant="compact" />
                ))}
              </div>
              <div className="text-center mt-10">
                <Link
                  href={"/explore?travel_style=backpacker" as never}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white border border-emerald-200 text-emerald-700 font-semibold hover:bg-emerald-50 transition-all"
                >
                  {t("trendingTrips.browseAll")}
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* ============== FAQ ============== */}
        <section className="py-20 bg-slate-50">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
                {t("faq.title")}
              </h2>
            </div>
            <div className="space-y-3">
              {faqItems.map((item) => (
                <details key={item.question} className="group bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
                    <span className="font-semibold text-slate-900 pr-4">{item.question}</span>
                    <svg className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="px-5 pb-5 text-slate-600 leading-relaxed text-sm">
                    {item.answer}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ============== FINAL CTA ============== */}
        <section className="py-20 bg-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-12 sm:p-16 text-center text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-[100px]" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-amber-400/30 rounded-full blur-[80px]" />
              <div className="relative">
                <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
                  {t("finalCta.title")}
                </h2>
                <p className="text-lg text-emerald-50 mb-8 max-w-2xl mx-auto">
                  {t("finalCta.subtitle")}
                </p>
                <Link
                  href="/trips/new?utm_source=hostelworld&utm_medium=backpacker_landing"
                  className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-emerald-700 font-bold rounded-xl hover:bg-emerald-50 transition-all shadow-lg"
                >
                  <span aria-hidden>🎒</span>
                  {t("finalCta.button")}
                  <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
