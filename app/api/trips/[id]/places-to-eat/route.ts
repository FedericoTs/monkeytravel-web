import { NextRequest } from "next/server";
import { blockedCall, checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { checkKeptTripPlacesToEat } from "@/lib/places/check-kept-trip";
import { placesToEatCheckDue } from "@/lib/places/kept-trip";
import { captureServerEvent } from "@/lib/posthog/server";
import { logReadError } from "@/lib/supabase/log-read-error";
import { keptTripDiets } from "@/lib/trips/diet";

// Each check pays for Places searches; a trip is checked once, so more than
// this is a page retrying in a loop.
const limiter = createRateLimiter("places-to-eat", 6, 60 * 60_000);

const ENDPOINT = "/api/trips/[id]/places-to-eat";

/**
 * A kept trip's places to eat, looked up on Google Maps when its owner first
 * opens it (hooks/useKeptTripPlacesToEat.ts): one closed is replaced by an open
 * one or left out, and on a diet trip one Maps doesn't have is treated much the
 * same (lib/places/places-to-eat.ts). Once per trip, stamped in trip_meta. The
 * answer lists the changes stored, for the page to make on its own copy, and
 * what the page says of them. Owner-only. With Gemini's kill switch or daily
 * limit saying no, the check waits: it asks the model for places instead of
 * closed ones, and stays due.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  try {
    const { id: tripId } = await params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { allowed } = await limiter.check(request, user.id);
    if (!allowed) return errors.rateLimit("Too many checks of places to eat. Please slow down.");

    const { trip, errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      tripId,
      user.id,
      "id, user_id, title, itinerary, itinerary_version, trip_meta, budget, end_date"
    );
    if (tripError) return tripError;

    // A plan the planner asked no diet for was made for the owner's profile's.
    const { data: owner } = logReadError(
      "places to eat: owner diet",
      await supabase.from("users").select("preferences").eq("id", user.id).maybeSingle()
    );
    const diets = keptTripDiets(trip.trip_meta, (owner as { preferences?: unknown } | null)?.preferences);
    const today = new Date().toISOString().slice(0, 10);
    if (!placesToEatCheckDue({ endDate: trip.end_date as string | null, meta: trip.trip_meta }, today)) {
      return apiSuccess({ status: "none" });
    }

    const access = await checkApiAccess("gemini");
    if (!access.allowed) {
      return blockedCall(access, {
        apiName: "gemini",
        endpoint: ENDPOINT,
        startTime,
        metadata: { user_id: user.id, trip_id: tripId },
        disabled: "Checking places to eat is currently disabled",
      });
    }

    const outcome = await checkKeptTripPlacesToEat(
      supabase,
      {
        id: tripId,
        user_id: user.id,
        title: trip.title as string | null,
        itinerary: trip.itinerary,
        itinerary_version: typeof trip.itinerary_version === "number" ? trip.itinerary_version : null,
        trip_meta: trip.trip_meta,
        budget: trip.budget,
      },
      diets
    );

    const { result } = outcome;
    if (result) {
      captureServerEvent(user.id, "places_to_eat_checked", {
        trip_id: tripId,
        stored: outcome.status === "checked",
        has_diet: diets.length > 0,
        checked: result.checked,
        closed: result.closed,
        missing: result.missing,
        replaced: result.replaced,
        dropped: result.dropped,
        kept: result.kept,
        unanswered: result.unanswered,
        cost_usd: result.costUsd,
      }).catch(() => {});
      if (result.costUsd > 0) {
        await logApiCall({
          apiName: "gemini",
          endpoint: ENDPOINT,
          status: 200,
          responseTimeMs: Date.now() - startTime,
          cacheHit: false,
          costUsd: result.costUsd,
          exactCost: true,
          userId: user.id,
          metadata: { trip_id: tripId, replaced: result.replaced },
        });
      }
    }

    if (outcome.status !== "checked") return apiSuccess({ status: "none" });
    return apiSuccess({
      status: "checked",
      changes: outcome.changes,
      fromVersion: outcome.fromVersion,
      itineraryVersion: outcome.itineraryVersion,
      note: outcome.note,
    });
  } catch (error) {
    console.error("[PlacesToEat] Error:", error);
    return errors.internal("Failed to check places to eat", "PlacesToEat");
  }
}
