import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import type { ItineraryDay, Activity } from "@/types";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { recordAiOutcome } from "@/lib/ai/observability";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import {
  MAX_TRIP_DAYS,
  nextDateISO,
  computeExtendedEndDate,
} from "@/lib/ai/assistant/structural";

interface ApplyChangeRequest {
  tripId: string;
  changeType: "replace" | "add" | "remove" | "adjust_duration" | "reorder" | "add_day" | "apply_draft";
  oldActivity?: Activity;
  newActivity?: Activity;
  dayNumber: number;
  // For adjust_duration
  activity?: { id: string; name: string; type: string };
  oldDuration?: number;
  newDuration?: number;
  // For reorder
  activities?: { id: string; name: string; time: string; timeSlot: string }[];
  // For add_day (structural — transcript: "can you add a day to travel to
  // Voss"): the fully generated day proposed in preview.
  day?: ItineraryDay;
  // For apply_draft (structural — users pasting whole multi-day drafts):
  // the revised replacement days, persisted in ONE write.
  days?: ItineraryDay[];
}

export async function POST(request: NextRequest) {
  console.log("[AI Assistant Apply] POST request received");

  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    let body: ApplyChangeRequest;
    try {
      body = (await request.json()) as ApplyChangeRequest;
    } catch {
      return errors.badRequest("Body must be valid JSON");
    }
    const { tripId, changeType, oldActivity, newActivity, dayNumber, activity, oldDuration, newDuration, activities, day, days } = body;

    // Validate based on change type.
    // Bug-bounty 2026-05-24 P1: `!dayNumber` rejected `dayNumber === 0`
    // (falsy) — but 0 is a perfectly valid first day in trips that use
    // 0-indexed day numbering. Check type explicitly instead.
    if (!tripId || !changeType || typeof dayNumber !== "number") {
      return errors.badRequest("Missing required fields: tripId, changeType, dayNumber");
    }

    // Specific validation per change type
    if ((changeType === "replace" || changeType === "add") && !newActivity) {
      return errors.badRequest("Missing newActivity for replace/add operation");
    }

    if (changeType === "adjust_duration" && (!activity || newDuration === undefined)) {
      return errors.badRequest("Missing activity or newDuration for adjust_duration operation");
    }

    if (changeType === "reorder" && !activities) {
      return errors.badRequest("Missing activities for reorder operation");
    }

    if (changeType === "add_day" && (!day || !Array.isArray(day.activities) || day.activities.length === 0)) {
      return errors.badRequest("Missing day (with activities) for add_day operation");
    }

    if (changeType === "apply_draft" && (!Array.isArray(days) || days.length === 0)) {
      return errors.badRequest("Missing days for apply_draft operation");
    }

    // Fetch current trip
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .eq("user_id", user.id)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Trip not found");
    }

    const itinerary = (trip.itinerary || []) as ItineraryDay[];
    const dayIndex = dayNumber - 1;

    // add_day APPENDS: its dayNumber sits one past the current end by
    // design, so the in-range check below would always reject it.
    if (changeType !== "add_day" && (dayIndex < 0 || dayIndex >= itinerary.length)) {
      return errors.badRequest("Invalid day number");
    }

    // Deep clone for modification
    const modifiedItinerary: ItineraryDay[] = JSON.parse(JSON.stringify(itinerary));

    if (changeType === "replace" && oldActivity && newActivity) {
      // Find and replace the activity
      const activityIndex = modifiedItinerary[dayIndex].activities.findIndex(
        (a) => a.id === oldActivity.id || a.name === oldActivity.name
      );

      if (activityIndex === -1) {
        return errors.notFound("Activity not found in itinerary");
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
        return errors.notFound("Activity not found in itinerary");
      }

      modifiedItinerary[dayIndex].activities.splice(activityIndex, 1);
      console.log(`[AI Assistant Apply] Removed "${oldActivity.name}" from Day ${dayNumber}`);
    } else if (changeType === "adjust_duration" && activity && newDuration !== undefined) {
      // Find the activity and adjust its duration
      const activityIndex = modifiedItinerary[dayIndex].activities.findIndex(
        (a) => a.id === activity.id || a.name === activity.name
      );

      if (activityIndex === -1) {
        return errors.notFound("Activity not found in itinerary");
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

    // Structural results threaded into the update + response below.
    let newEndDate: string | null = null;
    let appliedDayNumber = dayNumber;
    let daysUpdatedCount: number | undefined;
    let structuralName: string | undefined;

    if (changeType === "add_day" && day) {
      // Re-validate against the STORED trip (not the preview snapshot):
      // cap first — the 14-day platform maximum must hold even if the
      // itinerary grew between preview and confirm.
      if (modifiedItinerary.length >= MAX_TRIP_DAYS) {
        return errors.badRequest(`Trip is already at the ${MAX_TRIP_DAYS}-day maximum`);
      }

      const lastDay = modifiedItinerary[modifiedItinerary.length - 1];
      const lastNumber = lastDay?.day_number ?? modifiedItinerary.length;
      // Recompute number/date server-side so a stale preview can't append
      // a duplicate day_number or a gap in the date sequence.
      const appended: ItineraryDay = {
        ...day,
        day_number: lastNumber + 1,
      };
      const recomputedDate = nextDateISO([lastDay?.date, trip.end_date as string | undefined]);
      if (recomputedDate) appended.date = recomputedDate;
      if (lastDay?.city && !appended.city) appended.city = lastDay.city;

      modifiedItinerary.push(appended);
      appliedDayNumber = appended.day_number;
      // Badge name: the day's theme reads best ("Day 12 added · Fjord day");
      // fall back to the first activity so it never says "Schedule".
      structuralName = appended.theme || appended.activities[0]?.name;
      // The trips row's end date extends together with the itinerary — in
      // the SAME write (below), never as a second call that can half-fail.
      newEndDate = computeExtendedEndDate(trip.end_date as string | undefined, appended.date);
      console.log(`[AI Assistant Apply] Appending Day ${appended.day_number} (${appended.date}), end_date → ${newEndDate ?? "unchanged"}`);
    } else if (changeType === "apply_draft" && days) {
      // Replace matching days in place; days the draft didn't cover stay
      // untouched. No length change here by contract (that's add_day).
      const indexByNumber = new Map(modifiedItinerary.map((d, i) => [d.day_number, i] as const));
      let updated = 0;
      for (const revised of days) {
        const idx = indexByNumber.get(revised?.day_number);
        if (idx === undefined) continue; // unknown day — skip, never grow
        // Identity fields stay pinned to the stored day (defense in depth —
        // the assistant route already pins them, see structural.ts).
        modifiedItinerary[idx] = {
          ...revised,
          day_number: modifiedItinerary[idx].day_number,
          date: modifiedItinerary[idx].date,
          city: modifiedItinerary[idx].city,
        };
        if (updated === 0) appliedDayNumber = modifiedItinerary[idx].day_number;
        updated++;
      }
      if (updated === 0) {
        return errors.badRequest("None of the revised days matched the trip");
      }
      daysUpdatedCount = updated;
      console.log(`[AI Assistant Apply] Applied draft revision to ${updated} day(s)`);
    }

    if (changeType === "add_day" || changeType === "apply_draft") {
      // Belt-and-braces: every activity needs an id for drag/edit paths.
      // (The assistant route stamps them, but /apply is also callable
      // directly.)
      const withIds = ensureActivityIds(modifiedItinerary);
      modifiedItinerary.splice(0, modifiedItinerary.length, ...withIds);
    }

    // Save to database
    const { error: updateError } = await supabase
      .from("trips")
      .update({
        itinerary: modifiedItinerary,
        // add_day: end date moves in the same write as the itinerary.
        ...(newEndDate ? { end_date: newEndDate } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tripId);

    if (updateError) {
      console.error("[AI Assistant Apply] Database update failed:", updateError);
      return errors.internal("Failed to save changes", "AI Assistant Apply");
    }

    return apiSuccess({
      success: true,
      modifiedItinerary,
      // add_day: the persisted end date, so the client can report it.
      ...(newEndDate ? { newEndDate } : {}),
      action: {
        type: changeType,
        applied: true,
        dayNumber: appliedDayNumber,
        // apply_draft: drives the "{count} days updated" badge.
        ...(daysUpdatedCount !== undefined ? { dayCount: daysUpdatedCount } : {}),
        activityName: structuralName || newActivity?.name || activity?.name || "Schedule",
      },
    });
  } catch (error) {
    console.error("[AI Assistant Apply] Error:", error);

    // Capture to Sentry (task #223). Apply failures = silently lost
    // edits — user thinks the AI applied the change but it didn't.
    void recordAiOutcome({
      endpoint: "assistant",
      outcome: "failure",
      durationMs: 0,
      error,
      metadata: { subroute: "apply" },
    });

    return errors.internal("Failed to apply change", "AI Assistant Apply");
  }
}
