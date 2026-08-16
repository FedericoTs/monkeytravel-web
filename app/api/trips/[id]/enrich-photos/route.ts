import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { SAVE_TIME_PAID_LOOKUPS } from "@/lib/images/activity";
import { enrichTripRecord } from "@/lib/images/enrichTrip";
import { captureServerEvent } from "@/lib/posthog/server";

/**
 * Enrich Activity Photos API (2026-06-30 cost pass)
 *
 * Resolves REAL Google Place photos for a SAVED trip's activities and writes
 * them back into the itinerary.
 *
 * Why this exists: trip GENERATION now runs with zero paid Google Places
 * lookups (cost control) — every activity ships with a free cache-hit real
 * photo or a type-relevant curated fallback, so the pre-save result page is
 * never broken or empty. This endpoint runs once a trip is actually KEPT
 * (fired fire-and-forget from the save path in lib/trips/persistTrip.ts),
 * upgrading the curated fallbacks to real place photos. Only the small fraction
 * of generations that convert to a saved trip ever reach here — that's the cost
 * saving. Owner-only (verifyTripOwnership); a kept trip is a high-value object.
 *
 * Idempotent + cheap to re-run: real /api/places/photo proxy URLs are kept
 * (never re-paid), cross-trip cache hits are free, and the per-call paid budget
 * is bounded (SAVE_TIME_PAID_LOOKUPS). Safe to call again after a regeneration.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tripId } = await params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { trip, errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      tripId,
      user.id,
      "id, user_id, itinerary, title, trip_meta"
    );
    if (tripError) return tripError;

    // Save-path budget, cooldown-exempt: a regeneration right after save
    // introduces new curated images that deserve an immediate upgrade, and
    // re-runs are cheap (real proxy URLs are never re-paid).
    const outcome = await enrichTripRecord(
      supabase,
      {
        id: tripId,
        title: trip.title as string | null,
        itinerary: trip.itinerary,
        trip_meta: trip.trip_meta,
      },
      { maxPaidLookups: SAVE_TIME_PAID_LOOKUPS, respectCooldown: false }
    );

    if (outcome.skipped !== "no_itinerary") {
      captureServerEvent(user.id, "photos_enriched", {
        trip_id: tripId,
        trigger: "save",
        skipped: outcome.skipped,
        real_before: outcome.before.real,
        real_after: outcome.after.real,
        total_activities: outcome.after.total,
        paid_budget: SAVE_TIME_PAID_LOOKUPS,
      }).catch(() => {});
    }

    // `updated` = activities upgraded to a real photo THIS call (the old
    // response returned the DAY count here, which made the one success
    // signal unusable as a metric).
    return apiSuccess({
      success: true,
      updated: outcome.after.real - outcome.before.real,
      real: outcome.after.real,
      total: outcome.after.total,
      skipped: outcome.skipped,
    });
  } catch (error) {
    console.error("[EnrichPhotos] Error:", error);
    return errors.internal("Failed to enrich photos", "EnrichPhotos");
  }
}
