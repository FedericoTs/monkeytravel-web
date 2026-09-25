import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Invite links after the group changes.
 *
 * An open invite link lets 20 people in and lasts ~10 years (since
 * 2026-09-25, so a group chat can use one link). Accepting only checks uses
 * left, active and expiry: a member the owner removed could walk straight back
 * in through the same link, and a demoted editor could leave and rejoin
 * through an editor link. So when the owner removes someone or lowers their
 * role, the trip's open links are switched off, along with any unused email
 * invite addressed to that person. Email invites to other people stay: they
 * are single-use and bound to their recipient. The owner makes a new link for
 * whoever should still join.
 */

const ROLE_RANK: Record<string, number> = { viewer: 0, voter: 1, editor: 2, owner: 3 };

/** True when a role change takes access away (editor -> voter, voter -> viewer, ...). */
export function isDemotion(fromRole: string | null | undefined, toRole: string): boolean {
  if (!fromRole || !(fromRole in ROLE_RANK) || !(toRole in ROLE_RANK)) return false;
  return ROLE_RANK[toRole] < ROLE_RANK[fromRole];
}

/**
 * Switch off the trip's active open links, and pending email invites to
 * `removedEmail` when given. Uses the caller's client: owners and editors may
 * update `is_active` on their trip's invites (20260924114000). Returns how
 * many invites were switched off; never throws, since the membership change
 * it follows has already happened.
 */
export async function resetInviteLinks(
  supabase: SupabaseClient,
  tripId: string,
  removedEmail?: string | null,
): Promise<number> {
  let reset = 0;
  try {
    const { data: open, error: openError } = await supabase
      .from("trip_invites")
      .update({ is_active: false })
      .eq("trip_id", tripId)
      .eq("is_active", true)
      .is("recipient_email", null)
      .select("id");
    if (openError) console.error("[Invites] Could not reset open links:", openError.message);
    reset += open?.length ?? 0;

    const email = removedEmail?.trim().toLowerCase();
    if (email) {
      const { data: addressed, error: addressedError } = await supabase
        .from("trip_invites")
        .update({ is_active: false })
        .eq("trip_id", tripId)
        .eq("is_active", true)
        .eq("recipient_email", email)
        .select("id");
      if (addressedError) console.error("[Invites] Could not reset email invites:", addressedError.message);
      reset += addressed?.length ?? 0;
    }
  } catch (err) {
    console.error("[Invites] Invite reset failed:", err);
  }
  return reset;
}
