import { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiSuccess, errors } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { isAnalyticsBot } from "@/lib/analytics/bot-detection";
import {
  VIEW_SESSION_COOKIE,
  clientIp,
  isUuid,
  parseTripViewSource,
  isOpenTrip,
  resolveViewSessionId,
  utcDay,
  verifiedSource,
} from "@/lib/analytics/trip-view";

/**
 * POST /api/trips/[id]/view — record that someone opened a trip.
 *
 * Phase 0.1 of docs/LIVE_TRIP_MASTER_PLAN.md. This route existed since the
 * /explore work and was never called by anything; trip_views had zero rows
 * when the plan was written. It is now fired on mount by the three
 * renderers — SharedTripView (source shared|public) and TripDetailClient
 * (owner|collaborator) — and is the source of the North Star, "Trips Opened
 * During Travel".
 *
 * Dedupe is the database's job: UNIQUE (trip_id, session_id, viewed_on).
 * A 23505 here means "already counted today", which is success. The session
 * key is the mt_session_id cookie the middleware sets — the same key
 * page_views uses, so the two tables join — or a one-way daily digest when
 * the cookie is absent (see lib/analytics/trip-view).
 *
 * Writes go through the service role (since 2026-09-23). The table used to
 * take inserts from the anon key directly, with only `trip_id IS NOT NULL`
 * checked, so anyone could write rows for any trip with any viewer_id,
 * source, day or bot flag and forge the North Star. 20260924121000 closes
 * the table to anon/authenticated, which makes this route the only writer,
 * so the checks the policy never made happen here:
 *   - the trip must exist and not be deleted;
 *   - a private trip with no share link only counts for its owner or a
 *     collaborator;
 *   - "owner" and "collaborator" are only accepted when true; a stranger
 *     claiming them is recorded as what they are (public or shared).
 * viewer_id is whoever is signed in, or null. Every rejection answers the
 * same way as an unknown trip, so this is not an existence oracle.
 *
 * Never throws at the client. Analytics must not affect the visitor.
 */

// A person opens a handful of trips per minute at most; a loop of curl does
// not. 60/min/IP is generous for humans and bites only scripts.
const viewLimiter = createRateLimiter("trip-view", 60, 60_000);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return errors.badRequest("Invalid trip id");
    }

    const { allowed } = await viewLimiter.check(request);
    if (!allowed) {
      return errors.rateLimit("Too many view events");
    }

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const source = parseTripViewSource((body as { source?: unknown } | null)?.source);
    if (!source) {
      return errors.badRequest("Invalid source");
    }

    const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
    const userAgent = headerList.get("user-agent");
    const { sessionId, fromCookie } = resolveViewSessionId(
      cookieStore.get(VIEW_SESSION_COOKIE)?.value,
      clientIp(headerList.get("x-forwarded-for")),
      userAgent,
    );

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const admin = createAdminClient();
    const { data: trip } = await admin
      .from("trips")
      .select("id, user_id, visibility, share_token, is_hidden, deleted_at")
      .eq("id", id)
      .maybeSingle();
    if (!trip || trip.deleted_at) {
      return apiSuccess({ recorded: false, fromCookie });
    }

    const isOwner = !!user && trip.user_id === user.id;
    let isCollaborator = false;
    if (user && !isOwner && (source === "collaborator" || !isOpenTrip(trip))) {
      const { count } = await admin
        .from("trip_collaborators")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", id)
        .eq("user_id", user.id);
      isCollaborator = (count ?? 0) > 0;
    }
    if (!isOpenTrip(trip) && !isOwner && !isCollaborator) {
      return apiSuccess({ recorded: false, fromCookie });
    }

    const { error } = await admin.from("trip_views").insert({
      trip_id: id,
      viewer_id: user?.id ?? null,
      source: verifiedSource(source, trip, isOwner, isCollaborator),
      session_id: sessionId,
      viewed_on: utcDay(),
      is_bot: isAnalyticsBot(userAgent),
    });

    if (error) {
      // 23505 unique_violation: this session already opened this trip today.
      if (error.code === "23505") {
        return apiSuccess({ recorded: false, duplicate: true, fromCookie });
      }
      // 23503 foreign_key_violation (unknown trip) and anything else: say
      // nothing distinguishing — this endpoint must not be an existence oracle.
      if (error.code !== "23503") {
        console.error("[trip-view] insert failed", error.code, error.message);
      }
      return apiSuccess({ recorded: false, fromCookie });
    }

    return apiSuccess({ recorded: true, fromCookie });
  } catch (err) {
    console.error("[trip-view] unexpected", err);
    return apiSuccess({ recorded: false });
  }
}
