import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ItineraryDay, Activity } from "@/types";

interface ApplyChangeRequest {
  tripId: string;
  changeType: "replace" | "add" | "remove" | "adjust_duration" | "reorder";
  oldActivity?: Activity;
  newActivity?: Activity;
  dayNumber: number;
  // For adjust_duration
  activity?: { id: string; name: string; type: string };
  oldDuration?: number;
  newDuration?: number;
  // For reorder
  activities?: { id: string; name: string; time: string; timeSlot: string }[];
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
    const { tripId, changeType, oldActivity, newActivity, dayNumber, activity, oldDuration, newDuration, activities } = body;

    // Validate based on change type
    if (!tripId || !changeType || !dayNumber) {
      return NextResponse.json(
        { error: "Missing required fields: tripId, changeType, dayNumber" },
        { status: 400 }
      );
    }

    // Specific validation per change type
    if ((changeType === "replace" || changeType === "add") && !newActivity) {
      return NextResponse.json(
        { error: "Missing newActivity for replace/add operation" },
        { status: 400 }
      );
    }

    if (changeType === "adjust_duration" && (!activity || newDuration === undefined)) {
      return NextResponse.json(
        { error: "Missing activity or newDuration for adjust_duration operation" },
        { status: 400 }
      );
    }

    if (changeType === "reorder" && !activities) {
      return NextResponse.json(
        { error: "Missing activities for reorder operation" },
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

    if (changeType === "replace" && oldActivity && newActivity) {
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
    } else if (changeType === "add" && newActivity) {
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
    } else if (changeType === "adjust_duration" && activity && newDuration !== undefined) {
      // Find the activity and adjust its duration
      const activityIndex = modifiedItinerary[dayIndex].activities.findIndex(
        (a) => a.id === activity.id || a.name === activity.name
      );

      if (activityIndex === -1) {
        return NextResponse.json(
          { error: "Activity not found in itinerary" },
          { status: 404 }
        );
      }

      // Update the duration
      modifiedItinerary[dayIndex].activities[activityIndex].duration_minutes = newDuration;

      // Adjust subsequent activities' start times
      const dayActivities = modifiedItinerary[dayIndex].activities;
      for (let i = activityIndex + 1; i < dayActivities.length; i++) {
        const prevActivity = dayActivities[i - 1];
        const [prevHours, prevMins] = (prevActivity.start_time || "09:00").split(":").map(Number);
        const prevEnd = prevHours * 60 + prevMins + (prevActivity.duration_minutes || 60);
        const newHours = Math.floor(prevEnd / 60);
        const newMins = prevEnd % 60;
        dayActivities[i].start_time = `${String(newHours).padStart(2, "0")}:${String(newMins).padStart(2, "0")}`;
      }

      console.log(`[AI Assistant Apply] Adjusted "${activity.name}" duration from ${oldDuration || "unknown"}min to ${newDuration}min`);
    } else if (changeType === "reorder" && activities) {
      // Reorder activities based on the provided order
      const currentActivities = modifiedItinerary[dayIndex].activities;
      const reorderedActivities: Activity[] = [];

      // Map activities by ID/name for lookup
      const activityMap = new Map<string, Activity>();
      for (const act of currentActivities) {
        if (act.id) activityMap.set(act.id, act);
        activityMap.set(act.name, act);
      }

      // Build reordered list
      for (const orderedAct of activities) {
        const found = activityMap.get(orderedAct.id) || activityMap.get(orderedAct.name);
        if (found) {
          // Update time and time slot from the reorder data
          found.start_time = orderedAct.time;
          found.time_slot = orderedAct.timeSlot as "morning" | "afternoon" | "evening";
          reorderedActivities.push(found);
        }
      }

      // Add any activities that weren't in the reorder list (shouldn't happen, but safety)
      for (const act of currentActivities) {
        if (!reorderedActivities.find(r => r.id === act.id || r.name === act.name)) {
          reorderedActivities.push(act);
        }
      }

      modifiedItinerary[dayIndex].activities = reorderedActivities;
      console.log(`[AI Assistant Apply] Reordered Day ${dayNumber} with ${reorderedActivities.length} activities`);
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
        activityName: newActivity?.name || activity?.name || "Schedule",
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
