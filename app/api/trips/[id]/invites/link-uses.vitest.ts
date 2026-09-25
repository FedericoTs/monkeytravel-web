// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * How many people one invite link lets in.
 *
 * An open link goes to a group chat. Until 2026-09-25 it defaulted to one use
 * and the share modal never sends another value, so the first friend to tap
 * it joined and everyone after hit "Invite Already Used". Open links now take
 * a group; an email invite names one person and stays single-use.
 */

const TRIP = "trip-1";
const inserted: Array<Record<string, unknown>> = [];

function fakeSupabase() {
  return {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        const q = { select: () => q, single: async () => ({ data: { id: "inv-1", ...row }, error: null }) };
        return q;
      },
    }),
  };
}

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: "owner-1", email: "owner@test.local", user_metadata: {} },
    supabase: fakeSupabase(),
    errorResponse: null,
  }),
  verifyTripAccess: async () => ({
    trip: { id: TRIP, user_id: "owner-1", title: "Lisbon Trip", trip_meta: {} },
    errorResponse: null,
  }),
}));
vi.mock("@/lib/email/send", () => ({ dispatchEmail: async () => ({ outcome: "sent" }) }));

async function createInvite(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest(`http://localhost/api/trips/${TRIP}/invites`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: TRIP }) }
  );
  return res.status;
}

beforeEach(() => {
  inserted.length = 0;
});

describe("invite link uses", () => {
  it("a link from the share modal (role only) lets a whole group in", async () => {
    expect(await createInvite({ role: "editor" })).toBe(200);
    expect(inserted[0]).toMatchObject({ role: "editor", max_uses: 20, use_count: 0, recipient_email: null });
  });

  it("an explicit limit is kept", async () => {
    expect(await createInvite({ role: "voter", maxUses: 5 })).toBe(200);
    expect(inserted[0]).toMatchObject({ max_uses: 5 });
  });

  it("an email invite is for one person: single-use", async () => {
    expect(await createInvite({ role: "editor", recipientEmail: "friend@test.local" })).toBe(200);
    expect(inserted[0]).toMatchObject({ max_uses: 1, recipient_email: "friend@test.local" });
  });

  it("rejects limits outside 1-100", async () => {
    expect(await createInvite({ role: "voter", maxUses: 0 })).toBe(400);
    expect(await createInvite({ role: "voter", maxUses: 101 })).toBe(400);
    expect(await createInvite({ role: "voter", maxUses: 2.5 })).toBe(400);
    expect(inserted).toHaveLength(0);
  });
});
