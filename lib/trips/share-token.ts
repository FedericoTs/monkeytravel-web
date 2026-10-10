import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A trip's share token, read with the service role: anon and authenticated
 * cannot select the column, since whoever holds it can join the trip's group.
 * Call it only after checking that the caller owns the trip or is a member.
 * Throws on a failed read, so a caller never mistakes it for "no token yet".
 */
export async function readShareToken(tripId: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("trips")
    .select("share_token")
    .eq("id", tripId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data?.share_token as string | null | undefined) ?? null;
}
