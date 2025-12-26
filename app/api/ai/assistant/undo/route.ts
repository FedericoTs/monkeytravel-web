import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import type { ItineraryDay } from "@/types";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

interface UndoRequest {
  tripId: string;
  previousItinerary: ItineraryDay[];
}

export async function POST(request: NextRequest) {
  console.log("[AI Assistant Undo] POST request received");

  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const body: UndoRequest = await request.json();
    const { tripId, previousItinerary } = body;

    if (!tripId || !previousItinerary) {
      return errors.badRequest("Missing tripId or previousItinerary");
    }

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

    // Restore the previous itinerary
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        itinerary: previousItinerary,
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
    return errors.internal("Failed to undo change", "AI Assistant Undo");
  }
}
