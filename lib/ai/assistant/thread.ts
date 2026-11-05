import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_SURFACE, isConciergeRow } from "@/lib/ai/conversations";
import { isNoRow } from "@/lib/supabase/no-row";
import { logReadError } from "@/lib/supabase/log-read-error";
import { logWriteError } from "@/lib/supabase/log-write-error";
import type { AssistantCard, StructuredAssistantResponse } from "@/types";

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
     * a fact.
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

/** The user's side of a turn, as the thread keeps it. */
export function userMessage(content: string): AssistantMessage {
  return { role: "user", content, timestamp: new Date().toISOString() };
}

/**
 * The assistant's side of a turn, as the thread keeps it and the chat shows it:
 * the reply made honest, and what that changed (lib/ai/assistant/honesty.ts).
 */
export function assistantMessage(
  reply: StructuredAssistantResponse,
  { guarded, pendingNote }: { guarded: boolean; pendingNote?: string }
): AssistantMessage {
  return {
    role: "assistant",
    content: reply.summary,
    cards: reply.cards,
    action: reply.action
      ? {
          type: reply.action.type,
          applied: reply.action.applied,
          // Kept so the history can be read back as evidence: without it, a
          // change prepared and never confirmed reads like a saved one.
          pending: reply.action.pending,
          activityId: reply.action.activityId,
          dayNumber: reply.action.dayNumber,
          dayCount: reply.action.dayCount,
        }
      : undefined,
    ...(guarded ? { guarded: true } : {}),
    ...(pendingNote ? { pendingNote } : {}),
    timestamp: new Date().toISOString(),
  };
}

/**
 * The caller's trip-assistant threads on this trip, latest first. The
 * concierge's rows share the table, and this chat never shows them. A refused
 * read throws: an empty history would read as "you have no threads".
 */
export async function listThreads(supabase: SupabaseClient, tripId: string, userId: string) {
  const { data: rows, error } = await supabase
    .from("ai_conversations")
    .select("id, created_at, updated_at, messages, context")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (rows ?? [])
    .filter((row) => !isConciergeRow(row.context))
    .map(({ id, created_at, updated_at, messages }) => ({ id, created_at, updated_at, messages }));
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

/**
 * Notes in the thread that the change it proposed was saved: the most recent
 * assistant message with an action, unless that one is applied already. The
 * thread is the only lasting record of what happened: without this, a confirmed
 * change and an abandoned one read the same after a reload, as "no changes made",
 * and people ask for the same edit again.
 *
 * Best effort: failing to note it must not fail a write that succeeded.
 */
export async function markProposalApplied(supabase: SupabaseClient, conversationId: string): Promise<void> {
  try {
    const { data: conv } = logReadError("assistant apply: conversation", await supabase
      .from("ai_conversations")
      .select("messages")
      .eq("id", conversationId)
      .maybeSingle());
    const msgs = Array.isArray(conv?.messages) ? [...(conv!.messages as unknown[])] : [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i] as { role?: string; action?: Record<string, unknown> } | null;
      if (!m || m.role !== "assistant" || !m.action) continue;
      if (m.action.applied === true) break;
      msgs[i] = { ...m, action: { ...m.action, applied: true, pending: false } };
      logWriteError("assistant apply: conversation note", await supabase
        .from("ai_conversations")
        .update({ messages: msgs, updated_at: new Date().toISOString() })
        .eq("id", conversationId));
      break;
    }
  } catch (err) {
    console.error("[AI Assistant Apply] Could not annotate conversation", err);
  }
}
