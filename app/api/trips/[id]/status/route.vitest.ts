// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The trip's owner confirms, cancels or restores it. A change that isn't one of
 * those is refused, and the answer says it changed only when the write landed.
 */

let stored: string;
let writeError: unknown;
let log: FakeQuery[];
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  getAuthenticatedUser: async () => {
    const db = fakeSupabase((q) =>
      q.op === "update" ? { data: null, error: writeError } : { data: { id: "trip-1", user_id: "owner-1", status: stored }, error: null }
    );
    log = db.log;
    return { user: { id: "owner-1" }, errorResponse: null, supabase: db.client };
  },
}));
vi.spyOn(console, "error").mockImplementation(() => {});

const { PATCH } = await import("./route");
const change = async (body: unknown) => {
  const res = await PATCH(
    new NextRequest("http://localhost/api/trips/trip-1/status", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "trip-1" }) } as never
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const writes = () => log.filter((q) => q.op === "update");

beforeEach(() => {
  stored = "planning";
  writeError = null;
});

describe("PATCH trip status", () => {
  it.each([
    ["planning", "confirmed"],
    ["planning", "cancelled"],
    ["confirmed", "cancelled"],
    ["cancelled", "planning"],
  ])("moves a trip from %s to %s", async (from, to) => {
    stored = from;
    const { status, json } = await change({ status: to });
    expect(status).toBe(200);
    expect(json).toMatchObject({ success: true, previousStatus: from, newStatus: to });
    expect(writes()[0].value).toMatchObject({ status: to });
    expect(writes()[0].filters).toContainEqual(["eq", "id", "trip-1"]);
  });

  it("refuses a change the trip can't make, and writes nothing", async () => {
    stored = "cancelled";
    expect((await change({ status: "confirmed" })).status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it("refuses a missing or unknown status", async () => {
    expect((await change({})).status).toBe(400);
    expect((await change({ status: "paused" })).status).toBe(400);
  });

  it("says so when the write fails", async () => {
    writeError = { message: "boom" };
    expect((await change({ status: "confirmed" })).status).toBe(500);
  });
});
