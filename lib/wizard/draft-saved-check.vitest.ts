/** @vitest-environment node */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedItinerary } from "@/types";
import { firstActivityId, isItinerarySaved } from "./draft-saved-check";

/**
 * Has the draft's itinerary already been saved as one of the user's trips?
 * Restoring such a draft is how the wizard made duplicate trips (2026-09-26).
 */

const itinerary = (ids: Array<string | undefined>[]) =>
  ({ days: ids.map((dayIds, i) => ({ day_number: i + 1, activities: dayIds.map((id) => ({ id, name: "x" })) })) }) as unknown as GeneratedItinerary;

/** A stand-in for the Supabase query chain that records the filters it was given. */
function fakeSupabase(result: { data?: unknown[] | null; error?: unknown } | "hang" | "throw") {
  const calls: Record<string, unknown[]> = {};
  const chain = {
    from: (t: string) => ((calls.from = [t]), chain),
    select: (c: string) => ((calls.select = [c]), chain),
    eq: (c: string, v: unknown) => ((calls.eq = [c, v]), chain),
    contains: (c: string, v: unknown) => ((calls.contains = [c, v]), chain),
    limit: async (n: number) => {
      calls.limit = [n];
      if (result === "hang") return new Promise(() => {});
      if (result === "throw") throw new Error("network");
      return result;
    },
  };
  return { supabase: chain as unknown as SupabaseClient, calls };
}

describe("firstActivityId", () => {
  it("is the first activity that has an id, skipping empty days", () => {
    expect(firstActivityId(itinerary([[], [undefined, "act_2"], ["act_3"]]))).toBe("act_2");
  });

  it("is null when nothing has an id", () => {
    expect(firstActivityId(itinerary([[undefined]]))).toBeNull();
    expect(firstActivityId(null)).toBeNull();
  });
});

describe("isItinerarySaved", () => {
  it("looks for one of the user's trips holding the first activity id, as jsonb", async () => {
    const { supabase, calls } = fakeSupabase({ data: [{ id: "trip-1" }] });
    expect(await isItinerarySaved(supabase, "user-1", itinerary([["act_1", "act_2"]]))).toBe(true);
    expect(calls.from).toEqual(["trips"]);
    expect(calls.eq).toEqual(["user_id", "user-1"]);
    // A JSON string: a JS array would be serialized as a Postgres array
    // literal and never match the jsonb column.
    expect(calls.contains).toEqual(["itinerary", '[{"activities":[{"id":"act_1"}]}]']);
  });

  it("is false when no trip holds it", async () => {
    const { supabase } = fakeSupabase({ data: [] });
    expect(await isItinerarySaved(supabase, "user-1", itinerary([["act_1"]]))).toBe(false);
  });

  it("fails open on an error, a throw, a hang or an itinerary without ids", async () => {
    expect(await isItinerarySaved(fakeSupabase({ data: null, error: { message: "boom" } }).supabase, "u", itinerary([["a"]]))).toBe(false);
    expect(await isItinerarySaved(fakeSupabase("throw").supabase, "u", itinerary([["a"]]))).toBe(false);
    vi.useFakeTimers();
    const pending = isItinerarySaved(fakeSupabase("hang").supabase, "u", itinerary([["a"]]), 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBe(false);
    vi.useRealTimers();
    const { supabase, calls } = fakeSupabase({ data: [{ id: "t" }] });
    expect(await isItinerarySaved(supabase, "u", itinerary([[undefined]]))).toBe(false);
    expect(calls.from).toBeUndefined();
  });
});
