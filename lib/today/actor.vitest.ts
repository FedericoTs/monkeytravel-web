/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eqOf, fakeSupabase } from "@/tests/fake-supabase";
import { isTodayActor, resolveTodayPerson, storedCookie } from "./actor";

/**
 * On a live trip's Today, a signed-in person acts as their account on every
 * device and a guest as their browser. Members are named by their profile,
 * anyone else by the name they gave when they tapped "I'm going".
 */

const TRIP = { id: "trip-1", user_id: "owner-1" };

function world(opts: {
  collaborators?: string[];
  profiles?: Record<string, string>;
  participants?: Array<{ user_id?: string; cookie?: string; name: string }>;
}) {
  return fakeSupabase((q) => {
    if (q.table === "trip_collaborators") {
      const id = eqOf(q, "user_id");
      return { data: opts.collaborators?.includes(id as string) ? { user_id: id } : null, error: null };
    }
    if (q.table === "users") return { data: { display_name: opts.profiles?.[eqOf(q, "id") as string] ?? null }, error: null };
    if (q.table === "trip_participants") {
      const byUser = eqOf(q, "user_id");
      const byCookie = eqOf(q, "participant_cookie_id");
      const row = opts.participants?.find((p) => (byUser && p.user_id === byUser) || (byCookie && p.cookie === byCookie));
      return { data: row ? { display_name: row.name } : null, error: null };
    }
    return { data: null, error: null };
  }).client as unknown as SupabaseClient;
}

describe("resolveTodayPerson", () => {
  it("names the owner by their profile", async () => {
    const person = await resolveTodayPerson(world({ profiles: { "owner-1": "Marta" } }), TRIP, { id: "owner-1" }, "browser-cookie-1");
    expect(person).toEqual({ userId: "owner-1", cookieId: "browser-cookie-1", isOwner: true, isMember: true, name: "Marta" });
  });

  it("names a collaborator by their profile, never by an email", async () => {
    const named = await resolveTodayPerson(world({ collaborators: ["mate-1"], profiles: { "mate-1": "Luca" } }), TRIP, { id: "mate-1" }, null);
    expect(named).toMatchObject({ isOwner: false, isMember: true, name: "Luca" });
    const email = await resolveTodayPerson(
      world({ collaborators: ["mate-1"], profiles: { "mate-1": "mate@example.com" } }),
      TRIP,
      { id: "mate-1", email: "mate@example.com" },
      null,
    );
    expect(email.name).toBeNull();
  });

  it("names anyone else signed in by the name they gave when they joined", async () => {
    const person = await resolveTodayPerson(world({ participants: [{ user_id: "user-9", name: "Ana" }] }), TRIP, { id: "user-9" }, "browser-cookie-9");
    expect(person).toMatchObject({ userId: "user-9", isMember: false, name: "Ana" });
  });

  it("names a guest by the name they gave on this browser", async () => {
    const person = await resolveTodayPerson(world({ participants: [{ cookie: "guest-cookie-1", name: "Bo" }] }), TRIP, null, "guest-cookie-1");
    expect(person).toEqual({ userId: null, cookieId: "guest-cookie-1", isOwner: false, isMember: false, name: "Bo" });
  });
});

describe("isTodayActor", () => {
  const me = { userId: "mate-1", cookieId: "second-browser-1" };

  it("matches my account on any browser", () => {
    expect(isTodayActor(me, { userId: "mate-1", cookieId: null })).toBe(true);
    expect(isTodayActor(me, { userId: "mate-1", cookieId: "first-browser-1" })).toBe(true);
  });

  it("matches what was written on this browser before signing in", () => {
    expect(isTodayActor(me, { userId: null, cookieId: "second-browser-1" })).toBe(true);
  });

  it("never matches someone else, or two unknowns", () => {
    expect(isTodayActor(me, { userId: "other-1", cookieId: "other-browser" })).toBe(false);
    expect(isTodayActor({ userId: null, cookieId: null }, { userId: null, cookieId: null })).toBe(false);
  });
});

describe("storedCookie", () => {
  it("stores no cookie for a signed-in person, so the account identifies them everywhere", () => {
    expect(storedCookie({ userId: "mate-1", cookieId: "browser-cookie-1" })).toBeNull();
    expect(storedCookie({ userId: null, cookieId: "guest-cookie-1" })).toBe("guest-cookie-1");
  });
});
