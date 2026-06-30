import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import type { ItineraryDay } from "@/types";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { fetchActivityImages, SAVE_TIME_PAID_LOOKUPS } from "@/lib/images/activity";

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

    const itinerary = trip.itinerary as ItineraryDay[] | null;
    if (!itinerary || !Array.isArray(itinerary) || itinerary.length === 0) {
      return apiSuccess({ success: true, message: "No itinerary to enrich", updated: 0 });
    }

    // Canonical destination (buildTripRow writes trip_meta.destination); fall
    // back to the title strip the same way getTripDestination would.
    const meta = (trip.trip_meta ?? {}) as { destination?: string };
    const destination =
      meta.destination || (trip.title as string | undefined)?.replace(/ Trip$/, "") || "";

    // Resolve real Google photos (budget-capped), upgrading the curated
    // fallbacks baked at generation. Mutates each activity's image_url in place;
    // existing real proxy URLs are preserved (reresolveCurated keeps them).
    await fetchActivityImages(itinerary, destination, {
      maxPaidLookups: SAVE_TIME_PAID_LOOKUPS,
      reresolveCurated: true,
    });

    const { error: updateError } = await supabase
      .from("trips")
      .update({ itinerary })
      .eq("id", tripId);

    if (updateError) {
      console.error("[EnrichPhotos] Update error:", updateError);
      return errors.internal("Failed to update trip", "EnrichPhotos");
    }

    return apiSuccess({ success: true, updated: itinerary.length });
  } catch (error) {
    console.error("[EnrichPhotos] Error:", error);
    return errors.internal("Failed to enrich photos", "EnrichPhotos");
  }
}
