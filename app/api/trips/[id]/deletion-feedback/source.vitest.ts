/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A deletion reason says where the trip was deleted: My Trips' card or the
 * planner's Start over. Anything else is kept as unknown, and the reason
 * itself is still checked.
 */

const inserted: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: "user-1" },
    supabase: {
      from: () => ({
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: null };
        },
      }),
    },
    errorResponse: null,
  }),
}));

const { POST } = await import("./route");
const post = (body: unknown) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/trips/trip-1/deletion-feedback", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: "trip-1" }) }
  );

beforeEach(() => {
  inserted.length = 0;
});

describe("source", () => {
  it("keeps where the trip was deleted", async () => {
    for (const source of ["my_trips", "start_over"]) {
      inserted.length = 0;
      expect((await post({ reason: "wrong_dates", source })).status).toBe(200);
      expect(inserted[0]).toMatchObject({ trip_id: "trip-1", reason: "wrong_dates", source });
    }
  });

  it("keeps anything else as unknown", async () => {
    await post({ reason: "other", source: "somewhere" });
    expect(inserted[0]).toMatchObject({ reason: "other", source: null });
    inserted.length = 0;
    await post({ reason: "other" });
    expect(inserted[0]).toMatchObject({ reason: "other", source: null });
  });

  it("still turns down a reason it doesn't know", async () => {
    expect((await post({ reason: "bored", source: "my_trips" })).status).toBe(400);
    expect(inserted).toEqual([]);
  });
});
