// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * Who may read a trip, and what a failed read says. "Not found" is a read
 * that found nothing (or an id that isn't a UUID); any other database error
 * is a failed read, a 500, never passed off as a missing trip or a stranger.
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.spyOn(console, "error").mockImplementation(() => {});

const { verifyTripAccess, verifyTripOwnership } = await import("./auth");

const TRIP = { id: "trip-1", user_id: "owner-1" };
const NO_ROW = { code: "PGRST116", message: "no rows" };
const BAD_ID = { code: "22P02", message: "invalid input syntax for type uuid" };
const BROKEN = { code: "42703", message: "column trips.destination does not exist" };

type Read = { data: unknown; error: unknown };
const db = (trip: Read, collaborator: Read = { data: null, error: NO_ROW }) =>
  fakeSupabase((q) => (q.table === "trips" ? trip : collaborator)).client as never;

describe("verifyTripAccess", () => {
  const cases: Array<[string, Read, Read | undefined, string, number | null, string | null]> = [
    ["the owner", { data: TRIP, error: null }, undefined, "owner-1", null, null],
    ["an editor", { data: TRIP, error: null }, { data: { role: "editor" }, error: null }, "mate-1", null, "editor"],
    ["someone who isn't a member", { data: TRIP, error: null }, undefined, "stranger", 403, null],
    ["a trip that isn't there", { data: null, error: NO_ROW }, undefined, "owner-1", 404, null],
    ["an id that isn't a UUID", { data: null, error: BAD_ID }, undefined, "owner-1", 404, null],
    ["a failed trip read", { data: null, error: BROKEN }, undefined, "owner-1", 500, null],
    ["a failed member read", { data: TRIP, error: null }, { data: null, error: BROKEN }, "mate-1", 500, null],
  ];
  for (const [who, trip, collaborator, userId, status, role] of cases) {
    it(`answers ${who}`, async () => {
      const out = await verifyTripAccess(db(trip, collaborator), "trip-1", userId);
      expect(out.errorResponse?.status ?? null).toBe(status);
      expect(out.collaboratorRole).toBe(role);
    });
  }

  it("refuses a member whose role the route doesn't allow", async () => {
    const out = await verifyTripAccess(db({ data: TRIP, error: null }, { data: { role: "viewer" }, error: null }), "trip-1", "mate-1", "id, user_id", ["editor"]);
    expect(out.errorResponse?.status).toBe(403);
  });
});

describe("verifyTripOwnership", () => {
  it("answers the owner", async () => {
    expect((await verifyTripOwnership(db({ data: TRIP, error: null }), "trip-1", "owner-1")).errorResponse).toBeNull();
  });

  it("is a 404 when the owner's trip isn't there, or the id isn't a UUID", async () => {
    for (const error of [NO_ROW, BAD_ID]) {
      expect((await verifyTripOwnership(db({ data: null, error }), "trip-1", "owner-1")).errorResponse?.status).toBe(404);
    }
  });

  it("is a 500 when the read fails", async () => {
    expect((await verifyTripOwnership(db({ data: null, error: BROKEN }), "trip-1", "owner-1")).errorResponse?.status).toBe(500);
  });
});
