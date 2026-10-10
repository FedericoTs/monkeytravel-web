/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import type { ParticipantSource } from "@/lib/participants/shared";
import { expenseCohort, sharesExpenses, tripRoster, type RosterPerson } from "./roster";

/**
 * One list of the people in a trip, one entry each: the owner, the
 * collaborators and everyone going. A new expense is split across the owner,
 * editors, voters and anyone going through the share link, plus the payer,
 * once. Saying "I'm going" on the public trip page alone doesn't count.
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

  it("returns nobody rather than part of the group when a list can't be read", async () => {
    const { admin } = world([{ user_id: "mate-1", role: "editor" }], [], "trip_participants");
    const { roster, error } = await tripRoster(admin, TRIP);
    expect(roster).toEqual([]);
    expect(error).toBeTruthy();
  });
});

describe("who shares an expense", () => {
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
    expect(sharesExpenses(person("owner", false))).toBe(true);
    expect(sharesExpenses(person("editor", false))).toBe(true);
    expect(sharesExpenses(person("voter", false))).toBe(true);
    expect(sharesExpenses(person(null, true))).toBe(true);
    expect(sharesExpenses(person("viewer", false))).toBe(false);
    expect(sharesExpenses(person("viewer", true))).toBe(true);
  });

  it("leaves out someone who said they're going only on the public page, unless their role puts them in", () => {
    expect(sharesExpenses(person(null, true, "public"))).toBe(false);
    expect(sharesExpenses(person("viewer", true, "public"))).toBe(false);
    expect(sharesExpenses(person(null, true, "crew_ask"))).toBe(true);
    expect(sharesExpenses(person("owner", true, "public"))).toBe(true);
    expect(sharesExpenses(person("editor", true, "public"))).toBe(true);
    expect(sharesExpenses(person("voter", true, "public"))).toBe(true);
  });

  it("splits nothing with a stranger from the public page, unless they pay", async () => {
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
    expect(keys(expenseCohort(roster, { userId: "owner-1", cookieId: null, name: null }))).toEqual([
      "owner-1",
      "mate-1",
      "cookie:guest-cookie-1",
    ]);
    // Paying is still sharing in what they paid for, as for anyone outside the group.
    expect(keys(expenseCohort(roster, { userId: null, cookieId: "stranger-cookie", name: "Pat" }))).toEqual([
      "owner-1",
      "mate-1",
      "cookie:guest-cookie-1",
      "cookie:stranger-cookie",
    ]);
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
      expect(keys(expenseCohort(roster, null))).toEqual(["owner-1", "friend-1"]);
    }
  });

  it("adds the payer once", async () => {
    const { admin } = world(
      [
        { user_id: "mate-1", role: "editor" },
        { user_id: "viewer-1", role: "viewer" },
      ],
      [{ participant_cookie_id: "guest-cookie-1", user_id: null, display_name: "Bo" }],
    );
    const { roster } = await tripRoster(admin, TRIP);
    expect(keys(expenseCohort(roster, { userId: "mate-1", cookieId: null, name: null }))).toEqual(["owner-1", "mate-1", "cookie:guest-cookie-1"]);
    expect(keys(expenseCohort(roster, { userId: null, cookieId: "guest-cookie-1", name: "Bo" }))).toEqual([
      "owner-1",
      "mate-1",
      "cookie:guest-cookie-1",
    ]);
    // A viewer who pays shares in what they paid for.
    expect(keys(expenseCohort(roster, { userId: "viewer-1", cookieId: null, name: null }))).toEqual([
      "owner-1",
      "mate-1",
      "cookie:guest-cookie-1",
      "viewer-1",
    ]);
    // So does someone not on the trip's lists at all.
    expect(keys(expenseCohort(roster, { userId: null, cookieId: "new-guest-1", name: null })).at(-1)).toBe("cookie:new-guest-1");
  });
});
