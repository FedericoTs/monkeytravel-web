import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateRange } from "@/lib/datetime";
import type { ItineraryDay, TripMeta } from "@/types";
import SharedTripView from "../../shared/[token]/SharedTripView";
import TripEngagementSection from "@/components/explore/TripEngagementSection";
import { getTripDestination } from "@/lib/trips/destination";
import { refreshTripItinerary } from "@/lib/places/refreshItineraryPhotos";
import {
  generateTripSchema,
  generateBreadcrumbSchema,
  generatePersonSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { buildAlternates } from "@/lib/seo/canonical";
import { getNonce } from "@/lib/security/nonce";

const SITE_URL = "https://monkeytravel.app";

/**
 * /trip/[slug] — the PUBLIC, INDEXABLE trip page.
 *
 * This is the Wanderlog-playbook surface: a stable, crawlable URL per
 * published community trip that earns organic search traffic. It reuses the
 * exact same renderer as /shared/[token] (SharedTripView) but differs in
 * three load-bearing ways:
 *
 *   1. Addressed by `trips.public_slug` (stable, human-readable) rather than
 *      `share_token` (a private capability token that must stay noindex).
 *   2. `robots.index = true` — this URL is MADE to be found. (/shared is
 *      noindex; its canonical points HERE to consolidate link equity.)
 *   3. Fetched via the admin client with an explicit column allowlist, and
 *      guarded by the published predicate — only genuinely public trips
 *      render; anything else 404s.
 *
 * Published predicate (must match everywhere):
 *   visibility='public' AND coalesce(is_hidden,false)=false
 *   AND deleted_at IS NULL AND public_slug IS NOT NULL
 */

// ISR: revalidate hourly. Community trips change rarely once published, but
// engagement counts + itinerary photo refresh benefit from periodic
// regeneration. Matches the 3600s cache cadence used by the feeds/blog.
export const revalidate = 3600;

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

/** Public-safe author columns. NEVER widen this to email / payment handles. */
const AUTHOR_COLS = "username, display_name, avatar_url, bio, privacy_settings";

interface PublicAuthor {
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isPublic: boolean;
}

/**
 * Request-scoped cache for the trip lookup. `generateMetadata` and the page
 * render both need the same row + author; React's `cache()` memoizes by the
 * slug argument for the lifetime of a single request so we issue one pair of
 * queries, not two. Mirrors the /shared page's `getSharedTrip` pattern.
 */
const getPublicTrip = cache(async (slug: string) => {
  const supabase = createAdminClient();

  const { data: trip, error } = await supabase
    .from("trips")
    .select("*")
    .eq("public_slug", slug)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !trip) return null;

  // Enforce the rest of the published predicate in code (is_hidden may be
  // null on legacy rows; coalesce to false).
  if (trip.is_hidden === true) return null;
  if (!trip.public_slug) return null;

  // Resolve the author separately (allowlist columns only). A missing/failed
  // author lookup must NOT 404 the trip — the page still renders, just
  // without the author byline + Person node.
  let author: PublicAuthor | null = null;
  if (trip.user_id) {
    const { data: userRow } = await supabase
      .from("users")
      .select(AUTHOR_COLS)
      .eq("id", trip.user_id)
      .maybeSingle();

    if (userRow) {
      const priv = (userRow.privacy_settings ?? {}) as Record<string, unknown>;
      const isPrivate = String(priv.privateProfile ?? "") === "true";
      author = {
        username: (userRow.username as string | null) ?? null,
        displayName: (userRow.display_name as string | null) ?? null,
        avatarUrl: (userRow.avatar_url as string | null) ?? null,
        isPublic: !isPrivate,
      };
    }
  }

  return { trip, author };
});

/** Count total activities across the itinerary — feeds the thin-content guard. */
function countActivities(itinerary: ItineraryDay[]): number {
  return itinerary.reduce(
    (sum, day) => sum + (Array.isArray(day.activities) ? day.activities.length : 0),
    0,
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common.publicTrip" });

  const result = await getPublicTrip(slug);
  if (!result) {
    return {
      title: t("notFoundTitle"),
      robots: { index: false, follow: false },
    };
  }

  const { trip } = result;
  const destination = getTripDestination(trip);
  const rawItinerary = (trip.itinerary as ItineraryDay[]) || [];

  // Thin-content guard: pages with almost no itinerary content get
  // classified "Crawled — currently not indexed" and drag down site
  // quality. Below the threshold we still RENDER (a human with the link
  // sees it) but tell Google not to index. 4 activities ≈ one real day.
  const activityCount = countActivities(rawItinerary);
  const indexable = activityCount >= 4;

  const { canonical, languages } = buildAlternates(`/trip/${slug}`, { locale });

  const title = t("metaTitle", { destination, title: trip.title });
  const description =
    trip.description ||
    t("metaDescriptionFallback", { destination });
  const cover = (trip.cover_image_url as string | null) ?? undefined;

  return {
    title,
    description,
    robots: { index: indexable, follow: true },
    alternates: { canonical, languages },
    openGraph: {
      title,
      description,
      type: "article",
      url: canonical,
      ...(cover && {
        images: [{ url: cover, width: 1200, height: 630, alt: trip.title }],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(cover && { images: [cover] }),
    },
  };
}

export default async function PublicTripPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common.publicTrip" });

  const result = await getPublicTrip(slug);
  if (!result) {
    notFound();
  }

  const { trip, author } = result;

  // Read-time itinerary photo refresh (same as /shared) — replaces stale
  // baked-in activity image URLs with the canonical ones from places_v2.
  const rawItinerary = (trip.itinerary as ItineraryDay[]) || [];
  const itinerary = await refreshTripItinerary(rawItinerary);

  const budget = trip.budget as { total: number; currency: string } | null;
  const tripMeta = (trip.trip_meta as TripMeta) || {};
  const packingList =
    (trip.packing_list as string[]) || tripMeta.packing_suggestions || [];
  const cachedTravelDistances = tripMeta.travel_distances;
  const cachedTravelHash = tripMeta.travel_distances_hash;

  const destination = getTripDestination(trip);

  // ---- Structured data ----------------------------------------------------
  const tripUrl = buildAlternates(`/trip/${slug}`, { locale }).canonical;

  const tripSchema = generateTripSchema({
    name: trip.title,
    description: trip.description,
    url: tripUrl,
    startDate: trip.start_date,
    endDate: trip.end_date,
    destination,
    image: (trip.cover_image_url as string | null) ?? undefined,
    datePublished: (trip.shared_at as string | null) ?? undefined,
    inLanguage: locale,
    // Enriched: real per-day itinerary → nested ItemList of TouristAttraction.
    days: itinerary,
  });

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: t("breadcrumbHome"), url: `${SITE_URL}` },
    { name: t("breadcrumbExplore"), url: `${SITE_URL}/explore` },
    { name: destination, url: tripUrl },
    { name: trip.title, url: tripUrl },
  ]);

  // Author Person node — only when the creator is public (not privateProfile)
  // and has a username to link to. Links the trip to its creator profile,
  // reinforcing the internal-link graph Google uses for authorship signals.
  const authorSchema =
    author && author.isPublic && author.username
      ? generatePersonSchema({
          name: author.displayName || t("anonymousTraveler"),
          url: `${SITE_URL}/creator/${author.username}`,
          ...(author.avatarUrl ? { image: author.avatarUrl } : {}),
        })
      : null;

  const isPublic = trip.visibility === "public" && !trip.is_hidden;

  const nonce = await getNonce();

  return (
    <>
      <script {...jsonLdScriptProps(tripSchema, nonce)} />
      <script {...jsonLdScriptProps(breadcrumbSchema, nonce)} />
      {authorSchema && <script {...jsonLdScriptProps(authorSchema, nonce)} />}

      <SharedTripView
        trip={{
          id: trip.id,
          title: trip.title,
          description: trip.description,
          status: trip.status,
          startDate: trip.start_date,
          endDate: trip.end_date,
          tags: trip.tags,
          budget,
          itinerary,
          sharedAt: trip.shared_at,
          meta: tripMeta,
          packingList,
          cachedTravelDistances,
          cachedTravelHash,
        }}
        // SharedTripView keys client-side share/save behaviour off the
        // share_token; pass it through so "copy link"/save flows keep working
        // for a visitor who landed on the public URL.
        shareToken={trip.share_token ?? ""}
        dateRange={formatDateRange(trip.start_date, trip.end_date)}
        coverImageUrl={(trip.cover_image_url as string | null) ?? null}
        engagementSlot={
          <TripEngagementSection
            tripId={trip.id}
            likeCount={trip.like_count ?? 0}
            saveCount={trip.save_count ?? 0}
            forkCount={trip.fork_count ?? 0}
            isPublic={isPublic}
          />
        }
      />
    </>
  );
}
