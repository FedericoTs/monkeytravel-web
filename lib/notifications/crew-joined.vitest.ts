/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * A guest names themselves after tapping "I'm going", so the bell reads the
 * name from their "I'm going" row when it lists, not from the tap: a guest by
 * the name they gave, an account by its public name.
 */

const row = (id: string, type: string, payload: Record<string, unknown>) => ({
  id,
  user_id: "owner-1",
  type,
  payload,
  read_at: null,
  created_at: "2026-10-02T10:00:00Z",
  deleted_at: null,
});

const userClient = fakeSupabase((q) =>
  q.table === "notifications"
    ? {
        data: [
          row("n1", "crew_joined", { message: 'Someone is going on "Lisbon"', tripName: "Lisbon", participant_id: "p-guest", name: null }),
          row("n2", "crew_joined", { message: 'Someone is going on "Lisbon"', tripName: "Lisbon", participant_id: "p-account", name: null }),
          row("n3", "anon_vote", { message: "Bo started voting" }),
        ],
        error: null,
      }
    : { data: null, error: null },
);
const admin = fakeSupabase((q) => {
  if (q.table === "trip_participants")
    return {
      data: [
        { id: "p-guest", user_id: null, display_name: "Bo" },
        { id: "p-account", user_id: "user-9", display_name: null },
      ],
      error: null,
    };
  if (q.table === "public_profiles") return { data: [{ id: "user-9", display_name: "Ana" }], error: null };
  return { data: null, error: null };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...userClient.client, auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("@/lib/email/send", () => ({ dispatchEmail: vi.fn() }));
vi.mock("@/lib/push/dispatch", () => ({ dispatchPush: vi.fn() }));

const { listNotifications } = await import("./service");

describe("listNotifications names who said they're going", () => {
  it("as they are named now: a guest by the name they gave, an account by its public name", async () => {
    const { notifications } = await listNotifications({ includeRead: true });
    const names = Object.fromEntries(notifications.map((n) => [n.id, n.payload.name]));
    expect(names).toEqual({ n1: "Bo", n2: "Ana", n3: undefined });

    const [people] = admin.log.filter((q) => q.table === "trip_participants");
    expect(people.filters).toContainEqual(["in", "id", ["p-guest", "p-account"]]);
  });
});
