import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import MobileBottomNav from "@/components/ui/MobileBottomNav";
import { PullToRefreshWrapper } from "@/components/ui/PullToRefreshWrapper";
import { Link } from "@/lib/i18n/routing";
import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import TripCard from "@/components/explore/TripCard";
import type { ExploreTripCard } from "@/lib/explore/types";
import { isExploreUgcEnabled } from "@/lib/explore/flag";

const BASE_URL = "https://monkeytravel.app";
const COOKIE_NAME = "mt_saver_cookie";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common.savedPage" });
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    robots: { index: false, follow: false },
  };
}

/**
 * /saved — bookmarked trips list.
 *
 * Reads from trip_saves keyed by:
 *   - auth.uid() when the visitor is logged in
 *   - mt_saver_cookie when anon
 *
 * Anon path uses the service-role client because RLS would reject a
 * JWT-less read on behalf of a cookie. We carefully filter to ONLY
 * the rows tagged with the caller's specific cookie id to prevent
 * leakage across anon visitors.
 *
 * Robots: noindex (this is a personal list, not a marketing surface).
 */

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type TripRow = {
  id: string;
  title: string;
  description: string | null;
  share_token: string;
  cover_image_url: string | null;
  tags: string[] | null;
  start_date: string;
  end_date: string;
  shared_at: string | null;
  trending_score: number;
  view_count: number;
  template_copy_count: number;
  like_count: number;
  save_count: number;
  fork_count: number;
  author_display_name: string | null;
  author_note: string | null;
  is_editors_pick: boolean;
  travel_style: "classic" | "backpacker" | null;
  trip_meta: Record<string, unknown> | null;
  visibility: string;
  is_hidden: boolean;
};

function mapRowToCard(t: TripRow): ExploreTripCard {
  const meta = (t.trip_meta ?? {}) as Record<string, unknown>;
  const durationDays =
    Math.ceil(
      (new Date(t.end_date).getTime() - new Date(t.start_date).getTime()) /
        86_400_000
    ) + 1;
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    shareToken: t.share_token,
    destination: (meta.destination as string) ?? t.title,
    countryCode: (meta.country_code as string) ?? null,
    durationDays,
    coverImage: t.cover_image_url,
    tags: t.tags ?? [],
    budgetTier: (meta.budget_tier as string) ?? "balanced",
    trendingScore: t.trending_score ?? 0,
    viewCount: t.view_count ?? 0,
    copyCount: t.template_copy_count ?? 0,
    likeCount: t.like_count ?? 0,
    saveCount: t.save_count ?? 0,
    forkCount: t.fork_count ?? 0,
    author: { displayName: t.author_display_name ?? "Anonymous traveler" },
    authorNote: t.author_note,
    isEditorsPick: !!t.is_editors_pick,
    travelStyle: t.travel_style === "backpacker" ? "backpacker" : "classic",
    sharedAt: t.shared_at,
  };
}

export default async function SavedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common.savedPage" });

  // NOTE: don't manually concat /${locale} into hrefs — `Link` is
  // next-intl's locale-aware variant (createNavigation from
  // @/lib/i18n/routing) and auto-prepends the current locale.
  // Day-3 backtest caught this: a previous version computed a
  // localePrefix and used it in the empty-state CTA, which produced
  // /it/it/explore → 404 on Italian.
  const flagOn = isExploreUgcEnabled();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Identify saver: cookie for anon, user_id for auth.
  const cookieStore = await cookies();
  const cookieId = cookieStore.get(COOKIE_NAME)?.value ?? null;

  let savedTrips: ExploreTripCard[] = [];
  let queryError: string | null = null;

  // Only run queries when the feature is reachable AND the visitor
  // has some way for us to look them up.
  if (flagOn && (user || cookieId)) {
    // Step 1: trip_ids the visitor saved
    let savedTripIds: string[] = [];
    if (user) {
      const r = await supabase
        .from("trip_saves")
        .select("trip_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (r.error) queryError = r.error.message;
      else savedTripIds = (r.data ?? []).map((s) => s.trip_id);
    } else if (cookieId) {
      // Anon: service-role client because RLS rejects anon reads of
      // trip_saves rows by cookie. We narrow to the caller's cookie
      // id only — no cross-visitor leakage possible.
      const svc = serviceClient();
      if (svc) {
        const r = await svc
          .from("trip_saves")
          .select("trip_id, created_at")
          .eq("saver_cookie_id", cookieId)
          .order("created_at", { ascending: false });
        if (r.error) queryError = r.error.message;
        else savedTripIds = (r.data ?? []).map((s) => s.trip_id);
      }
    }

    // Step 2: hydrate the trips (public + visible only — saved trips
    // that have been un-published or hidden drop off the list).
    if (savedTripIds.length > 0) {
      const r = await supabase
        .from("trips")
        .select(
          `id, title, description, share_token, cover_image_url, tags,
           start_date, end_date, shared_at, trending_score, view_count,
           template_copy_count, like_count, save_count, fork_count,
           author_display_name, author_note, is_editors_pick, travel_style,
           trip_meta, visibility, is_hidden`
        )
        .in("id", savedTripIds)
        .eq("visibility", "public")
        .eq("is_hidden", false);
      if (r.error) queryError = r.error.message;
      else {
        // Preserve save order from step 1.
        const order = new Map(savedTripIds.map((id, i) => [id, i]));
        const rows = (r.data ?? []) as TripRow[];
        savedTrips = rows
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
          .map(mapRowToCard);
      }
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Navbar />
      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 sm:py-12 w-full">
        <nav className="text-sm text-slate-500 mb-4" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-slate-700">
            {t("breadcrumb.home")}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{t("breadcrumb.saved")}</span>
        </nav>

        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3 tracking-tight">
          {t("title")}
        </h1>
        <p className="text-lg text-slate-600 mb-8">
          {user ? t("description") : t("descriptionAnon")}
        </p>

        {!flagOn && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-8 text-center">
            <p className="text-slate-700">{t("comingSoon")}</p>
          </div>
        )}

        {flagOn && queryError && (
          <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-sm text-rose-700">
            {t("loadError")}
          </div>
        )}

        {flagOn && !queryError && savedTrips.length === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📌</div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">
              {t("empty.title")}
            </h2>
            <p className="text-slate-600 mb-6">{t("empty.body")}</p>
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[var(--primary)] text-white font-semibold hover:opacity-90 transition-all shadow-sm"
            >
              {t("browseTrips")}
            </Link>
          </div>
        )}

        {flagOn && savedTrips.length > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
            {savedTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        )}

        {flagOn && savedTrips.length > 0 && !user && (
          <div className="mt-10 rounded-xl bg-slate-50 border border-slate-200 p-5 text-sm text-slate-700 max-w-xl">
            <strong>{t("anonNudge.label")}</strong> {t("anonNudge.body")}
          </div>
        )}
      </main>
      <Footer />
      <p className="sr-only">Site: {BASE_URL}</p>

      {/* Native polish layer — pull-to-refresh on the saved-trips list
          and the bottom tab bar matching /trips + /explore + /profile.
          Both are sm:hidden / touch-gated so desktop web is unaffected. */}
      <PullToRefreshWrapper />
      <MobileBottomNav activePage="saved" />
    </div>
  );
}
