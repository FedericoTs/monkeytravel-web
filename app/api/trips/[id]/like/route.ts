import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { isExploreUgcEnabled } from "@/lib/explore/flag";
import { captureServerEvent } from "@/lib/posthog/server";

/**
 * Trip-level Likes — POST = like, DELETE = unlike.
 *
 * Likes require auth (one row per user per trip, dedup via PK). Anon
 * visitors can save (cookie-keyed) but not like — keeps the engagement
 * signal clean and avoids cookie-spoofing abuse.
 *
 * Flag: EXPLORE_UGC_ENABLED env. Until the launch ramp begins, every
 * route under /explore returns 404 so we don't leak the feature.
 *
 * Contract:
 *   - Trip must be visibility=public AND not is_hidden (else 404).
 *   - Duplicate like → 200 with current count (idempotent).
 *   - Atomic counter RPC runs ONLY after the insert/delete succeeds —
 *     never double-counts even under retry.
 */

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteCtx) {
  if (!isExploreUgcEnabled()) return errors.notFound("Not Found");

  const { id: tripId } = await params;
  if (!tripId) return errors.badRequest("Trip id required");

  const { user, supabase, errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return errorResponse;

  // Verify the trip is publicly likable (public + not hidden). RLS
  // already filters this for the read; we do the explicit check so we
  // can return a friendly 404 instead of a successful "but invisible"
  // insert.
  const { data: trip, error: lookupErr } = await supabase
    .from("trips")
    .select("id, visibility, is_hidden")
    .eq("id", tripId)
    .single();

  if (lookupErr || !trip) return errors.notFound("Trip not found");
  if (trip.visibility !== "public" || trip.is_hidden) {
    return errors.notFound("Trip not found");
  }

  // INSERT first — unique violation = already liked = idempotent OK.
  const { error: insertErr } = await supabase
    .from("trip_likes")
    .insert({ trip_id: tripId, user_id: user.id });

  if (insertErr) {
    // 23505 = unique_violation — user already liked this trip. Read
    // the current count and return success so the client UI stays
    // consistent (avoids "like" → error → no UI update).
    if (insertErr.code === "23505") {
      const { data: cur } = await supabase
        .from("trips")
        .select("like_count")
        .eq("id", tripId)
        .single();
      return apiSuccess({ liked: true, count: cur?.like_count ?? 0 });
    }
    return errors.internal("Failed to record like", "trip_likes.insert");
  }

  // RPC handles the +1 + trending_score recompute in one statement.
  const { data: newCount, error: rpcErr } = await supabase.rpc(
    "increment_trip_like_count",
    { p_trip_id: tripId }
  );

  if (rpcErr) {
    // Counter is now drifted by 1; logged for the daily reconcile job.
    console.error("[trip-like] counter drift after insert:", rpcErr);
  }

  void captureServerEvent(user.id, "explore_trip_liked", { trip_id: tripId });

  return apiSuccess({ liked: true, count: newCount ?? 1 });
}

export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  if (!isExploreUgcEnabled()) return errors.notFound("Not Found");

  const { id: tripId } = await params;
  if (!tripId) return errors.badRequest("Trip id required");

  const { user, supabase, errorResponse } = await getAuthenticatedUser();
  if (errorResponse) return errorResponse;

  const { data: deleted, error: delErr } = await supabase
    .from("trip_likes")
    .delete()
    .eq("trip_id", tripId)
    .eq("user_id", user.id)
    .select("trip_id"); // returns the deleted row, empty if nothing matched

  if (delErr) {
    return errors.internal("Failed to remove like", "trip_likes.delete");
  }

  // Only decrement if we actually deleted a row.
  let newCount = 0;
  if (deleted && deleted.length > 0) {
    const { data: c } = await supabase.rpc("decrement_trip_like_count", {
      p_trip_id: tripId,
    });
    newCount = c ?? 0;
  } else {
    // No row deleted — return the current count without changing it.
    const { data: cur } = await supabase
      .from("trips")
      .select("like_count")
      .eq("id", tripId)
      .single();
    newCount = cur?.like_count ?? 0;
  }

  void captureServerEvent(user.id, "explore_trip_unliked", { trip_id: tripId });

  return apiSuccess({ liked: false, count: newCount });
}
