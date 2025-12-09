import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ItineraryDay } from "@/types";

interface UndoRequest {
  tripId: string;
  previousItinerary: ItineraryDay[];
}

export async function POST(request: NextRequest) {
  console.log("[AI Assistant Undo] POST request received");

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: UndoRequest = await request.json();
    const { tripId, previousItinerary } = body;

    if (!tripId || !previousItinerary) {
      return NextResponse.json(
        { error: "Missing tripId or previousItinerary" },
        { status: 400 }
      );
    }

    // Verify the trip belongs to the user
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
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
      return NextResponse.json(
        { error: "Failed to undo changes" },
        { status: 500 }
      );
    }

    console.log(`[AI Assistant Undo] Successfully restored previous itinerary for trip ${tripId}`);

    return NextResponse.json({
      success: true,
      restoredItinerary: previousItinerary,
    });
  } catch (error) {
    console.error("[AI Assistant Undo] Error:", error);
    return NextResponse.json(
      { error: "Failed to undo change" },
      { status: 500 }
    );
  }
}
