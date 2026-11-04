import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_SURFACE, isConciergeRow } from "@/lib/ai/conversations";
import { isNoRow } from "@/lib/supabase/no-row";
import { logWriteError } from "@/lib/supabase/log-write-error";
import type { AssistantCard } from "@/types";

/** One message of a trip-assistant thread, as ai_conversations keeps it. */
export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  /**
   * The model's reply claimed a change that was not saved, and the honesty
   * guard replaced it (lib/ai/assistant/honesty.ts). Kept so the rate can be
   * read back from ai_conversations.
   */
  guarded?: boolean;
  /**
   * That the change waits for the Apply button. Beside the reply, not in it:
   * the chat shows it only while the change waits (AIAssistantEnhanced).
   */
  pendingNote?: string;
  cards?: AssistantCard[];
  action?: {
    type: string;
    /**
     * TRUE only when a database write for this change SUCCEEDED on this
     * request. It was previously a literal `true` written at construction
     * time, before any write was attempted, so it was a constant rather than
     * a fact — 158 of 161 recorded actions said `applied: true` while users
     * were telling us in the same thread that nothing had changed.
     */
    applied: boolean;
    /**
     * The change is prepared and waiting for the user to tap Apply. Nothing
     * is saved. `applied` and `pending` are never both true.
     */
    pending?: boolean;
    activityId?: string;
    dayNumber?: number;
    // apply_draft: number of days revised — the client badge renders
    // "{count} days updated" from this (metadata, never model prose).
    dayCount?: number;
  };
  timestamp: string;
}

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
export async function openThread(
  supabase: SupabaseClient,
  { conversationId, userId, tripId }: { conversationId?: string; userId: string; tripId: string }
): Promise<{ id: string; messages: AssistantMessage[] }> {
  const existing = conversationId ? await readThread(supabase, conversationId, userId) : null;
  if (existing) return { id: existing.id, messages: existing.messages as AssistantMessage[] };

  const { data: newConvo, error: newConvoError } = await supabase
    .from("ai_conversations")
    .insert({ user_id: userId, trip_id: tripId, messages: [], context: { surface: ASSISTANT_SURFACE } })
    .select()
    .single();
  if (newConvoError) throw newConvoError;
  return { id: newConvo?.id || "", messages: [] };
}

/**
 * Keeps a turn: its messages after the thread's. A refused write is logged, not
 * thrown: the reply is answered anyway.
 */
export async function appendTurn(
  supabase: SupabaseClient,
  thread: { id: string; messages: AssistantMessage[] },
  turn: AssistantMessage[]
): Promise<void> {
  logWriteError("assistant: conversation", await supabase
    .from("ai_conversations")
    .update({
      messages: [...thread.messages, ...turn],
      updated_at: new Date().toISOString(),
    })
    .eq("id", thread.id));
}
