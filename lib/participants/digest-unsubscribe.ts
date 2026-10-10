import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A guest's way out of a trip's daily plan. The digest fan-out mails the
 * trip's active rows that have an email, each address once, so stopping
 * clears that address from every row of the trip. "I'm going" is untouched;
 * giving an email again on the trip page opts back in.
 */

const address = (email: unknown) => (typeof email === "string" ? email.trim().toLowerCase() : "");

function fail(stage: "read" | "write", err: { message: string }): never {
  console.error(`[unsubscribe] guest digest ${stage} failed:`, err.message);
  throw new Error("Failed to update preferences");
}

/** The trip's name as the digest shows it, for the unsubscribe page; null when unknown. */
export async function guestDigestTripName(admin: SupabaseClient, participantId: string): Promise<string | null> {
  const { data: row } = await admin.from("trip_participants").select("trip_id").eq("id", participantId).maybeSingle();
  if (!row?.trip_id) return null;
  const { data: trip } = await admin.from("trips").select("title").eq("id", row.trip_id).maybeSingle();
  const name = typeof trip?.title === "string" ? trip.title.replace(/\s+Trip\s*$/i, "").trim() : "";
  return name || null;
}

/** Stops the trip's daily plan to this row's address. Idempotent; throws when the database fails. */
export async function stopGuestDigest(admin: SupabaseClient, participantId: string): Promise<{ applied: boolean }> {
  const { data: row, error } = await admin
    .from("trip_participants")
    .select("trip_id, email")
    .eq("id", participantId)
    .maybeSingle();
  if (error) fail("read", error);
  const email = address(row?.email);
  if (!row || !email) return { applied: false };

  const { data: rows, error: listErr } = await admin
    .from("trip_participants")
    .select("id, email")
    .eq("trip_id", row.trip_id);
  if (listErr) fail("read", listErr);
  const ids = (rows ?? []).filter((r) => address(r.email) === email).map((r) => r.id as string);

  const { error: writeErr } = await admin.from("trip_participants").update({ email: null }).in("id", ids);
  if (writeErr) fail("write", writeErr);
  return { applied: true };
}
