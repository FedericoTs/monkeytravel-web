/**
 * GET /api/trips/[id]/participants — the owner's "Who's going" (Phase 2.4)
 *
 * Owner only (trips.user_id = the signed-in user). Returns every active
 * participant with name, join time, source and whether they gave an email
 * or hold an account — never the email itself. Service-role read behind the
 * ownership check; the table has no policies.
 */
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import { isUuid, type OwnerParticipant } from "@/lib/participants/shared";

export async function GET(_request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    if (!id || !isUuid(id)) return errors.badRequest("Invalid trip id");

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

    const { data: rows, error } = await admin
      .from("trip_participants")
      .select("id, display_name, joined_at, source, email, user_id")
      .eq("trip_id", trip.id)
      .is("left_at", null)
      .order("joined_at", { ascending: true });
    if (error) {
      console.error("[Trip Participants] read failed:", error);
      return errors.internal("Could not load participants", "TripParticipants");
    }
    const participants: OwnerParticipant[] = (rows ?? []).map((r) => ({
      id: r.id as string,
      display_name: (r.display_name as string | null) ?? null,
      joined_at: r.joined_at as string,
      source: r.source as OwnerParticipant["source"],
      has_email: !!r.email,
      has_account: !!r.user_id,
    }));
    return apiSuccess({ count: participants.length, participants });
  } catch (err) {
    console.error("[Trip Participants] Unexpected error:", err);
    return errors.internal("Internal server error", "TripParticipants");
  }
}
