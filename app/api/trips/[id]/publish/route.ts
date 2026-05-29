import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { isExploreUgcEnabled } from "@/lib/explore/flag";
import { captureServerEvent } from "@/lib/posthog/server";
import { randomUUID } from "node:crypto";

/**
 * POST /api/trips/[id]/publish — owner opts a trip into the public
 * /explore catalog.
 *
 * Body:
 *   - authorDisplayName?: string (max 80)
 *   - authorNote?: string (max 280)
 *
 * Effect:
 *   - visibility -> 'public'
 *   - shared_at set if missing (so the trending recency boost starts now)
 *   - share_token minted if missing (so /shared/[token] resolves)
 *   - submitted_to_trending_at set (joins the explore feed)
 *   - author_display_name / author_note persisted if supplied
 *
 * Anti-spam guards (refuse to publish if):
 *   - itinerary has < 3 activities total
 *   - duration > 30 days
 *   - user has > 10 trips published in last 7 days
 *   (the "trip must be N hours old" gate was removed 2026-05-28 to
 *   unblock the post-save auto-prompt — see MIN_TRIP_AGE_HOURS below)
 *
 * DELETE = unpublish: visibility -> 'private', is_hidden untouched
 * (only moderators flip is_hidden).
 */

type RouteCtx = { params: Promise<{ id: string }> };

const MAX_PUBLISHED_PER_WEEK = 10;
/**
 * Originally 48h to give users time to edit before going public. Relaxed
 * to 0 on 2026-05-28 so the post-save auto-prompt can actually publish
 * (the prompt fires seconds after save — a 48h gate would always reject).
 *
 * Anti-spam is still well-defended by the remaining guards:
 *   - MIN_ACTIVITIES (≥3) — generated trips always pass; empty drafts don't
 *   - MAX_DURATION_DAYS (≤30) — caps fork-bombs
 *   - MAX_PUBLISHED_PER_WEEK (≤10) — caps a single user's spam
 * Plus publishing is reversible (DELETE on this same route) and the
 * publish modal requires explicit user click + optional author note,
 * so it's a conscious opt-in rather than an automatic flip.
 *
 * Raise back to 24-48 if we see drive-by spam in production.
 */
const MIN_TRIP_AGE_HOURS = 0;
const MIN_ACTIVITIES = 3;
const MAX_DURATION_DAYS = 30;
const MAX_AUTHOR_NAME = 80;
const MAX_AUTHOR_NOTE = 280;

export async function POST(request: NextRequest, { params }: RouteCtx) {
  if (!isExploreUgcEnabled()) return errors.notFound("Not Found");

  const { id: tripId } = await params;
  if (!tripId) return errors.badRequest("Trip id required");

  const { user, supabase, errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return errorResponse;

  const body = await request.json().catch(() => ({}));
  const authorDisplayName =
    typeof body?.authorDisplayName === "string"
      ? body.authorDisplayName.trim().slice(0, MAX_AUTHOR_NAME) || null
      : null;
  const authorNote =
    typeof body?.authorNote === "string"
      ? body.authorNote.trim().slice(0, MAX_AUTHOR_NOTE) || null
      : null;

  // Load + ownership check.
  const { data: trip, error: lookupErr } = await supabase
    .from("trips")
    .select(
      "id, user_id, visibility, share_token, created_at, itinerary, start_date, end_date"
    )
    .eq("id", tripId)
    .single();
  if (lookupErr || !trip) return errors.notFound("Trip not found");
  if (trip.user_id !== user.id) {
    return errors.forbidden("Only the trip owner can publish");
  }

  // Anti-spam: trip age.
  const ageHours =
    (Date.now() - new Date(trip.created_at).getTime()) / 3_600_000;
  if (ageHours < MIN_TRIP_AGE_HOURS) {
    return errors.badRequest(
      `Trip must be at least ${MIN_TRIP_AGE_HOURS} hours old before publishing`
    );
  }

  // Anti-spam: itinerary depth.
  const totalActivities = (trip.itinerary ?? []).reduce(
    (n: number, d: { activities?: unknown[] }) => n + (d.activities?.length ?? 0),
    0
  );
  if (totalActivities < MIN_ACTIVITIES) {
    return errors.badRequest(
      `Trips need at least ${MIN_ACTIVITIES} activities to be published`
    );
  }

  // Anti-spam: duration cap.
  const durationDays =
    trip.start_date && trip.end_date
      ? Math.ceil(
          (new Date(trip.end_date).getTime() -
            new Date(trip.start_date).getTime()) /
            86_400_000
        ) + 1
      : (trip.itinerary?.length ?? 0);
  if (durationDays > MAX_DURATION_DAYS) {
    return errors.badRequest(
      `Trips longer than ${MAX_DURATION_DAYS} days can't be published yet`
    );
  }

  // Anti-spam: per-user publish rate.
  const oneWeekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count: recentPublishes } = await supabase
    .from("trips")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("visibility", "public")
    .gte("shared_at", oneWeekAgo);
  if ((recentPublishes ?? 0) >= MAX_PUBLISHED_PER_WEEK) {
    return errors.badRequest(
      `You can publish up to ${MAX_PUBLISHED_PER_WEEK} trips per week`
    );
  }

  // Flip visibility + stamp metadata.
  const update: Record<string, unknown> = {
    visibility: "public",
    submitted_to_trending_at: new Date().toISOString(),
  };
  if (!trip.share_token) update.share_token = randomUUID();
  // shared_at acts as the recency boost anchor. Set on first publish only.
  update.shared_at = new Date().toISOString();
  if (authorDisplayName !== null) update.author_display_name = authorDisplayName;
  if (authorNote !== null) update.author_note = authorNote;

  const { data: updated, error: updateErr } = await supabase
    .from("trips")
    .update(update)
    .eq("id", tripId)
    .select("id, share_token")
    .single();

  if (updateErr || !updated) {
    return errors.internal("Failed to publish trip", "trips.update");
  }

  // Kick the trending score so the new trip can appear immediately
  // (recency boost starts at +100 now that shared_at is set).
  await supabase.rpc("update_trip_trending_score", { p_trip_id: tripId });

  void captureServerEvent(user.id, "explore_trip_published", {
    trip_id: tripId,
    duration_days: durationDays,
    total_activities: totalActivities,
  });

  return apiSuccess({
    tripId: updated.id,
    shareToken: updated.share_token,
    visibility: "public",
    explorePath: "/explore",
  });
}

export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  if (!isExploreUgcEnabled()) return errors.notFound("Not Found");

  const { id: tripId } = await params;
  if (!tripId) return errors.badRequest("Trip id required");

  const { user, supabase, errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return errorResponse;

  const { data: trip } = await supabase
    .from("trips")
    .select("id, user_id")
    .eq("id", tripId)
    .single();
  if (!trip) return errors.notFound("Trip not found");
  if (trip.user_id !== user.id) {
    return errors.forbidden("Only the trip owner can unpublish");
  }

  const { error: updateErr } = await supabase
    .from("trips")
    .update({ visibility: "private", submitted_to_trending_at: null })
    .eq("id", tripId);
  if (updateErr) {
    return errors.internal("Failed to unpublish trip", "trips.update");
  }

  void captureServerEvent(user.id, "explore_trip_unpublished", {
    trip_id: tripId,
  });

  return apiSuccess({ tripId, visibility: "private" });
}
