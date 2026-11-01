// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * Reading a trip's status moves it on when its dates say so (a trip that has
 * ended is completed). The answer says it moved only when the write landed.
 */

let writeError: unknown;
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  getAuthenticatedUser: async () => ({
    user: { id: "owner-1" },
    errorResponse: null,
    supabase: fakeSupabase((q) =>
      q.op === "update"
        ? { data: null, error: writeError }
        : { data: { id: "trip-1", status: "planning", start_date: "2020-01-01", end_date: "2020-01-03", is_archived: false }, error: null }
    ).client,
  }),
}));
vi.spyOn(console, "error").mockImplementation(() => {});

const { GET } = await import("./route");
const read = async () => {
  const res = await GET(new NextRequest("http://localhost/api/trips/trip-1/status"), { params: Promise.resolve({ id: "trip-1" }) } as never);
  return (await res.json()) as { status: string; previousStatus: string | null; wasAutoUpdated: boolean };
};

beforeEach(() => {
  writeError = null;
});

describe("GET trip status", () => {
  it("completes a trip that has ended", async () => {
    expect(await read()).toMatchObject({ status: "completed", previousStatus: "planning", wasAutoUpdated: true });
  });

  it("keeps the stored status when the write fails", async () => {
    writeError = { message: "boom" };
    expect(await read()).toMatchObject({ status: "planning", previousStatus: null, wasAutoUpdated: false });
  });
});
