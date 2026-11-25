// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase } from "@/tests/fake-supabase";

/** A trip's feed shows what it can read, so one source failing doesn't take the rest with it. */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/today/snapshot", () => ({
  todayActionsSnapshot: async () => [
    { id: "a1", action_type: "skip", created_at: "2027-05-10T10:00:00Z", actor_name: "Luca", actor_role: "participant", activity_id: null },
  ],
}));

const { feedSnapshot } = await import("./snapshot");

const TRIP = { id: "trip-1", user_id: "owner-1", itinerary: [] };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Today feed", () => {
  it("merges the joins and the chips, newest first, and reads no payments", async () => {
    const db = fakeSupabase(() => ({ data: [{ id: "p1", display_name: "Ana", joined_at: "2027-05-10T11:00:00Z" }], error: null }));
    const events = await feedSnapshot(db.client as unknown as SupabaseClient, TRIP, undefined, null);
    expect(events.map((event) => event.id)).toEqual(["join:p1", "act:a1"]);
    expect(db.log.map((q) => q.table)).toEqual(["trip_participants"]);
  });

  it("still shows the chips when the joins can't be read", async () => {
    const db = fakeSupabase(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }));
    const events = await feedSnapshot(db.client as unknown as SupabaseClient, TRIP, undefined, null);
    expect(events.map((event) => event.id)).toEqual(["act:a1"]);
    expect(console.error).toHaveBeenCalled();
  });
});
