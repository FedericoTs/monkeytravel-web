// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Removing or demoting a member switches off the trip's open invite links.
 *
 * Open links take 20 people and last ~10 years (so a group chat can share
 * one). Accepting checks only uses left, active and expiry, so without this a
 * member the owner removed walks back in through the same link, and a demoted
 * editor can leave and rejoin as an editor. Leaving on your own, or a
 * promotion, leaves the group's links alone.
 */

const TRIP = "trip-1";
const OWNER = "owner-1";

let caller: string;
let roles: Record<string, string>;
const inviteUpdates: Array<{ values: Record<string, unknown>; filters: Array<[string, string, unknown]> }> = [];

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "trips") {
        const q = { select: () => q, eq: () => q, single: async () => ({ data: { id: TRIP, user_id: OWNER }, error: null }) };
        return q;
      }
      if (table === "trip_invites") {
        const rec = { values: {} as Record<string, unknown>, filters: [] as Array<[string, string, unknown]> };
        const q = {
          update: (values: Record<string, unknown>) => {
            rec.values = values;
            inviteUpdates.push(rec);
            return q;
          },
          eq: (c: string, v: unknown) => {
            rec.filters.push(["eq", c, v]);
            return q;
          },
          is: (c: string, v: unknown) => {
            rec.filters.push(["is", c, v]);
            return q;
          },
          select: async () => ({ data: [{ id: "inv-1" }, { id: "inv-2" }], error: null }),
        };
        return q;
      }
      // trip_collaborators
      const filters: Record<string, unknown> = {};
      let op: "read" | "update" | "delete" = "read";
      let newRole: string | null = null;
      const q = {
        select: () => q,
        update: (v: { role: string }) => {
          op = "update";
          newRole = v.role;
          return q;
        },
        delete: () => {
          op = "delete";
          return q;
        },
        eq: (c: string, v: unknown) => {
          filters[c] = v;
          return q;
        },
        single: async () => {
          const uid = String(filters.user_id);
          if (op === "update") {
            if (!(uid in roles)) return { data: null, error: null };
            roles[uid] = newRole!;
            return { data: { user_id: uid, role: newRole }, error: null };
          }
          return { data: roles[uid] ? { role: roles[uid] } : null, error: null };
        },
        maybeSingle: async () => ({ data: roles[String(filters.user_id)] ? { role: roles[String(filters.user_id)] } : null, error: null }),
        then: (resolve: (v: unknown) => void) => {
          if (op === "delete") delete roles[String(filters.user_id)];
          resolve({ error: null });
        },
      };
      return q;
    },
  };
}

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: caller }, supabase: fakeSupabase(), errorResponse: null }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@Example.com` } }, error: null }) } },
  }),
}));

const ctx = (userId: string) => ({ params: Promise.resolve({ id: TRIP, userId }) });
async function remove(userId: string) {
  const { DELETE } = await import("./route");
  const res = await DELETE(new NextRequest(`http://localhost/api/trips/${TRIP}/collaborators/${userId}`, { method: "DELETE" }), ctx(userId));
  return { status: res.status, json: await res.json() };
}
async function changeRole(userId: string, role: string) {
  const { PATCH } = await import("./route");
  const res = await PATCH(
    new NextRequest(`http://localhost/api/trips/${TRIP}/collaborators/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    ctx(userId)
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  caller = OWNER;
  roles = { "mate-1": "editor", "voter-1": "voter" };
  inviteUpdates.length = 0;
});

describe("removing a member", () => {
  it("switches off the open links and any unused email invite to them", async () => {
    const { status, json } = await remove("mate-1");
    expect(status).toBe(200);
    expect(inviteUpdates).toHaveLength(2);
    expect(inviteUpdates[0]).toEqual({
      values: { is_active: false },
      filters: [["eq", "trip_id", TRIP], ["eq", "is_active", true], ["is", "recipient_email", null]],
    });
    expect(inviteUpdates[1].filters).toContainEqual(["eq", "recipient_email", "mate-1@example.com"]);
    expect(json.invitesReset).toBe(4);
  });

  it("leaving on your own leaves the group's links alone", async () => {
    caller = "voter-1";
    const { status, json } = await remove("voter-1");
    expect(status).toBe(200);
    expect(inviteUpdates).toHaveLength(0);
    expect(json.invitesReset).toBe(0);
  });
});

describe("changing a role", () => {
  it("a demotion switches off the open links", async () => {
    const { status, json } = await changeRole("mate-1", "voter");
    expect(status).toBe(200);
    expect(inviteUpdates).toHaveLength(1);
    expect(inviteUpdates[0].filters).toContainEqual(["is", "recipient_email", null]);
    expect(json.invitesReset).toBe(2);
  });

  it("a promotion does not", async () => {
    const { status, json } = await changeRole("voter-1", "editor");
    expect(status).toBe(200);
    expect(inviteUpdates).toHaveLength(0);
    expect(json.invitesReset).toBe(0);
  });
});
