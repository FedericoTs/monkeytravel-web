// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readActivityVotes } from "./read-votes";

/** A Supabase client that answers each table with a fixed result and records the calls. */
function fakeSupabase(results: Record<string, { data: unknown; error: unknown }>) {
  const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  const client = {
    from(table: string) {
      const call = { table, ops: [] as Array<[string, unknown[]]> };
      calls.push(call);
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      };
      for (const op of ["select", "eq", "in", "order"]) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return builder;
        };
      }
      return builder;
    },
  };
  return { supabase: client as unknown as SupabaseClient, calls };
}

const row = (id: string, userId: string, activityId = "act-1") => ({
  id,
  trip_id: "trip-1",
  activity_id: activityId,
  user_id: userId,
  vote_type: "love",
  comment: null,
  vote_weight: 1,
  voted_at: "2027-03-01T10:00:00Z",
  updated_at: "2027-03-01T10:00:00Z",
});

describe("readActivityVotes", () => {
  it("reads one activity's votes, oldest first, with each voter's public name and avatar", async () => {
    const { supabase, calls } = fakeSupabase({
      activity_votes: { data: [row("v1", "u1"), row("v2", "u2")], error: null },
      public_profiles: { data: [{ id: "u1", display_name: "Ana", avatar_url: "https://img/a.png" }, { id: "u2", display_name: "", avatar_url: null }], error: null },
    });
    const { votes, error } = await readActivityVotes(supabase, "trip-1", "act-1");

    expect(error).toBeNull();
    expect(calls[0].table).toBe("activity_votes");
    expect(calls[0].ops).toEqual([
      ["select", ["id, trip_id, activity_id, user_id, vote_type, comment, vote_weight, voted_at, updated_at"]],
      ["eq", ["trip_id", "trip-1"]],
      ["eq", ["activity_id", "act-1"]],
      ["order", ["voted_at", { ascending: true }]],
    ]);
    expect(votes.map((v) => v.user)).toEqual([
      { display_name: "Ana", avatar_url: "https://img/a.png" },
      { display_name: "Unknown", avatar_url: undefined },
    ]);
    expect(votes[0]).toMatchObject({ id: "v1", activity_id: "act-1", vote_type: "love", vote_weight: 1 });
  });

  it("reads the whole trip when no activity is given, and asks for each voter once", async () => {
    const { supabase, calls } = fakeSupabase({
      activity_votes: { data: [row("v1", "u1", "a"), row("v2", "u1", "b"), row("v3", "u3", "b")], error: null },
      public_profiles: { data: [{ id: "u1", display_name: "Ana", avatar_url: null }], error: null },
    });
    const { votes } = await readActivityVotes(supabase, "trip-1");

    expect(calls[0].ops.filter(([op]) => op === "eq")).toEqual([["eq", ["trip_id", "trip-1"]]]);
    expect(calls[1].ops).toContainEqual(["in", ["id", ["u1", "u3"]]]);
    // No profile: the vote has no user, rather than an empty name.
    expect(votes[2].user).toBeUndefined();
  });

  it("returns the read error, and no votes, without asking for profiles", async () => {
    const failure = { message: "boom", code: "XX000" };
    const { supabase, calls } = fakeSupabase({ activity_votes: { data: null, error: failure } });
    const { votes, error } = await readActivityVotes(supabase, "trip-1", "act-1");

    expect(error).toBe(failure);
    expect(votes).toEqual([]);
    expect(calls.map((c) => c.table)).toEqual(["activity_votes"]);
  });
});
