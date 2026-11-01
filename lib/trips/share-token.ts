import { randomUUID } from "node:crypto";
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

/**
 * The trip's share token, minted when it has none. The write lands only where
 * there is still no token, so two requests at once end with one link: the
 * later one gets the token the first one wrote. A mint sets shared_at and the
 * given visibility ("public" keeps a listed trip listed). Call it only after
 * checking that the caller may share the trip. Throws when the token can't be
 * read or written.
 */
export async function ensureShareToken(
  tripId: string,
  visibility: "shared" | "public"
): Promise<{ token: string; isNew: boolean; sharedAt?: string }> {
  const existing = await readShareToken(tripId);
  if (existing) return { token: existing, isNew: false };

  const token = randomUUID();
  const sharedAt = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from("trips")
    .update({ share_token: token, shared_at: sharedAt, visibility })
    .eq("id", tripId)
    .is("share_token", null)
    .is("deleted_at", null)
    .select("id");
  if (error) throw error;
  if (data && data.length > 0) return { token, isNew: true, sharedAt };

  const current = await readShareToken(tripId);
  if (!current) throw new Error("No share token after the mint was refused");
  return { token: current, isNew: false };
}
