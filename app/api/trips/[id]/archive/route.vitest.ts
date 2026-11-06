// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * A trip's owner archives or restores it, and only its owner: a collaborator or a
 * stranger gets the same answer as for a trip that doesn't exist. Archiving hides a
 * trip and gives no usage back. The real route and auth helpers run over a faked client.
 */

const OWNER = { id: "owner-1", email: "owner@mail.example.com" };
const STRANGER = { id: "person-1", email: "person@mail.example.com" };
const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };
const REFUSED = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };

const s = vi.hoisted(() => ({
  signedIn: null as { id: string; email: string } | null,
  trip: {} as Record<string, unknown>,
  tripRead: null as { data: unknown; error: unknown } | null,
  updateError: null as unknown,
}));

/** A trip is found only under its id and its owner's id, the filters the route has to send. */
const db = fakeSupabase((q: FakeQuery) => {
  if (q.op === "update") return { data: null, error: s.updateError };
  if (s.tripRead) return s.tripRead;
  return eqOf(q, "id") === s.trip.id && eqOf(q, "user_id") === s.trip.user_id ? { data: s.trip, error: null } : NO_ROW;
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...db.client, auth: { getUser: async () => ({ data: { user: s.signedIn }, error: null }) } }),
}));

const { DELETE, POST } = await import("./route");

const TRIP_ID = "trip-1";
const call = (handler: typeof POST, id = TRIP_ID) =>
  handler(new NextRequest(`https://monkeytravel.app/api/trips/${id}/archive`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
const archive = (id?: string) => call(POST, id);
const restore = (id?: string) => call(DELETE, id);
const updates = () => db.log.filter((q) => q.op === "update");
const writes = () => db.log.filter((q) => q.op !== "select");

beforeEach(() => {
  s.signedIn = OWNER;
  s.trip = { id: TRIP_ID, user_id: OWNER.id, is_archived: false };
  s.tripRead = null;
  s.updateError = null;
  db.log.length = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("who may archive or restore", () => {
  it("refuses someone signed out, reading no trip", async () => {
    s.signedIn = null;
    expect((await archive()).status).toBe(401);
    expect((await restore()).status).toBe(401);
    expect(db.log).toEqual([]);
  });

  it("answers 404 to anyone but the owner, as for a trip that doesn't exist, changing nothing", async () => {
    s.signedIn = STRANGER;
    expect((await archive()).status).toBe(404);
    s.trip.is_archived = true;
    expect((await restore()).status).toBe(404);
    expect(writes()).toEqual([]);
  });

  it("answers 404 to an id that isn't a trip's, changing nothing", async () => {
    s.tripRead = { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } };
    expect((await archive("not-a-uuid")).status).toBe(404);
    expect((await restore("not-a-uuid")).status).toBe(404);
    expect(writes()).toEqual([]);
  });

  it("answers 500, not 404, when the trip read is refused, changing nothing", async () => {
    s.tripRead = REFUSED;
    expect((await archive()).status).toBe(500);
    expect((await restore()).status).toBe(500);
    expect(writes()).toEqual([]);
  });
});

describe("archiving", () => {
  it("marks only that trip archived, with the time, and writes nothing else", async () => {
    const res = await archive();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Trip archived successfully" });
    expect(writes()).toHaveLength(1);
    expect(updates()[0]).toMatchObject({
      table: "trips",
      value: { is_archived: true, archived_at: expect.any(String), updated_at: expect.any(String) },
    });
    expect(updates()[0].filters).toEqual([["eq", "id", TRIP_ID]]);
  });

  it("refuses a trip that's already archived, changing nothing", async () => {
    s.trip.is_archived = true;
    const res = await archive();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Trip is already archived");
    expect(writes()).toEqual([]);
  });

  it("answers 500 with no success when the update fails", async () => {
    s.updateError = { message: "write failed" };
    const res = await archive();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to archive trip" });
  });
});

describe("restoring", () => {
  beforeEach(() => {
    s.trip.is_archived = true;
  });

  it("clears the archive mark and its time on only that trip, and writes nothing else", async () => {
    const res = await restore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Trip restored successfully" });
    expect(writes()).toHaveLength(1);
    expect(updates()[0]).toMatchObject({
      table: "trips",
      value: { is_archived: false, archived_at: null, updated_at: expect.any(String) },
    });
    expect(updates()[0].filters).toEqual([["eq", "id", TRIP_ID]]);
  });

  it("refuses a trip that isn't archived, changing nothing", async () => {
    s.trip.is_archived = false;
    const res = await restore();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Trip is not archived");
    expect(writes()).toEqual([]);
  });

  it("answers 500 with no success when the update fails", async () => {
    s.updateError = { message: "write failed" };
    const res = await restore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to unarchive trip" });
  });
});
