/**
 * GET /api/trips/[id]/participants — the owner's "Who's going" (Phase 2.4)
 *
 * Owner only (trips.user_id = the signed-in user). Returns the trip's group
 * as the expense split sees it (lib/trips/roster): the owner, every
 * collaborator and everyone who said they're going, once each, with their
 * role, whether they said they're going, whether they share new expenses,
 * and whether they gave an email or hold an account — never the email
 * itself. `count` is the people who share expenses. `picks` lists the
 * must-dos people going through the share link added, with who added them
 * and whether they were fitted in. Service-role read behind the ownership
 * check; the tables have no policies for this.
 */
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyTripOwnership } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import type { TripRouteContext } from "@/lib/api/route-context";
import { type OwnerParticipant, type OwnerPicks } from "@/lib/participants/shared";
import { publicNameOrNull } from "@/lib/profile/public-name";
import { sharesExpenses, tripRoster } from "@/lib/trips/roster";
import { isUuid } from "@/lib/utils/uuid";

export async function GET(_request: NextRequest, context: TripRouteContext) {
  try {
    const { id } = await context.params;
    if (!id || !isUuid(id)) return errors.badRequest("Invalid trip id");

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return errors.unauthorized("Sign in required");

    const admin = createAdminClient();
    const { trip, errorResponse: ownerError } = await verifyTripOwnership(admin, id, auth.user.id);
    if (ownerError) return ownerError;

    const { roster, error } = await tripRoster(admin, trip);
    if (error) {
      console.error("[Trip Participants] read failed:", error);
      return errors.internal("Could not load participants", "TripParticipants");
    }

    // Accounts by their public profile name, else the name they gave when
    // they said they're going.
    const accountIds = roster.map((p) => p.userId).filter((u): u is string => !!u);
    const profileNames = new Map<string, string>();
    if (accountIds.length > 0) {
      const { data: profiles, error: profileError } = await admin.from("public_profiles").select("id, display_name").in("id", accountIds);
      if (profileError) console.error("[Trip Participants] name read failed:", profileError);
      for (const p of profiles ?? []) {
        const name = publicNameOrNull(p.display_name as string | null, null);
        if (name) profileNames.set(p.id as string, name);
      }
    }

    const nameOf = (p: (typeof roster)[number]) => (p.userId ? profileNames.get(p.userId) : undefined) ?? p.name;
    const participants: OwnerParticipant[] = roster.map((p) => ({
      id: p.participant?.id ?? (p.userId as string),
      display_name: nameOf(p),
      role: p.role,
      going: p.going,
      in_split: sharesExpenses(p),
      has_account: !!p.userId,
      has_email: p.participant?.hasEmail ?? false,
      joined_at: p.participant?.joinedAt ?? null,
      participant_id: p.participant?.id ?? null,
    }));
    // Picks come through the share link only: the public page asks for none.
    const picks: OwnerPicks[] = roster.flatMap((p) =>
      p.participant?.picks && p.participant.picksAt && p.participant.source !== "public"
        ? [
            {
              participant_id: p.participant.id,
              display_name: nameOf(p),
              picks: p.participant.picks,
              picks_at: p.participant.picksAt,
              picks_placed_at: p.participant.picksPlacedAt ?? null,
            },
          ]
        : [],
    );
    return apiSuccess({ count: participants.filter((p) => p.in_split).length, participants, picks });
  } catch (err) {
    console.error("[Trip Participants] Unexpected error:", err);
    return errors.internal("Internal server error", "TripParticipants");
  }
}
