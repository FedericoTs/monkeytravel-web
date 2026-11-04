import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { TRIP_COLUMNS } from "@/lib/trips/columns";
import type { ItineraryDay } from "@/types";
import { errors, apiError, apiSuccess } from "@/lib/api/response-wrapper";
import { ASSISTANT_ERROR_CODES as CODES } from "@/lib/ai/assistant/error-message";
import {
  resolveAssistantRole,
  DATE_CHANGING_ASSISTANT_CHANGES,
  ASSISTANT_FORBIDDEN_MESSAGE,
  ASSISTANT_DATES_OWNER_ONLY_MESSAGE,
} from "@/lib/ai/assistant-access";
import { recordAiOutcome } from "@/lib/ai/observability";
import { applyChange, invalidChange, type ApplyChangeRequest } from "@/lib/ai/assistant/apply-change";
import { markProposalApplied } from "@/lib/ai/assistant/thread";
import { logReadError } from "@/lib/supabase/log-read-error";
import { requireRow } from "@/lib/api/require-row";
import { readJsonBody } from "@/lib/api/json-body";

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();
  console.log("[AI Assistant Apply] POST request received");

  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { body, invalidBody } = await readJsonBody<ApplyChangeRequest>(request);
    if (invalidBody) return invalidBody;
    const { tripId, changeType, conversationId } = body;

    const invalid = invalidChange(body);
    if (invalid) return errors.badRequest(invalid);

    // Fetch current trip. The owner and invited editors may apply
    // (lib/ai/assistant-access.ts).
    const { row: trip, errorResponse: tripError } = await requireRow("trip", supabase
      .from("trips")
      .select(TRIP_COLUMNS)
      .eq("id", tripId)
      .single(), "Trip not found");
    if (tripError) return tripError;

    const assistantRole = await resolveAssistantRole(supabase, trip, user.id);
    if (!assistantRole) {
      return errors.forbidden(ASSISTANT_FORBIDDEN_MESSAGE, CODES.notAllowed);
    }
    // Adding days or shifting them moves the trip's dates, which stay with
    // the owner (as on PATCH /api/trips/[id]). Checked before any work, so
    // an editor never gets as far as a write the database would refuse.
    if (assistantRole !== "owner" && DATE_CHANGING_ASSISTANT_CHANGES.has(changeType)) {
      return errors.forbidden(ASSISTANT_DATES_OWNER_ONLY_MESSAGE, CODES.datesOwnerOnly);
    }

    const outcome = applyChange(
      body,
      {
        itinerary: (trip.itinerary || []) as ItineraryDay[],
        startDate: trip.start_date as string | undefined,
        endDate: trip.end_date as string | undefined,
      },
      assistantRole
    );
    if (outcome.refused) return outcome.refused;
    const { days: modifiedItinerary, newEndDate, newStartDate, dayNumber: appliedDayNumber, dayCount, name } = outcome.applied;

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
    let write = supabase
      .from("trips")
      .update({
        itinerary: modifiedItinerary,
        // add_day / shift_days: trip window moves in the same write as the
        // itinerary — never as a second call that can half-fail.
        ...(newEndDate ? { end_date: newEndDate } : {}),
        ...(newStartDate ? { start_date: newStartDate } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tripId);
    // Only onto the version the change was computed from: a save that landed
    // in between would otherwise be overwritten with this older copy.
    const readVersion = (trip as { itinerary_version?: unknown }).itinerary_version;
    if (typeof readVersion === "number") write = write.eq("itinerary_version", readVersion);
    // itinerary_version: the concierge adopts this reply without a refetch,
    // so it needs the version its new copy was written at.
    const { data: written, error: updateError } = await write.select("id, itinerary_version");

    if (updateError) {
      console.error("[AI Assistant Apply] Database update failed:", updateError);
      return errors.internal("Failed to save changes", "AI Assistant Apply");
    }

    if (!written || written.length === 0) {
      // No error and no row: the trip moved on since it was read, or the write
      // was refused. Saying "saved" here would be indistinguishable, to the
      // user, from the bug.
      if (typeof readVersion === "number") {
        const { data: now } = logReadError("assistant apply: version re-read", await supabase.from("trips").select("itinerary_version").eq("id", tripId).maybeSingle());
        const nowVersion = (now as { itinerary_version?: unknown } | null)?.itinerary_version;
        if (typeof nowVersion === "number" && nowVersion !== readVersion) {
          return apiError("The trip changed while this change was being applied", { status: 409, code: CODES.outdated });
        }
      }
      console.error("[AI Assistant Apply] Update matched no rows", { tripId });
      return errors.internal("Failed to save changes", "AI Assistant Apply");
    }

    if (typeof conversationId === "string" && conversationId) {
      await markProposalApplied(supabase, conversationId);
    }

    return apiSuccess({
      success: true,
      modifiedItinerary,
      itineraryVersion: (written[0] as { itinerary_version?: number }).itinerary_version,
      // add_day / shift_days: the persisted trip window, so the client can report it.
      ...(newEndDate ? { newEndDate } : {}),
      ...(newStartDate ? { newStartDate } : {}),
      action: {
        type: changeType,
        applied: true,
        dayNumber: appliedDayNumber,
        // apply_draft: drives the "{count} days updated" badge.
        ...(dayCount !== undefined ? { dayCount } : {}),
        activityName: name,
      },
    });
  } catch (error) {
    console.error("[AI Assistant Apply] Error:", error);

    // Capture to Sentry (task #223). Apply failures = silently lost
    // edits — user thinks the AI applied the change but it didn't.
    void recordAiOutcome({
      endpoint: "assistant",
      outcome: "failure",
      durationMs: Date.now() - requestStartTime,
      error,
      metadata: { subroute: "apply" },
    });

    return errors.internal("Failed to apply change", "AI Assistant Apply");
  }
}
