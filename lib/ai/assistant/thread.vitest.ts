// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { appendTurn, openThread, readThread, type AssistantMessage } from "./thread";

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
