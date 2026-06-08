import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";

/**
 * POST /api/trips/[id]/deletion-feedback
 *
 * Captures the "why did you discard" reason picked in the Start Over
 * modal (or, in the future, any other delete-confirm dialog). One row
 * per discard event in `trip_deletion_feedback`.
 *
 * Fired BEFORE the soft-delete itself so the row exists even if the
 * subsequent UPDATE fails. The feedback row is independently useful
 * (e.g. "x% of users start over citing wrong_dates within 5 min of
 * generation" is a PMF signal regardless of whether the deletion
 * happened cleanly).
 *
 * Why a separate route instead of folding into DELETE /api/trips/[id]?
 * Two reasons: (1) the reason picker is also useful for non-deletion
 * discards (e.g. wizard "Start Over" before any auto-save fires —
 * there's no trip row to DELETE), and (2) it keeps the DELETE route
 * idempotent + side-effect-free at the analytics layer.
 *
 * The `trip_id` query field can be a real UUID (auto-saved trip) or a
 * client-side temporary id (the wizard generates UUIDs before save).
 * The column is TEXT, not a FK, so either works.
 *
 * Privacy: NO free-text PII validation beyond a 500-char cap. We trust
 * the user not to write secrets in "tell us more"; the column lives
 * behind service-role-only RLS so it's not anon-readable anyway.
 */

interface DeletionFeedbackBody {
  reason?: string;
  custom_reason?: string;
  destination?: string;
  trip_age_seconds?: number;
  was_auto_saved?: boolean;
}

const VALID_REASONS = new Set([
  "wrong_destination",
  "wrong_dates",
  "didnt_like_suggestions",
  "too_expensive",
  "made_by_mistake",
  "other",
]);

const MAX_CUSTOM_REASON_LEN = 500;

export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;
    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    let body: DeletionFeedbackBody;
    try {
      body = (await request.json()) as DeletionFeedbackBody;
    } catch {
      return errors.badRequest("Invalid JSON body");
    }

    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!VALID_REASONS.has(reason)) {
      return errors.badRequest(
        `Invalid reason. Allowed: ${Array.from(VALID_REASONS).join(", ")}`
      );
    }

    const customReason =
      typeof body.custom_reason === "string"
        ? body.custom_reason.trim().slice(0, MAX_CUSTOM_REASON_LEN)
        : null;
    const destination =
      typeof body.destination === "string" ? body.destination.slice(0, 200) : null;
    const tripAgeSeconds =
      typeof body.trip_age_seconds === "number" &&
      Number.isFinite(body.trip_age_seconds)
        ? Math.max(0, Math.min(86400 * 30, Math.floor(body.trip_age_seconds)))
        : null;

    const { error } = await supabase
      .from("trip_deletion_feedback")
      .insert({
        user_id: user.id,
        trip_id: tripId,
        destination,
        reason,
        custom_reason: customReason || null,
        trip_age_seconds: tripAgeSeconds,
        was_auto_saved: Boolean(body.was_auto_saved),
      });

    if (error) {
      console.error("[deletion-feedback] insert failed", error);
      // Don't surface the error to the user — the deletion itself should
      // proceed even if feedback logging fails. Return success so the
      // client doesn't block on it.
      return apiSuccess({ logged: false });
    }

    return apiSuccess({ logged: true });
  } catch (err) {
    console.error("[deletion-feedback] unexpected error", err);
    // Same fail-open posture — never block the user's delete on
    // analytics infra.
    return apiSuccess({ logged: false });
  }
}
