// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase } from "@/tests/fake-supabase";

/** A trip's feed shows what it can read, so one source failing doesn't take the rest with it. */

const s = vi.hoisted(() => ({ expensesFail: false }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/today/snapshot", () => ({
  todayActionsSnapshot: async () => [
    { id: "a1", action_type: "skip", created_at: "2027-05-10T10:00:00Z", actor_name: "Luca", actor_role: "participant", activity_id: null },
  ],
}));
vi.mock("@/lib/expenses/snapshot", () => ({
  expensesSnapshot: async () => {
    if (s.expensesFail) throw new Error("Could not read the expenses: timeout");
    return {
      expenses: [
        { id: "e1", createdAt: "2027-05-10T11:00:00Z", paidByName: "Ana", paidByIsOwner: true, activityId: null, amountCents: 1200, currency: "EUR" },
      ],
      summary: null,
    };
  },
}));

const { feedSnapshot } = await import("./snapshot");

const read = () =>
  feedSnapshot(fakeSupabase(() => ({ data: [], error: null })).client as unknown as SupabaseClient, { id: "trip-1", user_id: "owner-1", itinerary: [] }, undefined, null);

beforeEach(() => {
  s.expensesFail = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Today feed", () => {
  it("merges the chips and the payments, newest first", async () => {
    expect((await read()).map((event) => event.id)).toEqual(["exp:e1", "act:a1"]);
  });

  it("still shows the chips when the payments can't be read", async () => {
    s.expensesFail = true;
    expect((await read()).map((event) => event.id)).toEqual(["act:a1"]);
    expect(console.error).toHaveBeenCalled();
  });
});
