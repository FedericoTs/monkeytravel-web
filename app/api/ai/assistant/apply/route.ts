import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ItineraryDay, Activity } from "@/types";

interface ApplyChangeRequest {
  tripId: string;
  changeType: "replace" | "add" | "remove";
  oldActivity?: Activity;
  newActivity: Activity;
  dayNumber: number;
}

export async function POST(request: NextRequest) {
  console.log("[AI Assistant Apply] POST request received");

  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: ApplyChangeRequest = await request.json();
    const { tripId, changeType, oldActivity, newActivity, dayNumber } = body;

    if (!tripId || !changeType || !newActivity || !dayNumber) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Fetch current trip
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    const itinerary = (trip.itinerary || []) as ItineraryDay[];
    const dayIndex = dayNumber - 1;

    if (dayIndex < 0 || dayIndex >= itinerary.length) {
      return NextResponse.json({ error: "Invalid day number" }, { status: 400 });
    }

    // Deep clone for modification
    const modifiedItinerary: ItineraryDay[] = JSON.parse(JSON.stringify(itinerary));

    if (changeType === "replace" && oldActivity) {
      // Find and replace the activity
      const activityIndex = modifiedItinerary[dayIndex].activities.findIndex(
        (a) => a.id === oldActivity.id || a.name === oldActivity.name
      );

      if (activityIndex === -1) {
        return NextResponse.json(
          { error: "Activity not found in itinerary" },
          { status: 404 }
        );
      }

      // Preserve original time slot and start time
      newActivity.start_time = modifiedItinerary[dayIndex].activities[activityIndex].start_time;
      newActivity.time_slot = modifiedItinerary[dayIndex].activities[activityIndex].time_slot;

      modifiedItinerary[dayIndex].activities[activityIndex] = newActivity;
      console.log(`[AI Assistant Apply] Replaced "${oldActivity.name}" with "${newActivity.name}"`);
    } else if (changeType === "add") {
      // Add the new activity and sort by time
      modifiedItinerary[dayIndex].activities.push(newActivity);
      modifiedItinerary[dayIndex].activities.sort((a, b) =>
        (a.start_time || "").localeCompare(b.start_time || "")
      );
      console.log(`[AI Assistant Apply] Added "${newActivity.name}" to Day ${dayNumber}`);
    } else if (changeType === "remove" && oldActivity) {
      // Find and remove the activity
      const activityIndex = modifiedItinerary[dayIndex].activities.findIndex(
        (a) => a.id === oldActivity.id || a.name === oldActivity.name
      );

      if (activityIndex === -1) {
        return NextResponse.json(
          { error: "Activity not found in itinerary" },
          { status: 404 }
        );
      }

      modifiedItinerary[dayIndex].activities.splice(activityIndex, 1);
      console.log(`[AI Assistant Apply] Removed "${oldActivity.name}" from Day ${dayNumber}`);
    }

    // Save to database
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        itinerary: modifiedItinerary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tripId);

    if (updateError) {
      console.error("[AI Assistant Apply] Database update failed:", updateError);
      return NextResponse.json(
        { error: "Failed to save changes" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      modifiedItinerary,
      action: {
        type: changeType,
        applied: true,
        dayNumber,
        activityName: newActivity.name,
      },
    });
  } catch (error) {
    console.error("[AI Assistant Apply] Error:", error);
    return NextResponse.json(
      { error: "Failed to apply change" },
      { status: 500 }
    );
  }
}
