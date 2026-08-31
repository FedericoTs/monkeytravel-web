import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import type { ItineraryDay, Activity } from "@/types";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { recordAiOutcome } from "@/lib/ai/observability";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { isLockedActivity, lockedActivityNames } from "@/lib/ai/anchors-core";
import {
  MAX_TRIP_DAYS,
  nextDateISO,
  computeExtendedEndDate,
  addDaysISO,
} from "@/lib/ai/assistant/structural";

interface ApplyChangeRequest {
  tripId: string;
  /**
   * The conversation this confirmation belongs to, so the transcript can be
   * annotated once the write succeeds. Optional: an older client that does not
   * send it still applies the change, it just leaves history unannotated.
   */
  conversationId?: string;
  changeType: "replace" | "add" | "remove" | "adjust_duration" | "reorder" | "add_day" | "apply_draft" | "shift_days";
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
  // For shift_days (P2 Stage C — the cancelled-flight primitive): every day
  // from `dayNumber` onward moves this many days LATER (1-7). The resulting
  // calendar hole before `dayNumber` is the point — extra free days where
  // the traveller currently is. start_date moves too when dayNumber === 1.
  shiftByDays?: number;
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
    const { tripId, changeType, oldActivity, newActivity, dayNumber, activity, oldDuration, newDuration, activities, day, days, shiftByDays, conversationId } = body;

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

    if (
      changeType === "shift_days" &&
      (typeof shiftByDays !== "number" ||
        !Number.isInteger(shiftByDays) ||
        shiftByDays < 1 ||
        shiftByDays > 7)
    ) {
      return errors.badRequest("shiftByDays must be an integer between 1 and 7");
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

    // ── F1 anchor guard ────────────────────────────────────────────────
    // This is the endpoint that PERSISTS, and it's "also callable directly"
    // (see the ensureActivityIds note below), so it enforces the rule itself
    // rather than trusting the proposal step to have done it. Anchors stay
    // user-owned: removable by hand in the fixed-plans panel, never by the AI.
    const anchorTarget =
      changeType === "replace" || changeType === "remove"
        ? oldActivity
        : changeType === "adjust_duration"
          ? activity
          : undefined;

    if (anchorTarget) {
      const target = modifiedItinerary[dayIndex]?.activities.find(
        (a) => a.id === anchorTarget.id || a.name === anchorTarget.name
      );
      if (isLockedActivity(target)) {
        return errors.badRequest(
          `"${target?.name}" is a fixed plan and can't be changed here. Edit it in the trip's fixed plans instead.`
        );
      }
    } else if (changeType === "reorder") {
      const locked = lockedActivityNames(modifiedItinerary[dayIndex]);
      if (locked.length > 0) {
        return errors.badRequest(
          `Day ${dayNumber} is built around a fixed plan (${locked.join(", ")}) and can't be reshuffled.`
        );
      }
    } else if (changeType === "apply_draft") {
      const locked = modifiedItinerary.flatMap((d) => lockedActivityNames(d));
      if (locked.length > 0) {
        return errors.badRequest(
          `This trip is built around fixed plans (${locked.slice(0, 3).join(", ")}) and can't be rewritten from a pasted draft.`
        );
      }
    } else if (changeType === "shift_days") {
      // Shifting dates would silently move date-pinned commitments (a booked
      // flight, a wedding) to days they don't belong to — refuse when any
      // affected day carries a locked activity, same rule as reorder.
      const locked = modifiedItinerary
        .slice(dayIndex)
        .flatMap((d) => lockedActivityNames(d));
      if (locked.length > 0) {
        return errors.badRequest(
          `Days ${dayNumber} onward include fixed plans (${locked.slice(0, 3).join(", ")}) whose dates can't be moved.`
        );
      }
    }

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
    let newStartDate: string | null = null;
    let appliedDayNumber = dayNumber;
    let daysUpdatedCount: number | undefined;
    let structuralName: string | undefined;

    if (changeType === "shift_days" && typeof shiftByDays === "number") {
      // Push every day from dayNumber to the end `shiftByDays` days later.
      // day_numbers stay 1..N ordinals; only dates (and the trip window)
      // move. The calendar gap this opens before dayNumber is deliberate.
      let shifted = 0;
      for (let i = dayIndex; i < modifiedItinerary.length; i++) {
        const newDate = addDaysISO(modifiedItinerary[i].date, shiftByDays);
        if (newDate) {
          modifiedItinerary[i].date = newDate;
          shifted++;
        }
      }
      if (shifted === 0) {
        return errors.badRequest("None of the affected days have a parseable date to shift");
      }
      const lastDay = modifiedItinerary[modifiedItinerary.length - 1];
      // end_date moves in the SAME write as the itinerary (add_day precedent).
      // Fallback via the shifted last day covers rows with a mangled end_date.
      newEndDate =
        addDaysISO(trip.end_date as string | undefined, shiftByDays) ??
        computeExtendedEndDate(trip.end_date as string | undefined, lastDay.date);
      if (dayNumber === 1) {
        // Whole-trip shift ("our outbound flight moved") — the start moves too.
        newStartDate = addDaysISO(trip.start_date as string | undefined, shiftByDays);
      }
      daysUpdatedCount = shifted;
      structuralName = `Day ${dayNumber}–${lastDay.day_number} +${shiftByDays}d`;
      console.log(`[AI Assistant Apply] Shifted days ${dayNumber}-${lastDay.day_number} by +${shiftByDays}d, end_date → ${newEndDate ?? "unchanged"}`);
    }

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

    // Save to database.
    //
    // `.select("id")` is load-bearing, not decoration. PostgREST answers an
    // UPDATE that matched ZERO rows with 204 and `error: null`, so checking
    // only `updateError` cannot tell a successful write from one an RLS
    // policy silently refused, or one whose row was deleted a moment ago.
    // This route is the Apply button: it is the last thing standing between
    // the user and being told a change was saved when it was not, which is
    // the exact failure this whole change exists to remove. Asking for the
    // row back turns the ambiguous 204 into an answer.
    const { data: written, error: updateError } = await supabase
      .from("trips")
      .update({
        itinerary: modifiedItinerary,
        // add_day / shift_days: trip window moves in the same write as the
        // itinerary — never as a second call that can half-fail.
        ...(newEndDate ? { end_date: newEndDate } : {}),
        ...(newStartDate ? { start_date: newStartDate } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tripId)
      .select("id");

    if (updateError) {
      console.error("[AI Assistant Apply] Database update failed:", updateError);
      return errors.internal("Failed to save changes", "AI Assistant Apply");
    }

    if (!written || written.length === 0) {
      // No error and no row: the write was refused or matched nothing. Saying
      // "saved" here would be indistinguishable, to the user, from the bug.
      console.error("[AI Assistant Apply] Update matched no rows", { tripId });
      return errors.internal("Failed to save changes", "AI Assistant Apply");
    }

    // The transcript is the only durable record of what happened here, and it
    // was previously written once — when the change was PROPOSED — and never
    // touched again. So a confirmed change and an abandoned one persisted
    // identically, and after a reload both rendered as "no changes made".
    // People then asked for the same edit again; this codebase has a
    // documented history of duplicate rows from exactly that loop.
    //
    // Best-effort: a failure to annotate history must never fail a write that
    // already succeeded.
    if (typeof conversationId === "string" && conversationId) {
      try {
        const { data: conv } = await supabase
          .from("ai_conversations")
          .select("messages")
          .eq("id", conversationId)
          .maybeSingle();
        const msgs = Array.isArray(conv?.messages) ? [...(conv!.messages as unknown[])] : [];
        // The proposal is the most recent assistant message still marked
        // pending — walk backwards so an older one is never overwritten.
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i] as { role?: string; action?: Record<string, unknown> } | null;
          if (!m || m.role !== "assistant" || !m.action) continue;
          if (m.action.applied === true) break;
          msgs[i] = { ...m, action: { ...m.action, applied: true, pending: false } };
          await supabase
            .from("ai_conversations")
            .update({ messages: msgs, updated_at: new Date().toISOString() })
            .eq("id", conversationId);
          break;
        }
      } catch (err) {
        console.error("[AI Assistant Apply] Could not annotate conversation", err);
      }
    }

    return apiSuccess({
      success: true,
      modifiedItinerary,
      // add_day / shift_days: the persisted trip window, so the client can report it.
      ...(newEndDate ? { newEndDate } : {}),
      ...(newStartDate ? { newStartDate } : {}),
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
