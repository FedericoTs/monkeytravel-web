// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Accepting an emailed invite is for its recipient only.
 *
 * accept_trip_invite does not compare addresses, so the route checks the
 * signed-in email against the invite's recipient_email first. A preview read
 * the database refused must stop the accept: read as "no invite", it would
 * skip the check and let anyone holding the token in. A join is counted in
 * PostHog under trip_id, the key every other trip event uses.
 */

const TOKEN = "invite-token-1";
let preview: { data: unknown; error: { message: string } | null };
const accept = vi.fn(async () => ({ data: { is_owner: true, trip_id: "trip-1" }, error: null }));
// The trip's title and the new member's row, read after a join.
const row = { select: () => row, eq: () => row, single: async () => ({ data: null, error: null }) };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => (name === "get_invite_by_token" ? preview : accept()),
    from: () => row,
  }),
}));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: "user-1", email: "Invitee@Example.com" }, errorResponse: null }),
}));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/bananas", () => ({
  addCollaborationBananas: vi.fn(),
  checkAndUnlockTier: vi.fn(),
  getUserReferralTier: vi.fn(),
}));

import { captureServerEvent } from "@/lib/posthog/server";

/** What accept_trip_invite answers when the invite adds a new member. */
const JOINED = {
  ok: true,
  trip_id: "trip-1",
  role: "editor",
  already_member: false,
  is_owner: false,
  collaborator_id: "member-row-1",
  invite_id: "invite-1",
  created_by: null,
  is_referral_eligible: null,
};

async function acceptInvite() {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest(`http://localhost/api/invites/${TOKEN}`, { method: "POST" }),
    { params: Promise.resolve({ token: TOKEN }) }
  );
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  accept.mockClear();
  vi.mocked(captureServerEvent).mockClear();
  preview = { data: [{ recipient_email: "invitee@example.com" }], error: null };
});

describe("accepting an emailed invite", () => {
  it("lets the recipient in", async () => {
    const { status } = await acceptInvite();
    expect(status).toBe(200);
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it("refuses anyone else", async () => {
    preview = { data: [{ recipient_email: "someone.else@example.com" }], error: null };
    const { status, json } = await acceptInvite();
    expect(status).toBe(403);
    expect(json.code).toBe("RECIPIENT_MISMATCH");
    expect(accept).not.toHaveBeenCalled();
  });

  it("accepts nothing when the invite can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    preview = { data: null, error: { message: "canceling statement due to statement timeout" } };
    const { status } = await acceptInvite();
    expect(status).toBe(500);
    expect(accept).not.toHaveBeenCalled();
  });

  it("counts a new member in PostHog under the trip's id", async () => {
    accept.mockResolvedValueOnce({ data: JOINED, error: null });
    const { status } = await acceptInvite();
    expect(status).toBe(200);
    expect(captureServerEvent).toHaveBeenCalledExactlyOnceWith("user-1", "invite_accepted", {
      trip_id: "trip-1",
      role: "editor",
      inviteId: "invite-1",
    });
  });
});
