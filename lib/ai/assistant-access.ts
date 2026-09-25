import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who may use the trip assistant (/api/ai/assistant, its /apply and /undo).
 *
 * The owner and invited editors: the people who can change the trip by hand.
 * Until 2026-09-25 all three routes read the trip with `user_id = caller`, so
 * they were owner-only while the trip page showed the assistant to every role
 * (and opened it by itself on a first visit): a collaborator's first message
 * answered "Trip not found".
 *
 * Voters and viewers cannot change the trip, so they get no assistant; the
 * trip page hides it for them.
 */
export type AssistantRole = "owner" | "editor";

/**
 * The caller's assistant role on `trip`, or null when they may not use it.
 * `trip` is the row the route already read through the caller's own client
 * (RLS decides whether they can see it at all).
 */
export async function resolveAssistantRole(
  supabase: SupabaseClient,
  trip: { id: string; user_id: string | null },
  userId: string,
): Promise<AssistantRole | null> {
  if (trip.user_id === userId) return "owner";
  const { data } = await supabase
    .from("trip_collaborators")
    .select("role")
    .eq("trip_id", trip.id)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role === "editor" ? "editor" : null;
}

/**
 * Assistant changes that move the trip's dates. Owner-only, the same line
 * PATCH /api/trips/[id] draws: editors change what the trip contains, the
 * owner decides when it happens.
 */
export const DATE_CHANGING_ASSISTANT_CHANGES: ReadonlySet<string> = new Set(["add_day", "shift_days"]);

export const ASSISTANT_FORBIDDEN_MESSAGE = "Only the trip owner and editors can use the assistant on this trip";
export const ASSISTANT_DATES_OWNER_ONLY_MESSAGE =
  "Only the trip owner can add days or move the trip's dates. Ask them to make this change.";
