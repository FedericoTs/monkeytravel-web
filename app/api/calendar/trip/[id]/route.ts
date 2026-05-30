/**
 * GET /api/calendar/trip/[id] — one-shot iCal download for a single trip.
 *
 * Companion to the subscription feed at /api/calendar/[user_hmac]. The
 * feed is for "keep my calendar in sync"; this route is the one-click
 * "download .ics and double-click it into Apple Calendar / Outlook /
 * Fantastical" path. Browser sees Content-Disposition: attachment and
 * triggers a download; the OS hands the file to the default calendar
 * client which imports the VEVENTs.
 *
 * Access paths (ANY of):
 *   1. Trip owner (authenticated, owns trips.user_id).
 *   2. Trip collaborator (editor / voter / viewer role).
 *   3. Public share-token holder — pass `?token=<share_token>`. Mirrors
 *      the /shared/[token] page semantics so anyone with the link can
 *      add the trip to their calendar without signing in.
 *
 * NOT a feature-flag gate:
 *   The UI button is gated by `NEXT_PUBLIC_CALENDAR_EXPORT_ENABLED`.
 *   This endpoint stays open even if the flag is flipped off — a user
 *   who already downloaded an .ics and re-runs the URL from their
 *   browser history shouldn't get a 404. The kill-switch is in the UI.
 *
 * Rate limit:
 *   30 requests/min/IP. A download is a deliberate click, not a poll;
 *   30/min is plenty of headroom for "I clicked the wrong button" and
 *   still cuts off scripted abuse.
 *
 * Runtime: nodejs. Reasons:
 *   - service-role Supabase client is used on the share-token path
 *     (RLS would otherwise hide the trip from an anonymous request).
 *   - `lib/calendar/ical.ts` is pure JS, runtime-agnostic.
 *
 * CAUSALITY:
 *   - NEW route. No existing callers.
 *   - Reuses lib/calendar/ical.ts (Phase 1A) + lib/calendar/trip-to-events.ts
 *     (Phase 1B). Same VEVENT shape the subscription feed emits, so a
 *     user who imports the .ics today and subscribes tomorrow won't get
 *     duplicate events (UID is stable: act-<tripId>-<dayIdx>-<actIdx>).
 *   - The UI integration (button on /trips/[id]) is handled by a
 *     parallel agent and lives outside this file.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildIcal } from "@/lib/calendar/ical";
import { tripToIcalEvents } from "@/lib/calendar/trip-to-events";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TripRouteContext } from "@/lib/api/route-context";

export const runtime = "nodejs";
// Personalised body keyed off auth state + (optional) share token —
// never cache at the framework layer.
export const dynamic = "force-dynamic";

const ICS_CONTENT_TYPE = "text/calendar; charset=utf-8";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 30 downloads/min/IP. See module header for rationale.
const rateLimiter = createRateLimiter("calendar-download", 30, 60_000);

function notFound() {
  // Plain text body so curl users get something useful; status is what
  // matters for the browser download flow.
  return new NextResponse("Trip not found", { status: 404 });
}

function tooManyRequests() {
  return new NextResponse("Rate limit exceeded", {
    status: 429,
    headers: { "Retry-After": "60" },
  });
}

function serverError() {
  return new NextResponse("Internal Server Error", { status: 500 });
}

/**
 * URL-safe filename slug from a trip title. Strips anything outside
 * `[a-z0-9-]`, collapses runs of `-`, trims leading/trailing `-`, and
 * caps at 40 chars so the final filename stays under common 64-byte
 * filesystem limits even with the suffix + UUID short.
 */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    // Strip the combining-marks block (U+0300..U+036F) left over from
    // NFKD decomposition so "Café" → "cafe", not "caf-".
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "trip";
}

type TripRow = {
  id: string;
  user_id: string;
  title: string | null;
  itinerary: unknown;
  share_token: string | null;
  is_archived: boolean | null;
};

/**
 * Look up the trip with the right client based on access path.
 *
 * - share_token present → use service-role (RLS would block anon reads
 *   of someone else's row; the token IS the auth here).
 * - share_token absent  → use the request-bound SSR client + the
 *   existing verifyTripAccess pattern (owner OR collaborator).
 *
 * Returns null on any failure mode — caller responds with 404. We log
 * the underlying error for server-side debugging but never leak the
 * reason in the response (don't differentiate "doesn't exist" from
 * "you're not allowed" — prevents enumeration).
 */
async function loadTrip(
  request: NextRequest,
  tripId: string
): Promise<TripRow | null> {
  const url = new URL(request.url);
  const shareToken = url.searchParams.get("token");

  // ---- Path 1: share-token access (anonymous, no auth required) ----
  if (shareToken) {
    if (!UUID_RE.test(shareToken)) return null;
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("trips")
      .select("id, user_id, title, itinerary, share_token, is_archived")
      .eq("id", tripId)
      .eq("share_token", shareToken)
      .maybeSingle();
    if (error) {
      console.error("[calendar-download] share-token lookup failed:", error);
      return null;
    }
    if (!data) return null;
    if (data.is_archived) return null;
    return data as TripRow;
  }

  // ---- Path 2: authenticated user (owner or collaborator) ----
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;

  // Owner check first (cheapest — single eq query). We can't use
  // verifyTripAccess() directly because its return shape ties us to
  // the response-wrapper error path, and we want a uniform 404 here.
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, user_id, title, itinerary, share_token, is_archived")
    .eq("id", tripId)
    .maybeSingle();

  if (tripError) {
    console.error("[calendar-download] trip lookup failed:", tripError);
    return null;
  }
  if (!trip) return null;
  if (trip.is_archived) return null;

  const typedTrip = trip as TripRow;
  if (typedTrip.user_id === user.id) return typedTrip;

  // Not the owner — check collaborator role. Any role grants read
  // access (the calendar is read-only data anyway).
  const { data: collab } = await supabase
    .from("trip_collaborators")
    .select("role")
    .eq("trip_id", tripId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!collab) return null;
  return typedTrip;
}

export async function GET(request: NextRequest, ctx: TripRouteContext) {
  // 1. Rate-limit before any DB work.
  const limit = await rateLimiter.check(request);
  if (!limit.allowed) return tooManyRequests();

  // 2. Validate the trip id format up front. UUIDs only — cheap reject
  //    of random scanner traffic.
  const { id: tripId } = await ctx.params;
  if (typeof tripId !== "string" || !UUID_RE.test(tripId)) {
    return notFound();
  }

  // 3. Authorize + load the trip.
  let trip: TripRow | null;
  try {
    trip = await loadTrip(request, tripId);
  } catch (err) {
    console.error("[calendar-download] loadTrip threw:", err);
    return serverError();
  }
  if (!trip) return notFound();

  // 4. Build the iCal.
  let body: string;
  try {
    const events = tripToIcalEvents({
      id: trip.id,
      title: trip.title ?? "Trip",
      itinerary: trip.itinerary,
    });
    body = buildIcal(events, {
      calName: trip.title ?? "monkeytravel — Trip",
      productId: "-//MonkeyTravel//Trip Export//EN",
    });
  } catch (err) {
    console.error("[calendar-download] build failed for trip", tripId, err);
    return serverError();
  }

  // 5. Filename: `<slug>-<first-8-of-uuid>.ics`. Keeps it human-
  //    readable AND collision-resistant when the same person exports
  //    several trips with similar titles ("Lisbon 2026" twice).
  const filename = `trip-${slugify(trip.title ?? "")}-${tripId.slice(0, 8)}.ics`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": ICS_CONTENT_TYPE,
      // `attachment` is what makes the browser download instead of
      // rendering. The filename* form would let us send a UTF-8 name,
      // but our slug is already ASCII-only by construction.
      "Content-Disposition": `attachment; filename="${filename}"`,
      // No-cache: trip data changes whenever the user edits — a stale
      // download a minute later is a worse UX than re-fetching.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
