import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_SURFACE, isConciergeRow } from "@/lib/ai/conversations";
import { isNoRow } from "@/lib/supabase/no-row";

/**
 * The caller's trip-assistant thread with this id, or null when there is none:
 * gone, someone else's, or the concierge's (the two chats share the table and
 * never show each other's threads). A refused read throws: answering as if
 * there were no thread would fork it.
 */
export async function readThread(supabase: SupabaseClient, conversationId: string, userId: string) {
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single();
  if (error && !isNoRow(error)) throw error;
  return data && !isConciergeRow(data.context) ? data : null;
}

/**
 * The thread a turn continues: the one asked for, else a new one for the trip.
 * Throws when the thread cannot be read or made, since the reply could not be
 * kept.
 */
export async function openThread<Message>(
  supabase: SupabaseClient,
  { conversationId, userId, tripId }: { conversationId?: string; userId: string; tripId: string }
): Promise<{ id: string; messages: Message[] }> {
  const existing = conversationId ? await readThread(supabase, conversationId, userId) : null;
  if (existing) return { id: existing.id, messages: existing.messages as Message[] };

  const { data: newConvo, error: newConvoError } = await supabase
    .from("ai_conversations")
    .insert({ user_id: userId, trip_id: tripId, messages: [], context: { surface: ASSISTANT_SURFACE } })
    .select()
    .single();
  if (newConvoError) throw newConvoError;
  return { id: newConvo?.id || "", messages: [] };
}
