import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Moves what this browser did as a guest to the account signed in on it: the
 * "I'm going" row, Today taps, payments and shares (link_guest_to_account).
 * One trip, or every trip when tripId is left out. Returns false if the move
 * failed, in which case nothing moved.
 */
export async function linkGuestToAccount(
  admin: SupabaseClient,
  userId: string,
  cookieId: string,
  tripId?: string,
): Promise<boolean> {
  const { error } = await admin.rpc("link_guest_to_account", {
    p_user_id: userId,
    p_cookie: cookieId,
    p_trip_id: tripId ?? null,
  });
  if (error) console.error("[participants] guest link failed:", error);
  return !error;
}
