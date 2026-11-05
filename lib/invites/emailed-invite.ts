import { validateInvite, type InviteData } from "@/lib/api/invite-validation";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The token of a usable invite emailed to this address for this trip, if one is
 * waiting. Only the service role reads invites. The address must be the visitor's
 * own signed-in one, so this gives them only what was already sent to them.
 */
export async function emailedInviteToken(tripId: string, email: string | undefined): Promise<string | null> {
  if (!email) return null;
  const { data, error } = await createAdminClient()
    .from("trip_invites")
    .select("token, is_active, expires_at, max_uses, use_count")
    .eq("trip_id", tripId)
    .eq("recipient_email", email.trim().toLowerCase());
  if (error) {
    console.error("[emailed invite] read failed:", error.message);
    return null;
  }
  const usable = (data ?? []).find((invite) => validateInvite(invite as unknown as InviteData).valid);
  return usable?.token ?? null;
}
