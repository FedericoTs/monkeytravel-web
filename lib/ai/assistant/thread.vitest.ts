// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CONCIERGE_SURFACE } from "@/lib/ai/conversations";
import { appendTurn, assistantMessage, listThreads, openThread, readThread, userMessage, type AssistantMessage } from "./thread";

/**
 * The trip assistant and the concierge keep their threads in one table and
 * never show each other's. A turn continues the thread it names, else starts
 * one marked as the assistant's; a refused read or write stops the turn, since
 * answering anyway would fork the thread or lose the reply.
 */

type Row = { id: string; messages: unknown[]; context: unknown } | null;
function fakeSupabase(read: { data: Row; error: { code: string; message: string } | null }, insertError: { message: string } | null = null) {
  const writes: unknown[] = [];
  const from = () => {
    let inserting = false;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.insert = (value: unknown) => {
      inserting = true;
      writes.push(value);
      return chain;
    };
    chain.single = async () => (inserting ? { data: insertError ? null : { id: "new-thread" }, error: insertError } : read);
    return chain;
  };
  return { client: { from } as never, writes };
}

const thread = { id: "conv-1", messages: [{ role: "user", content: "Add nightclubs" }], context: { surface: "trip_assistant" } };
const concierge = { ...thread, context: { surface: "concierge_f4" } };
const noRow = { code: "PGRST116", message: "no rows" };

describe("the messages of a turn", () => {
  it("keeps the user's words", () => {
    expect(userMessage("Add a day")).toEqual({ role: "user", content: "Add a day", timestamp: expect.any(String) });
  });

  it("keeps the reply, and of its action what the history needs, not the days it carries", () => {
    const message = assistantMessage(
      {
        summary: "Ready.",
        cards: [],
        action: { type: "apply_draft", applied: false, pending: true, dayNumber: 2, dayCount: 3, revisedDays: [{ day_number: 2 }] as never },
      },
      { guarded: false }
    );
    expect(message).toEqual({
      role: "assistant",
      content: "Ready.",
      cards: [],
      action: { type: "apply_draft", applied: false, pending: true, activityId: undefined, dayNumber: 2, dayCount: 3 },
      timestamp: expect.any(String),
    });
  });

  it("says when the words were replaced and what waits for the button, and only then", () => {
    const reply = { summary: "Ready.", cards: [] };
    expect(assistantMessage(reply, { guarded: true, pendingNote: "Not saved yet." })).toMatchObject({ guarded: true, pendingNote: "Not saved yet.", action: undefined });
    const plain = assistantMessage(reply, { guarded: false });
    expect(plain).not.toHaveProperty("guarded");
    expect(plain).not.toHaveProperty("pendingNote");
  });
});

describe("a trip's threads", () => {
  const rows = (result: { data: unknown[] | null; error: unknown }) => {
    const filters: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (...args: unknown[]) => (filters.push(args), chain);
    chain.order = () => Promise.resolve(result);
    return { client: { from: () => chain } as never, filters };
  };
  const row = (id: string, context: unknown) => ({ id, created_at: "c", updated_at: "u", messages: [], context });

  it("are the caller's on this trip, without the concierge's, and without their context", async () => {
    const { client, filters } = rows({ data: [row("a", {}), row("b", { surface: CONCIERGE_SURFACE }), row("c", null)], error: null });
    expect(await listThreads(client, "trip-1", "user-1")).toEqual([
      { id: "a", created_at: "c", updated_at: "u", messages: [] },
      { id: "c", created_at: "c", updated_at: "u", messages: [] },
    ]);
    expect(filters).toEqual([["trip_id", "trip-1"], ["user_id", "user-1"]]);
  });

  it("are none when there are none, and not guessed when the read is refused", async () => {
    expect(await listThreads(rows({ data: null, error: null }).client, "trip-1", "user-1")).toEqual([]);
    const refused = { code: "57014", message: "timeout" };
    await expect(listThreads(rows({ data: null, error: refused }).client, "trip-1", "user-1")).rejects.toBe(refused);
  });
});

describe("the assistant's thread, by id", () => {
  it("is the caller's thread, and nothing for a concierge thread or a missing one", async () => {
    expect(await readThread(fakeSupabase({ data: thread, error: null }).client, "conv-1", "u1")).toEqual(thread);
    expect(await readThread(fakeSupabase({ data: concierge, error: null }).client, "conv-1", "u1")).toBeNull();
    expect(await readThread(fakeSupabase({ data: null, error: noRow }).client, "conv-1", "u1")).toBeNull();
  });

  it("is not guessed when the read is refused", async () => {
    await expect(readThread(fakeSupabase({ data: null, error: { code: "57014", message: "timeout" } }).client, "conv-1", "u1")).rejects.toMatchObject({ code: "57014" });
  });
});

describe("the thread a turn continues", () => {
  it("is the one it names", async () => {
    const db = fakeSupabase({ data: thread, error: null });
    expect(await openThread(db.client, { conversationId: "conv-1", userId: "u1", tripId: "t1" })).toEqual({ id: "conv-1", messages: thread.messages });
    expect(db.writes).toEqual([]);
  });

  it("is a new one for the trip, marked as the assistant's, when there is none to continue", async () => {
    for (const [read, conversationId] of [[{ data: concierge, error: null }, "conv-1"], [{ data: null, error: noRow }, "conv-1"], [{ data: thread, error: null }, undefined]] as const) {
      const db = fakeSupabase(read);
      expect(await openThread(db.client, { conversationId, userId: "u1", tripId: "t1" })).toEqual({ id: "new-thread", messages: [] });
      expect(db.writes).toEqual([{ user_id: "u1", trip_id: "t1", messages: [], context: { surface: "trip_assistant" } }]);
    }
  });

  it("stops the turn when the new thread cannot be made", async () => {
    const db = fakeSupabase({ data: null, error: noRow }, { message: "denied" });
    await expect(openThread(db.client, { conversationId: "conv-1", userId: "u1", tripId: "t1" })).rejects.toMatchObject({ message: "denied" });
  });
});

describe("keeping a turn", () => {
  const turn: AssistantMessage[] = [
    { role: "user", content: "Make day 2 cheaper", timestamp: "2026-11-04T12:00:00Z" },
    { role: "assistant", content: "Ready: two free museums on Day 2.", timestamp: "2026-11-04T12:00:01Z" },
  ];
  const kept = { id: "conv-1", messages: [{ role: "user", content: "Add nightclubs", timestamp: "2026-11-04T11:00:00Z" }] as AssistantMessage[] };
  function updates(error: { message: string } | null = null) {
    const rows: Array<{ value: Record<string, unknown>; id: unknown }> = [];
    const client = {
      from: () => ({
        update: (value: Record<string, unknown>) => ({
          eq: async (_column: string, id: unknown) => {
            rows.push({ value, id });
            return { error };
          },
        }),
      }),
    } as never;
    return { client, rows };
  }

  it("adds its messages after the thread's", async () => {
    const db = updates();
    await appendTurn(db.client, kept, turn);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].id).toBe("conv-1");
    expect(db.rows[0].value.messages).toEqual([...kept.messages, ...turn]);
    expect(typeof db.rows[0].value.updated_at).toBe("string");
  });

  it("is logged, not thrown, when the write is refused: the reply is still answered", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(appendTurn(updates({ message: "denied" }).client, kept, turn)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
