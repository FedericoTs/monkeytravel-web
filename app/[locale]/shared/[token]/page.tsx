import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { logSharedTripVisit, CRAWLER_UA_RE } from "@/lib/analytics/funnel-events";
import { captureServerEvent } from "@/lib/posthog/server";
import { formatDateRange } from "@/lib/datetime";
import type { ItineraryDay, TripMeta } from "@/types";
import type { Metadata } from "next";
import SharedTripView from "./SharedTripView";
import TripEngagementSection from "@/components/explore/TripEngagementSection";
import { getTripDestination } from "@/lib/trips/destination";
import { refreshTripItinerary } from "@/lib/places/refreshItineraryPhotos";
import {
  generateTripSchema,
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import { getNonce } from "@/lib/security/nonce";
import { buildAlternates } from "@/lib/seo/canonical";

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

/**
 * Request-scoped cache for the trip lookup. Both `generateMetadata` and
 * the page render need the same row; without the cache wrapper Next.js
 * runs them as two separate Supabase queries per request. React's
 * `cache()` memoizes by the token argument for the lifetime of a single
 * request, so the second call resolves from the cached promise.
 *
 * 2026-05-30 perf pass: previously was generateMetadata SELECT (3 cols) +
 * page SELECT * (all cols), now one SELECT * shared. Net: -1 DB RTT per
 * shared-trip view (a top-traffic surface).
 */
const getSharedTrip = cache(async (token: string) => {
  // Service-role, keyed on the EXACT token — not the anon client.
  //
  // This page used to read through RLS, which worked only because the trips
  // SELECT policy carried a bare `OR (share_token IS NOT NULL)`. That clause
  // has no comparison against a caller-supplied token, so it made EVERY row
  // that merely HAS a share_token world-readable: measured 2026-09-01, an
  // unauthenticated caller holding the public browser key could list 118 trips,
  // 42 of them visibility='private', with full itinerary, notes, budget and
  // emergency_contacts. The anonymous-share loop shipped 2026-08-18 grew that
  // from 1 trip in March to 82 in August.
  //
  // Anonymous shared trips are deliberately visibility='private' (see
  // app/api/trips/anonymous/route.ts) — their readability comes from holding
  // the token, which is exactly what this function checks. Doing that check
  // here rather than in a policy predicate is what lets the policy drop the
  // blanket clause. Same pattern as app/api/calendar/trip/[id]/route.ts.
  //
  // `deleted_at IS NULL` is re-asserted explicitly: the policy used to supply
  // it, and service-role bypasses RLS entirely, so dropping it here would
  // resurrect deleted trips on a public URL.
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("share_token", token)
    .is("deleted_at", null)
    .single();
  if (error) return null;
  return data;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, token } = await params;
  const trip = await getSharedTrip(token);

  if (!trip) {
    return {
      title: "Trip Not Found",
      robots: { index: false, follow: false },
    };
  }

  // Canonical consolidation: /shared/{token} stays NOINDEX, but when the trip
  // is public and has a public_slug, point its canonical at the INDEXABLE
  // public page /trip/{slug} so any link equity /shared accrues (shares,
  // inbound links) flows to the URL we actually want ranked. Non-public trips
  // keep the self-canonical to /shared/{token}.
  const isPublic =
    trip.visibility === "public" &&
    !trip.is_hidden &&
    typeof trip.public_slug === "string" &&
    trip.public_slug;

  const canonical = isPublic
    ? buildAlternates(`/trip/${trip.public_slug}`, { locale }).canonical
    : `https://monkeytravel.app/shared/${token}`;

  return {
    title: trip.title,
    description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
    robots: { index: false, follow: false },
    alternates: {
      canonical,
    },
    // The preview card is now GENERATED from the trip rather than being the
    // raw cover photo. The photo alone said nothing about the trip: 43% of
    // shared trips carry a stock Pexels image, so the card that circulated in
    // a group chat was indistinguishable from any other travel link. The
    // generated one carries the same stat row the page hero shows - the
    // destination, the dates, "7D / 6N", the activity count and the budget -
    // which is the part worth sending.
    //
    // Unconditional on purpose: /api/og/trip always returns an image, falling
    // back to a brand card when the token resolves to nothing, so there is no
    // path where og:image disappears. That matters here because declaring an
    // openGraph block REPLACES the root layout's, and the old spread meant a
    // trip with no cover_image_url silently had no og:image at all.
    openGraph: {
      title: trip.title,
      description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
      type: "website",
      images: [
        {
          url: `https://monkeytravel.app/api/og/trip?token=${encodeURIComponent(token)}`,
          width: 1200,
          height: 630,
          alt: trip.title ?? "Trip itinerary",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: trip.title,
      description: trip.description || `Check out this travel itinerary on MonkeyTravel`,
      images: [`https://monkeytravel.app/api/og/trip?token=${encodeURIComponent(token)}`],
    },
  };
}

export default async function SharedTripPage({ params }: PageProps) {
  const { token } = await params;
  const trip = await getSharedTrip(token);

  if (!trip) {
    notFound();
  }

  // UX10X Phase 0.3: record a real human visit to the shared link (once per
  // server render, crawler-filtered inside the helper). This is the viral
  // loop's first measured hop — funnel_events.share_link_visited. NOT fired in
  // generateMetadata (which shares the same React.cache'd getSharedTrip and
  // would double-count). Fire-and-forget; never blocks the render.
  void logSharedTripVisit(trip.id as string);

  // Crew Loop PostHog twin of the funnel event above — same crawler filter so
  // the two counters stay comparable. Distinct id preference: authed user id
  // (rare on this anon-first page; getUser() is a local no-op without a
  // session cookie) → mt_anon_voter cookie (ties the visit to later
  // crew_vote_cast events) → a per-visit random id.
  //
  // WHY NOT A SHARED "anonymous" CONSTANT (the previous behaviour)
  //
  // Measured 2026-08-21: 189 of 251 visits in 30 days (75%) carried the
  // literal distinct_id "anonymous". That did two bad things at once — it
  // made uniq(person_id) report 19 for what was really hundreds of people,
  // and it merged unrelated strangers into a single PostHog person profile
  // that accumulated all of their properties.
  //
  // A per-visit random id fixes both. The tradeoff is deliberate and worth
  // stating: a returning visitor without the vote cookie now counts as a new
  // id each time, so uniques are an OVER-count where they used to be a wild
  // under-count. Visit and funnel-step counts are unaffected.
  //
  // The alternative — minting a stable visitor cookie on view — was rejected
  // on purpose. mt_anon_voter is a FUNCTIONAL cookie (one vote per browser);
  // setting an identifier merely to watch someone read a page makes it an
  // analytics cookie, and consent lives in localStorage (see
  // lib/consent/storage.ts), which the server cannot read. So there is no way
  // to honour a refusal here. Fewer stable ids is the correct default.
  //
  // Fire-and-forget like logSharedTripVisit; never blocks or breaks render.
  void (async () => {
    try {
      const h = await headers();
      const ua = h.get("user-agent") || "";
      if (CRAWLER_UA_RE.test(ua)) return;
      const cookieStore = await cookies();
      const anonVoterId = cookieStore.get("mt_anon_voter")?.value;
      // `visitor_scope` says how much this row's distinct_id can be trusted,
      // so a funnel can filter to the rows that actually support the question
      // it is asking. Never aggregate uniques across scopes.
      let distinctId = anonVoterId ?? `share-visit-${crypto.randomUUID()}`;
      let visitorScope: "user" | "cookie" | "per-visit" = anonVoterId
        ? "cookie"
        : "per-visit";
      try {
        const supabase = await createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user?.id) {
          distinctId = user.id;
          visitorScope = "user";
        }
      } catch {
        // stay anonymous
      }
      await captureServerEvent(distinctId, "crew_link_visited", {
        tripId: trip.id,
        shareToken: token,
        visitor_scope: visitorScope,
      });
    } catch {
      // never break the render for telemetry
    }
  })();

  // Read-time refresh of activity photo URLs from places_v2. Public
  // /shared/* surfaces had broken activity-card images when URLs baked
  // into trip.itinerary went stale — places_v2 has the canonical URL.
  // See lib/places/refreshItineraryPhotos.ts.
  const rawItinerary = (trip.itinerary as ItineraryDay[]) || [];
  const itinerary = await refreshTripItinerary(rawItinerary);
  const budget = trip.budget as { total: number; currency: string } | null;
  const tripMeta = (trip.trip_meta as TripMeta) || {};
  const packingList = (trip.packing_list as string[]) || tripMeta.packing_suggestions || [];

  // Extract cached travel distances from trip_meta (calculated locally, no API cost)
  const cachedTravelDistances = tripMeta.travel_distances;
  const cachedTravelHash = tripMeta.travel_distances_hash;

  // Prefer trip_meta.destination (canonical, set by wizard) — falls back
  // to title-strip. Matters for SEO: this string feeds the JSON-LD
  // tripSchema below, so a wrong value gets indexed by Google.
  const destination = getTripDestination(trip);

  // Generate structured data for SEO
  const tripUrl = `https://monkeytravel.app/shared/${token}`;
  const tripSchema = generateTripSchema({
    name: trip.title,
    description: trip.description,
    url: tripUrl,
    startDate: trip.start_date,
    endDate: trip.end_date,
    destination,
  });

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: "Home", url: "https://monkeytravel.app" },
    { name: "Shared Trips", url: "https://monkeytravel.app/shared" },
    { name: trip.title, url: tripUrl },
  ]);

  // **2026-05-25 (/explore Week 3)**: render the engagement bar above
  // the trip view so anon visitors can like/save/fork without scrolling.
  // The component no-ops if the explore flag is off OR the trip isn't
  // public yet (private trips don't get the engagement UI exposed).
  const isPublic = trip.visibility === "public" && !trip.is_hidden;

  const nonce = await getNonce();

  return (
    <>
      {/* Structured Data for SEO */}
      <script {...jsonLdScriptProps(tripSchema, nonce)} />
      <script {...jsonLdScriptProps(breadcrumbSchema, nonce)} />

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
        shareToken={token}
        dateRange={formatDateRange(trip.start_date, trip.end_date)}
        // Forward the persisted cover image so the hero renders the
        // actual photo for anon viewers instead of the gradient fallback.
        // The OpenGraph tag above already reads this — it's been in the
        // DB the whole time, just never threaded down to the client.
        coverImageUrl={trip.cover_image_url ?? null}
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
