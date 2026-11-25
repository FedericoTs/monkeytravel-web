/**
 * The owner's email when someone going adds what they don't want to miss on
 * the share link. At most one a trip a day: the first picks of the day send
 * it, and the trip page shows any that come after. Best-effort: a failure is
 * logged and never fails the request that saved the picks.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchEmail } from "@/lib/email/send";
import { getTripDestination } from "@/lib/trips/destination";

export interface PicksEmail {
  tripId: string;
  /** The "I'm going" row the picks are on. */
  participantId: string;
  /** The account of the person going, when signed in: the owner is never emailed about their own picks. */
  guestUserId: string | null;
  guestName: string | null;
  picks: string[];
}

/** One email a trip a day, whoever sends picks that day. */
export function picksEmailKey(tripId: string, now: Date): string {
  return `picks:${tripId}:${now.toISOString().slice(0, 10)}`;
}

export async function sendPicksEmail(p: PicksEmail): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: trip, error: tripError } = await admin
      .from("trips")
      .select("user_id, title, trip_meta")
      .eq("id", p.tripId)
      .is("deleted_at", null)
      .maybeSingle();
    if (tripError) {
      console.error("[notifications] picks email lookup failed", { tripId: p.tripId, table: "trips", error: tripError.message });
      return;
    }
    if (!trip?.user_id || trip.user_id === p.guestUserId) return;

    const { data: owner, error: ownerError } = await admin.from("users").select("email").eq("id", trip.user_id).maybeSingle();
    if (ownerError) {
      console.error("[notifications] picks email lookup failed", { tripId: p.tripId, table: "users", error: ownerError.message });
      return;
    }
    if (!owner?.email) return;

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";
    await dispatchEmail({
      recipientEmail: owner.email,
      recipientUserId: trip.user_id,
      idempotencyKey: picksEmailKey(p.tripId, new Date()),
      template: {
        id: "picks_added",
        props: {
          guestName: p.guestName,
          picks: p.picks,
          tripTitle: trip.title ?? "",
          tripDestination: getTripDestination(trip),
          // Opens the trip on "Who's going", where the picks wait with their button.
          tripUrl: `${APP_URL}/trips/${p.tripId}?open=who`,
        },
      },
      // How many, never what they say.
      metadata: { trip_id: p.tripId, participant_id: p.participantId, picks: p.picks.length },
    });
  } catch (err) {
    console.error("[notifications] picks email exception", {
      tripId: p.tripId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
