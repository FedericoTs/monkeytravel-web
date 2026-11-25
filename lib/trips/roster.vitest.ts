/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import type { ParticipantSource } from "@/lib/participants/shared";
import { actorKey, inTheGroup, tripRoster, type RosterPerson } from "./roster";

/**
 * One list of the people in a trip, one entry each: the owner, the
 * collaborators and everyone going. The group is the owner, editors, voters
 * and anyone going through the share link. Saying "I'm going" on the public
 * trip page alone doesn't count.
 */

const TRIP = { id: "trip-1", user_id: "owner-1" };

function world(collaborators: Array<{ user_id: string; role: string }>, participants: Array<Record<string, unknown>>, failing?: string) {
  const fake = fakeSupabase((q) => {
    if (failing === q.table) return { data: null, error: { message: "boom" } };
    if (q.table === "trip_collaborators") return { data: collaborators, error: null };
    if (q.table === "trip_participants") return { data: participants, error: null };
    return { data: null, error: null };
  });
  return { admin: fake.client as unknown as SupabaseClient, log: fake.log };
}

const keys = (people: Array<Pick<RosterPerson, "userId" | "cookieId">>) => people.map((p) => p.userId ?? `cookie:${p.cookieId}`);

describe("tripRoster", () => {
  it("lists the owner, then collaborators, then everyone going, once each", async () => {
    const { admin, log } = world(
      [
        { user_id: "mate-1", role: "editor" },
        { user_id: "viewer-1", role: "viewer" },
      ],
      [
        { id: "row-1", participant_cookie_id: "mate-cookie", user_id: "mate-1", display_name: "Luca", email: null, joined_at: "2026-10-01T10:00:00Z", source: "shared" },
        { id: "row-2", participant_cookie_id: "guest-cookie-1", user_id: null, display_name: "Bo", email: "bo@example.com", joined_at: "2026-10-01T11:00:00Z", source: "crew_ask" },
      ],
    );
    const { roster, error } = await tripRoster(admin, TRIP);
    expect(error).toBeNull();
    expect(roster).toEqual([
      { key: "u:owner-1", userId: "owner-1", cookieId: null, name: null, role: "owner", going: false, participant: null },
      {
        key: "u:mate-1",
        userId: "mate-1",
        cookieId: null,
        name: "Luca",
        role: "editor",
        going: true,
        participant: { id: "row-1", joinedAt: "2026-10-01T10:00:00Z", hasEmail: false, source: "shared" },
      },
      { key: "u:viewer-1", userId: "viewer-1", cookieId: null, name: null, role: "viewer", going: false, participant: null },
      {
        key: "c:guest-cookie-1",
        userId: null,
        cookieId: "guest-cookie-1",
        name: "Bo",
        role: null,
        going: true,
        participant: { id: "row-2", joinedAt: "2026-10-01T11:00:00Z", hasEmail: true, source: "crew_ask" },
      },
    ]);
    // Only people who haven't left count as going.
    const going = log.find((q: FakeQuery) => q.table === "trip_participants");
    expect(going?.filters).toContainEqual(["is", "left_at", null]);
  });

  it("carries the must-dos someone going added, when they were sent and when they were placed", async () => {
    const { admin, log } = world(
      [],
      [
        {
          id: "row-2",
          participant_cookie_id: "guest-cookie-1",
          user_id: null,
          display_name: "Bo",
          email: null,
          joined_at: "2026-10-01T11:00:00Z",
          source: "shared",
          picks: ["teamLab Planets", "Ichiran ramen"],
          picks_at: "2026-10-02T09:00:00Z",
          picks_placed_at: "2026-10-03T08:00:00Z",
        },
      ],
    );
    const { roster } = await tripRoster(admin, TRIP);
    expect(roster[1].participant).toEqual({
      id: "row-2",
      joinedAt: "2026-10-01T11:00:00Z",
      hasEmail: false,
      source: "shared",
      picks: ["teamLab Planets", "Ichiran ramen"],
      picksAt: "2026-10-02T09:00:00Z",
      picksPlacedAt: "2026-10-03T08:00:00Z",
    });
    const read = log.find((q: FakeQuery) => q.table === "trip_participants");
    expect(read?.columns).toContain("picks_placed_at");
  });

  it("returns nobody rather than part of the group when a list can't be read", async () => {
    const { admin } = world([{ user_id: "mate-1", role: "editor" }], [], "trip_participants");
    const { roster, error } = await tripRoster(admin, TRIP);
    expect(roster).toEqual([]);
    expect(error).toBeTruthy();
  });
});

describe("who counts in the group", () => {
  const person = (role: string | null, going: boolean, source: ParticipantSource = "shared"): RosterPerson => ({
    key: "u:x",
    userId: "x",
    cookieId: null,
    name: null,
    role,
    going,
    participant: going ? { id: "row-x", joinedAt: "2026-10-01T10:00:00Z", hasEmail: false, source } : null,
  });

  it("is the owner, editors, voters and anyone going, but not a viewer who isn't", () => {
    expect(inTheGroup(person("owner", false))).toBe(true);
    expect(inTheGroup(person("editor", false))).toBe(true);
    expect(inTheGroup(person("voter", false))).toBe(true);
    expect(inTheGroup(person(null, true))).toBe(true);
    expect(inTheGroup(person("viewer", false))).toBe(false);
    expect(inTheGroup(person("viewer", true))).toBe(true);
  });

  it("leaves out someone who said they're going only on the public page, unless their role puts them in", () => {
    expect(inTheGroup(person(null, true, "public"))).toBe(false);
    expect(inTheGroup(person("viewer", true, "public"))).toBe(false);
    expect(inTheGroup(person(null, true, "crew_ask"))).toBe(true);
    expect(inTheGroup(person("owner", true, "public"))).toBe(true);
    expect(inTheGroup(person("editor", true, "public"))).toBe(true);
    expect(inTheGroup(person("voter", true, "public"))).toBe(true);
  });

  it("keys a person by their account, else by their browser", () => {
    expect(actorKey("u1", "c1")).toBe("u:u1");
    expect(actorKey(null, "c1")).toBe("c:c1");
    expect(actorKey(null, null)).toBe("c:unknown");
  });

  it("leaves out a stranger from the public page", async () => {
    const { admin } = world(
      [
        { user_id: "mate-1", role: "editor" },
        { user_id: "viewer-1", role: "viewer" },
      ],
      [
        { id: "row-1", participant_cookie_id: "stranger-cookie", user_id: null, display_name: "Pat", source: "public" },
        { id: "row-2", participant_cookie_id: "mate-cookie", user_id: "mate-1", display_name: "Luca", source: "public" },
        { id: "row-3", participant_cookie_id: "viewer-cookie", user_id: "viewer-1", display_name: "Vi", source: "public" },
        { id: "row-4", participant_cookie_id: "guest-cookie-1", user_id: null, display_name: "Bo", source: "shared" },
      ],
    );
    const { roster } = await tripRoster(admin, TRIP);
    // The editor is in through their role; the viewer and the stranger only tapped on the public page.
    expect(keys(roster.filter(inTheGroup))).toEqual(["owner-1", "mate-1", "cookie:guest-cookie-1"]);
  });

  it("counts someone who also said they're going through the share link, whichever row came first", async () => {
    const stranger = { id: "row-0", participant_cookie_id: "stranger-cookie", user_id: null, display_name: "Pat", source: "public" };
    const fromPublic = { id: "row-1", participant_cookie_id: "cookie-a", user_id: "friend-1", display_name: "Ana", source: "public" };
    const fromLink = { id: "row-2", participant_cookie_id: "cookie-b", user_id: "friend-1", display_name: "Ana", source: "shared" };
    for (const rows of [
      [stranger, fromPublic, fromLink],
      [stranger, fromLink, fromPublic],
    ]) {
      const { roster } = await tripRoster(world([], rows).admin, TRIP);
      expect(keys(roster.filter(inTheGroup))).toEqual(["owner-1", "friend-1"]);
    }
  });
});
