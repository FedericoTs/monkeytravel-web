import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import type { ItineraryDay } from "@/types";
import { errors, apiError, apiSuccess } from "@/lib/api/response-wrapper";
import { resolveAssistantRole, ASSISTANT_FORBIDDEN_MESSAGE } from "@/lib/ai/assistant-access";
import { ASSISTANT_ERROR_CODES } from "@/lib/ai/assistant/error-message";
import { recordAiOutcome } from "@/lib/ai/observability";
import { logReadError } from "@/lib/supabase/log-read-error";
import { readJsonBody } from "@/lib/api/json-body";
import { requireRow } from "@/lib/api/require-row";

interface UndoRequest {
  tripId: string;
  previousItinerary: ItineraryDay[];
  // Set when undoing an add_day: the append also extended trips.end_date,
  // so the undo must restore BOTH in the same write or the trip ends a day
  // after its own itinerary.
  previousEndDate?: string;
  /** The trip's itinerary_version right after the change: undo writes only onto it. */
  expectedVersion?: number;
}

export async function POST(request: NextRequest) {
  console.log("[AI Assistant Undo] POST request received");

  try {
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    const { body, invalidBody } = await readJsonBody<UndoRequest>(request);
    if (invalidBody) return invalidBody;
    const { tripId, previousItinerary, previousEndDate, expectedVersion } = body;

    if (!tripId || !Array.isArray(previousItinerary)) {
      return errors.badRequest("Missing tripId or previousItinerary");
    }

    // Light shape check — only a YYYY-MM-DD-ish string may touch end_date.
    const restoreEndDate =
      typeof previousEndDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(previousEndDate)
        ? previousEndDate.slice(0, 10)
        : null;

    // The owner and invited editors may undo an assistant change
    // (lib/ai/assistant-access.ts).
    const { row: trip, errorResponse: tripError } = await requireRow("trip", supabase
      .from("trips")
      .select("id, user_id")
      .eq("id", tripId)
      .single(), "Trip not found");
    if (tripError) return tripError;

    const assistantRole = await resolveAssistantRole(supabase, trip, user.id);
    if (!assistantRole) {
      return errors.forbidden(ASSISTANT_FORBIDDEN_MESSAGE, ASSISTANT_ERROR_CODES.notAllowed);
    }

    // Restore the previous itinerary (and, for add_day undos, the end date)
    let write = supabase
      .from("trips")
      .update({
        itinerary: previousItinerary,
        // Only the owner's undo restores the end date: an editor's change never
        // moved it (adding days is owner-only in /apply).
        ...(restoreEndDate && assistantRole === "owner" ? { end_date: restoreEndDate } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tripId);
    // Only while the trip is as the change left it: putting the old copy back
    // over a later save would wipe that save.
    if (typeof expectedVersion === "number") write = write.eq("itinerary_version", expectedVersion);
    const { data: written, error: updateError } = await write.select("id");

    if (updateError) {
      console.error("[AI Assistant Undo] Database update failed:", updateError);
      return errors.internal("Failed to undo changes", "AI Assistant Undo");
    }

    if (!written || written.length === 0) {
      if (typeof expectedVersion === "number") {
        const { data: now } = logReadError("assistant undo: version re-read", await supabase.from("trips").select("itinerary_version").eq("id", tripId).maybeSingle());
        const nowVersion = (now as { itinerary_version?: unknown } | null)?.itinerary_version;
        if (typeof nowVersion === "number" && nowVersion !== expectedVersion) {
          return apiError("The trip changed after this change", { status: 409, code: ASSISTANT_ERROR_CODES.outdated });
        }
      }
      console.error("[AI Assistant Undo] Update matched no rows", { tripId });
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
