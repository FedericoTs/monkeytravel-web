import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTripDestination } from "@/lib/trips/destination";
import { computeTripDayState } from "@/lib/trip/live";
import { cardFonts } from "@/lib/og/fonts";
import {
  CARD_SIZES,
  cardFormat,
  cardLocale,
  coverForCard,
  formatRange,
  renderBrandCard,
  renderTripCard,
  type CardDay,
  type CardFormat,
} from "@/lib/og/trip-card";

/**
 * The trip card as an image: the link preview (1200x630, the default), a
 * square and a story (lib/og/trip-card.tsx draws them).
 *
 * WHY THIS IS A ROUTE HANDLER AND NOT app/opengraph-image.tsx
 * ----------------------------------------------------------
 * The file convention is banned here, and lib/seo/og-image.ts says why: Next
 * merges metadata shallowly, so a page that declares its own `openGraph`
 * silently overrides the convention — and a previous attempt at
 * /opengraph-image and /twitter-image returned 404 in production even to
 * facebookexternalhit. Commit 565e9b2 recorded that and explicitly did not
 * diagnose it ("Reason for the 404 isn't worth debugging when a static file
 * works perfectly"), so the cause is still unknown.
 *
 * Rather than re-run that experiment, this lives under /api/, which
 * middleware.ts skips for i18n (shouldSkipIntl, `pathname.startsWith("/api/")`)
 * and which 39 other route groups already prove works in production. The page
 * references it as an explicit absolute URL, so nothing depends on convention
 * merging.
 *
 * WHY IT TAKES A KEY AND NOT TEXT
 * -------------------------------
 * Taking title/subtitle as query params would let anyone render arbitrary text
 * on a MonkeyTravel-branded card. The share token is the capability that
 * already grants public read of this trip, and the public slug names a trip
 * that is public by definition, so neither grants anything new, and the
 * numbers are read from the row rather than supplied by the caller — which
 * also means the card cannot drift from the page it advertises.
 */

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,120}$/i;

type TripRow = {
  id: string;
  title: string | null;
  trip_meta: unknown;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  itinerary: unknown;
  budget: { total?: number; currency?: string } | null;
};

function asDays(itinerary: unknown): CardDay[] {
  if (!Array.isArray(itinerary)) return [];
  return itinerary
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => ({
      day_number: Number(d.day_number),
      date: typeof d.date === "string" ? d.date : null,
      title: typeof d.title === "string" ? d.title : null,
      theme: typeof d.theme === "string" ? d.theme : null,
      city: typeof d.city === "string" ? d.city : null,
      activities: (Array.isArray(d.activities) ? d.activities : [])
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
        .map((a) => ({
          name: typeof a.name === "string" ? a.name : null,
          coordinates: (a.coordinates ?? null) as CardDay["activities"][number]["coordinates"],
        })),
    }))
    .filter((d) => Number.isFinite(d.day_number));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format: CardFormat = cardFormat(url.searchParams.get("format"));
  const locale = cardLocale(url.searchParams.get("locale"));
  const logo = `${url.origin}/icon-512.png`;
  const fonts = await cardFonts();
  const respond = (element: ReactElement, cacheControl: string) =>
    new ImageResponse(element, {
      ...CARD_SIZES[format],
      ...(fonts.length > 0 ? { fonts } : {}),
      headers: { "Cache-Control": cacheControl },
    });
  // Short cache for the brand card: a key can start resolving later (a trip
  // un-deleted, a replica catching up), and a year-long cache of the generic
  // card would outlive the reason for it.
  const fallback = () => respond(renderBrandCard(format, logo), "public, max-age=300");

  const token = url.searchParams.get("token");
  const slug = url.searchParams.get("slug");
  const supabase = createAdminClient();
  // deleted_at is re-asserted because service_role bypasses RLS entirely —
  // without it this would render deleted trips.
  let query = supabase
    .from("trips")
    .select("id, title, trip_meta, start_date, end_date, cover_image_url, itinerary, budget")
    .is("deleted_at", null);
  if (token && UUID_RE.test(token)) query = query.eq("share_token", token);
  else if (slug && SLUG_RE.test(slug)) query = query.eq("public_slug", slug);
  else return fallback();

  const { data, error } = await query.single<TripRow>();
  if (error || !data) return fallback();

  const destination = getTripDestination({ title: data.title, trip_meta: data.trip_meta });
  const days = asDays(data.itinerary);
  const activityCount = days.reduce((sum, d) => sum + d.activities.length, 0);

  // The stored currency, deliberately. The page converts into the VIEWER's
  // preferred currency client-side with live Frankfurter rates (useCurrency),
  // which a scraper has no equivalent of - there is no viewer at unfurl time.
  const budgetTotal = typeof data.budget?.total === "number" ? data.budget.total : null;
  const budget = budgetTotal && budgetTotal > 0 ? `${Math.round(budgetTotal)} ${data.budget?.currency || "USD"}` : null;

  // Nights is a date difference, not days - 1: SharedTripView's `nights` is
  // ceil((end - start) / 86400000), while days come from itinerary.length and
  // the two can disagree. This mirrors the page's formula.
  let nights: number | null = null;
  if (data.start_date && data.end_date) {
    const st = new Date(`${data.start_date}T00:00:00Z`).getTime();
    const en = new Date(`${data.end_date}T00:00:00Z`).getTime();
    if (!Number.isNaN(st) && !Number.isNaN(en) && en >= st) nights = Math.ceil((en - st) / 86_400_000);
  }

  // "N going" = active participants (the same count /shared shows). A HEAD
  // count query — no rows pulled — so it adds negligible cost to the unfurl.
  const { count } = await supabase
    .from("trip_participants")
    .select("*", { count: "exact", head: true })
    .eq("trip_id", data.id)
    .is("left_at", null);

  // Live state, in the trip's OWN timezone, so the card matches what a viewer
  // would see on Today. A trip without a stored zone reads as not-live.
  const meta = (data.trip_meta ?? null) as Record<string, unknown> | null;
  const tripTimeZone = typeof meta?.timezone === "string" ? meta.timezone : null;
  const dayState =
    data.start_date && data.end_date
      ? computeTripDayState({ startDate: data.start_date, endDate: data.end_date, timeZone: tripTimeZone })
      : null;
  let live: { dayNumber: number; totalDays: number; today: string | null } | null = null;
  if (dayState?.isLive && dayState.dayNumber) {
    const today = days.find((d) => d.day_number === dayState.dayNumber);
    const named = today?.activities.find((a) => a.name?.trim())?.name?.trim() ?? null;
    live = { dayNumber: dayState.dayNumber, totalDays: dayState.totalDays, today: named || today?.title?.trim() || null };
  }

  return respond(
    renderTripCard(
      {
        locale,
        destination,
        dates: formatRange(data.start_date, data.end_date, locale),
        days,
        cover: coverForCard(data.cover_image_url, url.origin),
        logo,
        goingCount: count ?? 0,
        activityCount,
        nights,
        budget,
        live,
      },
      format
    ),
    // Scrapers cache aggressively anyway; this keeps repeat unfurls off the
    // function. s-maxage is what Vercel's CDN reads.
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
  );
}
