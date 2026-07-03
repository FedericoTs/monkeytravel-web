import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import type { ItineraryDay } from "@/types";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { recordAiOutcome } from "@/lib/ai/observability";

interface UndoRequest {
  tripId: string;
  previousItinerary: ItineraryDay[];
  // Set when undoing an add_day: the append also extended trips.end_date,
  // so the undo must restore BOTH in the same write or the trip ends a day
  // after its own itinerary.
  previousEndDate?: string;
}

export async function POST(request: NextRequest) {
  console.log("[AI Assistant Undo] POST request received");

  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const body: UndoRequest = await request.json();
    const { tripId, previousItinerary, previousEndDate } = body;

    if (!tripId || !previousItinerary) {
      return errors.badRequest("Missing tripId or previousItinerary");
    }

    // Light shape check — only a YYYY-MM-DD-ish string may touch end_date.
    const restoreEndDate =
      typeof previousEndDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(previousEndDate)
        ? previousEndDate.slice(0, 10)
        : null;

    // Verify the trip belongs to the user
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Trip not found");
    }

    // Restore the previous itinerary (and, for add_day undos, the end date)
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        itinerary: previousItinerary,
        ...(restoreEndDate ? { end_date: restoreEndDate } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tripId);

    if (updateError) {
      console.error("[AI Assistant Undo] Database update failed:", updateError);
      return errors.internal("Failed to undo changes", "AI Assistant Undo");
    }

    console.log(`[AI Assistant Undo] Successfully restored previous itinerary for trip ${tripId}`);

    return apiSuccess({
      success: true,
      restoredItinerary: previousItinerary,
    });
  } catch (error) {
    console.error("[AI Assistant Undo] Error:", error);

    // Capture to Sentry (task #223). Undo failures = trip stuck in a
    // bad state with no easy recovery, prioritize visibility.
    void recordAiOutcome({
      endpoint: "assistant",
      outcome: "failure",
      durationMs: 0,
      error,
      metadata: { subroute: "undo" },
    });

    return errors.internal("Failed to undo change", "AI Assistant Undo");
  }
}
