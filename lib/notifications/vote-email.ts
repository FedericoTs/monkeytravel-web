/**
 * The vote email: tells a trip's owner that a collaborator voted on one of
 * its activities. Best-effort: a failure is logged and never fails the vote.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchEmail } from "@/lib/email/send";
import type { VoteType } from "@/types";
import { getTripDestination } from "@/lib/trips/destination";

export interface VoteEmail {
  ownerId: string;
  voterId: string;
  tripId: string;
  activityId: string;
  voterName: string;
  /** The activity's name, or its id when it is no longer in the trip. */
  activityLabel: string;
  vote: VoteType;
}

export async function sendVoteEmail(v: VoteEmail): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: owner, error: ownerError } = await admin
      .from("users")
      .select("email")
      .eq("id", v.ownerId)
      .maybeSingle();
    if (ownerError) {
      console.error("[notifications] email lookup failed", { tripId: v.tripId, table: "users", error: ownerError.message });
      return;
    }
    if (!owner?.email) return;

    const { data: trip, error: tripError } = await admin
      .from("trips")
      .select("title, trip_meta")
      .eq("id", v.tripId)
      .is("deleted_at", null)
      .maybeSingle();
    if (tripError) {
      console.error("[notifications] email lookup failed", { tripId: v.tripId, table: "trips", error: tripError.message });
      return;
    }
    if (!trip) return;
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

    await dispatchEmail({
      recipientEmail: owner.email,
      recipientUserId: v.ownerId,
      // One email per voter and activity, however often the vote is undone and cast again.
      idempotencyKey: `vote:${v.tripId}:${v.activityId}:${v.voterId}`,
      template: {
        id: "vote_cast",
        props: {
          voterName: v.voterName,
          tripTitle: trip.title ?? "",
          tripDestination: getTripDestination(trip),
          voteType: v.vote,
          activityLabel: v.activityLabel,
          tripUrl: `${APP_URL}/trips/${v.tripId}`,
        },
      },
      metadata: { trip_id: v.tripId, activity_id: v.activityId },
    });
  } catch (err) {
    console.error("[notifications] email dispatch exception", {
      tripId: v.tripId,
      ownerId: v.ownerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
