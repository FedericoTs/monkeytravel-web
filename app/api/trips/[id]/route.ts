import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripAccess, verifyTripOwnership } from "@/lib/api/auth";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import type { ItineraryDay } from "@/types";
import { scheduleTripNotifications } from "@/lib/notifications/scheduling";
import { refreshItineraryPhotos } from "@/lib/places/refreshItineraryPhotos";

/**
 * GET /api/trips/[id] - Fetch a single trip
 */
export async function GET(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Fetch trip with ownership verification
    const { trip, errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      id,
      user.id,
      "*"
    );
    if (tripError) return tripError;

    // Read-time refresh of activity photo URLs from places_v2. See
    // lib/places/refreshItineraryPhotos.ts for why this exists.
    // Falls back to the original itinerary silently on any DB error.
    const tripWithItin = trip as unknown as { itinerary?: unknown };
    if (tripWithItin && Array.isArray(tripWithItin.itinerary)) {
      const refreshed = await refreshItineraryPhotos(
        tripWithItin.itinerary as Array<{
          activities?: Array<{ image_url?: string | null }>;
        }>
      );
      tripWithItin.itinerary = refreshed;
    }

    return apiSuccess({ success: true, trip });
  } catch (error) {
    console.error("[Trips] Error fetching trip:", error);
    return errors.internal("Failed to fetch trip", "Trips");
  }
}

/**
 * Fields an invited editor may change. The rest of the PATCH surface
 * (status, dates, the reminders mute) stays with the owner: dates and the
 * mute re-plan the OWNER's reminder emails, and status is the trip's
 * lifecycle. Mirrors what the trips_update RLS policy already lets an editor
 * do at the row level, narrowed to the product's intent.
 */
const EDITOR_FIELDS = new Set([
  "itinerary",
  "title",
  "description",
  "tags",
  "budget",
  "cover_image_url",
]);
const OWNER_ONLY_FIELDS = ["status", "start_date", "end_date", "reminders_muted"] as const;

/**
 * PATCH /api/trips/[id] - Update trip (supports itinerary updates)
 *
 * Owner, or an invited EDITOR (trip_collaborators.role = 'editor'). Until
 * 2026-09-24 this was owner-only while the trip page showed editors an
 * "Edit trip" button, so an editor's Save answered 404 "Trip not found".
 */
export async function PATCH(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Owner or editor. Voters, viewers and non-members get 403; a trip the
    // caller cannot see at all gets 404. user_id must be in the select:
    // verifyTripAccess decides ownership from it.
    const { trip, isOwner, errorResponse: tripError } = await verifyTripAccess(
      supabase,
      id,
      user.id,
      "id, user_id",
      ["editor"]
    );
    if (tripError) return tripError;

    // Parse request body. An empty or truncated body is a client-side event
    // (a save superseded mid-upload by a newer one, or a tab closed while the
    // debounced PATCH was in flight) — answer 400, not a 500 that reads as a
    // server failure in the logs and in Sentry.
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest("Invalid or empty JSON body");
    }

    // An editor asking for an owner-only change is refused outright rather
    // than having the field dropped: a 200 for a change that never happened
    // is the silent-write-failure shape tests/e2e/silent-write-failures.spec.ts
    // exists to catch. The trip page never sends these for an editor.
    if (!isOwner) {
      const refused = OWNER_ONLY_FIELDS.filter((f) => body[f] !== undefined);
      if (refused.length > 0) {
        return errors.forbidden(`Only the trip owner can change: ${refused.join(", ")}`);
      }
    }

    // A photo found for one activity (PlaceGallery). Applied to the CURRENT
    // stored itinerary, never by sending the whole itinerary from the tab:
    // that used to overwrite whatever anyone else had saved since the page
    // loaded, which became reachable once editors could save.
    if (body.activityPhoto !== undefined) {
      return applyActivityPhoto(supabase, id, body.activityPhoto);
    }

    // Build update object
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Handle itinerary update - ensure all activities have IDs
    if (body.itinerary !== undefined) {
      const itinerary = body.itinerary as ItineraryDay[];

      // Validate itinerary structure
      if (!Array.isArray(itinerary)) {
        return errors.badRequest("Invalid itinerary format");
      }

      // Ensure all activities have IDs
      updates.itinerary = ensureActivityIds(itinerary);
    }

    // Handle other allowed fields. `start_date` and `end_date` are
    // accepted as ISO-date strings (YYYY-MM-DD); `reminders_muted`
    // is the per-trip pre-trip cascade mute toggle.
    const allowedFields = [
      "title",
      "description",
      "status",
      "tags",
      "budget",
      "cover_image_url",
      "start_date",
      "end_date",
      "reminders_muted",
    ];
    for (const field of allowedFields) {
      if (body[field] !== undefined && (isOwner || EDITOR_FIELDS.has(field))) {
        updates[field] = body[field];
      }
    }

    // CAUSALITY: capture whether this PATCH touches start_date / mute
    // BEFORE the update so we can re-enqueue the reminder cascade
    // after success. enqueue_trip_notifications(tripId, userId) is
    // idempotent (wipes pending → re-inserts), so this is safe to
    // call on every change without risking duplicates.
    const startDateChanged = body.start_date !== undefined;
    // end_date moves the trip's duration, which is what the in-trip day digests
    // (Phase 4.1) are counted from — so a change to it must re-enqueue too.
    const endDateChanged = body.end_date !== undefined;
    const muteChanged = body.reminders_muted !== undefined;

    // Update trip. Filtered by id only: the trips_update RLS policy admits the
    // owner and editors, and the trips_guard_protected_columns trigger still
    // keeps user_id, counters and flags out of reach of both.
    const { data: updatedTrip, error: updateError } = await supabase
      .from("trips")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      // Zero rows: the policy refused the write, e.g. the editor was removed
      // between the access check and the update.
      if (updateError.code === "PGRST116") {
        return errors.forbidden("Access denied");
      }
      console.error("[Trips] Error updating trip:", updateError);
      return errors.internal("Failed to update trip", "Trips");
    }

    // Re-enqueue (or wipe) the pre-trip cascade if the start_date or
    // mute toggle moved. Fire-and-forget — gated internally by the
    // calendar-export env flag and fail-closed against the user via
    // logging only (never re-throws). See
    // lib/notifications/scheduling.ts for details.
    //
    // Always the OWNER's id, from the checked row. enqueue_trip_notifications
    // looks the trip up by (id, user_id): given anyone else's id it finds no
    // trip, deletes every pending row for it and inserts nothing, wiping the
    // owner's schedule. Only owners reach this today (dates and the mute are
    // owner-only above); this keeps it right if that ever changes.
    if (startDateChanged || endDateChanged || muteChanged) {
      void scheduleTripNotifications({ tripId: id, userId: trip.user_id });
    }

    return apiSuccess({ success: true, trip: updatedTrip });
  } catch (error) {
    console.error("[Trips] Error updating trip:", error);
    return errors.internal("Failed to update trip", "Trips");
  }
}

/**
 * Set one activity's image_url on the trip's current itinerary.
 *
 * Read, change one field, write back only if the row has not moved in
 * between (updated_at as the compare-and-swap token), retrying once. A photo
 * never replaces one that is already there, and an activity someone deleted
 * meanwhile is simply skipped. Access was checked by the caller (owner or
 * editor); RLS applies to both the read and the write.
 */
async function applyActivityPhoto(
  supabase: Awaited<ReturnType<typeof getAuthenticatedUser>>["supabase"],
  tripId: string,
  raw: unknown
) {
  const input = raw as { activityId?: unknown; imageUrl?: unknown } | null;
  const activityId = typeof input?.activityId === "string" ? input.activityId : "";
  const imageUrl = typeof input?.imageUrl === "string" ? input.imageUrl : "";
  // eslint-disable-next-line no-control-regex
  if (!activityId || activityId.length > 200 || !imageUrl || imageUrl.length > 2048 || /[\x00-\x1F]/.test(imageUrl)) {
    return errors.badRequest("Invalid activityPhoto");
  }
  if (!supabase) return errors.internal("Failed to update trip", "Trips");

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: current, error: readError } = await supabase
      .from("trips")
      .select("itinerary, updated_at")
      .eq("id", tripId)
      .single();
    if (readError || !current) return errors.notFound("Trip not found");

    const itinerary = (Array.isArray(current.itinerary) ? current.itinerary : []) as ItineraryDay[];
    let applied = false;
    const next = itinerary.map((day) => ({
      ...day,
      activities: (day.activities ?? []).map((activity) => {
        if (activity.id !== activityId || activity.image_url) return activity;
        applied = true;
        return { ...activity, image_url: imageUrl };
      }),
    }));
    if (!applied) return apiSuccess({ success: true, applied: false });

    const { data: written, error: writeError } = await supabase
      .from("trips")
      .update({ itinerary: next })
      .eq("id", tripId)
      .eq("updated_at", current.updated_at)
      .select("id");
    if (writeError) {
      console.error("[Trips] Error saving activity photo:", writeError);
      return errors.internal("Failed to update trip", "Trips");
    }
    if (written && written.length > 0) return apiSuccess({ success: true, applied: true });
    // Someone saved in between: re-read and try once more.
  }
  return apiSuccess({ success: true, applied: false });
}

/**
 * DELETE /api/trips/[id] - Soft-delete a trip
 *
 * Changed from hard DELETE to UPDATE deleted_at = NOW() on 2026-06-07.
 *
 * Why: the david-cassoni incident showed how lossy hard-delete is. He
 * signed up, generated a trip, chatted with the Concierge 7 times over
 * 17 minutes, then the trip disappeared (likely a misclick or UI
 * confusion). With hard-delete we lost the row, the conversation
 * context, the cover image work — everything. With soft-delete the
 * row stays put: RLS hides it from every read path, but we can
 * recover it on demand and we keep ai_conversations + activity
 * timeline foreign-keys valid.
 *
 * The DB-side change is in `supabase/migrations/...trips_soft_delete.sql`:
 *   - Column `deleted_at TIMESTAMPTZ`
 *   - Partial index on live rows
 *   - SELECT policy adds `deleted_at IS NULL AND (...)` so deleted trips
 *     vanish from /trips, /shared/[token], /explore, /it/explore, the
 *     trending feed, search results, and embedded queries.
 *   - UPDATE policy USING also checks `deleted_at IS NULL` so once a
 *     trip is tombstoned no further mutations land (collaborators
 *     can't edit a ghost).
 *
 * Hard delete remains *possible* (trips_delete_own RLS is intact) for
 * admin/cron cleanup, but it's no longer the user-facing default.
 *
 * Recovery: `UPDATE trips SET deleted_at = NULL WHERE id = '...'` from
 * the Supabase SQL editor. Self-serve restore UI is a follow-up.
 *
 * 2026-08-19 — WHY THIS GOES THROUGH AN RPC
 * The direct UPDATE above never worked. From the day soft-delete shipped
 * (2026-06-08) until today, every user's delete failed with 42501 "new row
 * violates row-level security policy", surfaced as a 500. It read as rare
 * (2 error events, 1 user) only because deleting a trip is rare; the write
 * was impossible, not flaky. The 14 rows carrying deleted_at were all
 * written by the service role, which bypasses RLS.
 *
 * Two policies blocked it independently, which is why the first fix was not
 * enough:
 *   1. trips_update had USING (deleted_at IS NULL AND ...) and no WITH
 *      CHECK. Postgres copies USING into WITH CHECK when it is omitted, so
 *      the tombstone was rejected for having deleted_at set. The original
 *      migration's comment — "No WITH CHECK so we don't trap the soft-delete
 *      itself" — asserted the exact opposite of the documented behaviour.
 *   2. Even with that corrected, trips_select_consolidated is
 *      `deleted_at IS NULL AND (...)`, so a tombstone matches NO select
 *      branch and the new row is unreachable.
 *
 * Relaxing (2) was rejected: 61 files query `trips` and only one filters
 * deleted_at itself, so that policy is what hides deleted trips everywhere.
 * Loosening it would make deleted trips reappear across the product.
 *
 * So the one write that must legitimately produce an invisible row goes
 * through soft_delete_trip(), a SECURITY DEFINER function that bypasses RLS
 * and re-checks ownership itself. It is owner-only (an editor collaborator
 * may edit a trip but must not delete it) and idempotent.
 */
export async function DELETE(request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    // `user` is intentionally not destructured: the RPC derives the caller
    // from auth.uid() server-side rather than trusting an id passed in.
    // This call still gates the route on a valid session via errorResponse,
    // and the function refuses an anonymous caller as a second line.
    const { supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Ownership and the deleted_at guard both live inside the function —
    // see the RPC's definition and the header note above for why this
    // cannot be a plain .update() through RLS.
    const { data: deleted, error } = await supabase.rpc("soft_delete_trip", {
      p_trip_id: id,
    });

    if (error) {
      console.error("[Trips] Error soft-deleting trip:", error);
      return errors.internal("Failed to delete trip", "Trips");
    }

    // `false` means nothing was tombstoned: already deleted, already gone, or
    // not this user's trip. All three are reported as success, which keeps a
    // double-tap from a stale UI idempotent and tells a prober nothing about
    // whether some other user's trip id exists.
    return apiSuccess({ success: true, deleted: deleted === true });
  } catch (error) {
    console.error("[Trips] Error soft-deleting trip:", error);
    return errors.internal("Failed to delete trip", "Trips");
  }
}
