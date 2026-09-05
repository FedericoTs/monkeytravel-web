/**
 * DELETE /api/trips/[id]/participants/[participantId] — owner removes a
 * participant (Phase 2.4). Soft: sets left_at, so the tap stays in the
 * rate history and the person can say they're going again.
 */
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { RouteContext } from "@/lib/api/route-context";
import { isUuid } from "@/lib/participants/shared";

type Ctx = RouteContext<{ id: string; participantId: string }>;

export async function DELETE(_request: NextRequest, context: Ctx) {
  try {
    const { id, participantId } = await context.params;
    if (!id || !isUuid(id) || !participantId || !isUuid(participantId)) {
      return errors.badRequest("Invalid id");
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return errors.unauthorized("Sign in required");

    const admin = createAdminClient();
    const { data: trip } = await admin
      .from("trips")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();
    if (!trip || trip.user_id !== auth.user.id) return errors.notFound("Trip not found");

    const { data: row, error } = await admin
      .from("trip_participants")
      .update({ left_at: new Date().toISOString() })
      .eq("id", participantId)
      .eq("trip_id", trip.id)
      .is("left_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[Trip Participants] remove failed:", error);
      return errors.internal("Could not remove participant", "TripParticipants");
    }
    return apiSuccess({ removed: !!row });
  } catch (err) {
    console.error("[Trip Participants] Unexpected error:", err);
    return errors.internal("Internal server error", "TripParticipants");
  }
}
