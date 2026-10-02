/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * The owner's "Who's going" is the group the expense split uses: the owner,
 * every collaborator and everyone who said they're going, once each. The
 * count is the people who share expenses; a viewer who hasn't said they're
 * going is listed but not counted.
 */

const TRIP_ID = "11111111-2222-4333-8444-555555555555";
let signedIn: { id: string } | null = { id: "owner-1" };
let failing: string | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    fakeSupabase((q) => {
      if (failing === q.table) return { data: null, error: { message: "boom" } };
      if (q.table === "trips") return { data: { id: TRIP_ID, user_id: "owner-1" }, error: null };
      if (q.table === "trip_collaborators") {
        return {
          data: [
            { user_id: "mate-1", role: "editor" },
            { user_id: "viewer-1", role: "viewer" },
            { user_id: "viewer-2", role: "viewer" },
          ],
          error: null,
        };
      }
      if (q.table === "trip_participants") {
        return {
          data: [
            { id: "row-m", participant_cookie_id: "mate-cookie", user_id: "mate-1", display_name: "Luca G", email: null, joined_at: "2026-10-01T10:00:00Z" },
            { id: "row-v2", participant_cookie_id: "vi-cookie", user_id: "viewer-2", display_name: "Vi", email: null, joined_at: "2026-10-01T11:00:00Z" },
            { id: "row-g", participant_cookie_id: "guest-cookie", user_id: null, display_name: "Bo", email: "bo@example.com", joined_at: "2026-10-01T12:00:00Z" },
          ],
          error: null,
        };
      }
      if (q.table === "public_profiles") {
        return {
          data: [
            { id: "owner-1", display_name: "Olive" },
            { id: "mate-1", display_name: "Luca" },
            { id: "viewer-1", display_name: "viewer@example.com" },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    }).client,
}));

const { GET } = await import("./route");
const call = () => GET(new NextRequest(`http://localhost/api/trips/${TRIP_ID}/participants`), { params: Promise.resolve({ id: TRIP_ID }) });

beforeEach(() => {
  signedIn = { id: "owner-1" };
  failing = null;
});

describe("GET /api/trips/[id]/participants", () => {
  it("lists the whole group once each and counts who shares expenses", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(4);
    expect(body.participants).toEqual([
      { id: "owner-1", display_name: "Olive", role: "owner", going: false, in_split: true, has_account: true, has_email: false, joined_at: null, participant_id: null },
      { id: "row-m", display_name: "Luca", role: "editor", going: true, in_split: true, has_account: true, has_email: false, joined_at: "2026-10-01T10:00:00Z", participant_id: "row-m" },
      // An email-like profile name is never shown.
      { id: "viewer-1", display_name: null, role: "viewer", going: false, in_split: false, has_account: true, has_email: false, joined_at: null, participant_id: null },
      { id: "row-v2", display_name: "Vi", role: "viewer", going: true, in_split: true, has_account: true, has_email: false, joined_at: "2026-10-01T11:00:00Z", participant_id: "row-v2" },
      { id: "row-g", display_name: "Bo", role: null, going: true, in_split: true, has_account: false, has_email: true, joined_at: "2026-10-01T12:00:00Z", participant_id: "row-g" },
    ]);
  });

  it("is the owner's only", async () => {
    signedIn = { id: "mate-1" };
    expect((await call()).status).toBe(404);
  });

  it("fails rather than show part of the group", async () => {
    failing = "trip_collaborators";
    expect((await call()).status).toBe(500);
  });
});
