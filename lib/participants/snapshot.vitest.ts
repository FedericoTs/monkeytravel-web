/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase } from "@/tests/fake-supabase";
import { participantsSnapshot } from "./snapshot";

/**
 * "You're going" follows the person: signed in, their account's row on any
 * browser, or this browser's guest row until it is linked; signed out, this
 * browser's row. A row from the public trip page isn't "going" here until
 * they join through the share link.
 */

const rows = [
  { id: "p-account", participant_cookie_id: "laptop-cookie", user_id: "user-1", display_name: "Ana", email: null, joined_at: "2026-10-01T10:00:00Z", source: "shared" },
  { id: "p-guest", participant_cookie_id: "phone-cookie", user_id: null, display_name: "Bo", email: null, joined_at: "2026-10-01T11:00:00Z", source: "crew_ask" },
  { id: "p-other", participant_cookie_id: "shared-cookie", user_id: "user-2", display_name: "Cy", email: "cy@example.com", joined_at: "2026-10-01T12:00:00Z", source: "shared" },
  { id: "p-public", participant_cookie_id: "public-cookie", user_id: null, display_name: "Pat", email: null, joined_at: "2026-10-01T13:00:00Z", source: "public" },
  { id: "p-public-account", participant_cookie_id: "public-laptop", user_id: "user-4", display_name: "Dee", email: "dee@example.com", joined_at: "2026-10-01T14:00:00Z", source: "public" },
];
const admin = fakeSupabase(() => ({ data: rows, error: null })).client as unknown as SupabaseClient;
const me = async (cookie: string | undefined, userId: string | null) => (await participantsSnapshot(admin, "trip-1", cookie, userId)).me;

describe("participantsSnapshot", () => {
  it("finds a signed-in person's row by their account, on any browser", async () => {
    expect(await me("phone-cookie", "user-1")).toMatchObject({ joined: true, display_name: "Ana" });
  });

  it("uses this browser's guest row until it is linked", async () => {
    expect(await me("phone-cookie", "user-3")).toMatchObject({ joined: true, display_name: "Bo" });
  });

  it("never gives a signed-in person another account's row", async () => {
    expect(await me("shared-cookie", "user-3")).toMatchObject({ joined: false });
  });

  it("finds a signed-out visitor by this browser", async () => {
    expect(await me("shared-cookie", null)).toMatchObject({ joined: true, display_name: "Cy", has_email: true });
    expect(await me(undefined, null)).toMatchObject({ joined: false });
  });

  it("isn't going here for someone whose row came from the public page, but keeps what they gave", async () => {
    expect(await me("public-cookie", null)).toEqual({ joined: false, display_name: "Pat", has_email: false });
    expect(await me("another-browser", "user-4")).toEqual({ joined: false, display_name: "Dee", has_email: true });
    // Rows from the share link, the group ask included, are going.
    expect(await me("laptop-cookie", null)).toMatchObject({ joined: true, display_name: "Ana" });
    expect(await me("phone-cookie", null)).toMatchObject({ joined: true, display_name: "Bo" });
  });
});
