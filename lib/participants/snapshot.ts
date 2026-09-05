import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_NAMES_MAX, type ParticipantsResponse } from "./shared";

/**
 * What the recipient page shows about a trip's group, plus the viewer's own
 * row. Service-role read (the table has no policies) — callers have already
 * proven possession of the share token.
 */
export async function participantsSnapshot(
  admin: SupabaseClient,
  tripId: string,
  cookieId: string | undefined,
): Promise<ParticipantsResponse> {
  const { data: rows, error } = await admin
    .from("trip_participants")
    .select("id, participant_cookie_id, display_name, email, joined_at")
    .eq("trip_id", tripId)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (error) {
    console.error("[participants] snapshot read failed:", error);
    return { count: 0, participants: [], me: { joined: false, display_name: null, has_email: false } };
  }
  const list = rows ?? [];
  const mine = cookieId ? list.find((r) => r.participant_cookie_id === cookieId) : undefined;
  return {
    count: list.length,
    participants: list.slice(0, PUBLIC_NAMES_MAX).map((r) => ({
      id: r.id as string,
      display_name: (r.display_name as string | null) ?? null,
      joined_at: r.joined_at as string,
    })),
    me: {
      joined: !!mine,
      display_name: (mine?.display_name as string | null) ?? null,
      has_email: !!mine?.email,
    },
  };
}
