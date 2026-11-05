// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Deleting a trip goes through soft_delete_trip(), which checks ownership itself.
 * Anything but a real deletion answers the same, so a double tap stays harmless and
 * a stranger learns nothing, and only a real one drops the trip's cached card.
 */

const s = vi.hoisted(() => ({
  signedIn: true,
  answer: { data: true as unknown, error: null as unknown },
  asked: [] as unknown[],
  purged: [] as string[],
  later: [] as Array<() => unknown>,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => s.later.push(task),
}));
vi.mock("@/lib/seo/trip-card-cache", () => ({ purgeTripCard: async (id: string) => void s.purged.push(id) }));
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  getAuthenticatedUser: async () =>
    s.signedIn
      ? {
          user: { id: "owner-1" },
          errorResponse: null,
          supabase: {
            rpc: async (name: string, args: unknown) => {
              s.asked.push([name, args]);
              return s.answer;
            },
          },
        }
      : { user: null, errorResponse: Response.json({ error: "Sign in" }, { status: 401 }), supabase: null },
}));

const { DELETE } = await import("./route");

const remove = async () => {
  const res = await DELETE(new NextRequest("https://monkeytravel.app/api/trips/trip-1", { method: "DELETE" }), {
    params: Promise.resolve({ id: "trip-1" }),
  } as never);
  for (const task of s.later.splice(0)) await task();
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  s.signedIn = true;
  s.answer = { data: true, error: null };
  s.asked.length = 0;
  s.purged.length = 0;
  s.later.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleting a trip", () => {
  it("asks the database, and drops the trip's card", async () => {
    expect(await remove()).toMatchObject({ status: 200, body: { success: true, deleted: true } });
    expect(s.asked).toEqual([["soft_delete_trip", { p_trip_id: "trip-1" }]]);
    expect(s.purged).toEqual(["trip-1"]);
  });

  it("answers the same when nothing was deleted, and leaves the card", async () => {
    s.answer = { data: false, error: null };
    expect(await remove()).toMatchObject({ status: 200, body: { success: true, deleted: false } });
    expect(s.purged).toEqual([]);
  });

  it("says so when the database refuses, and leaves the card", async () => {
    s.answer = { data: null, error: { message: "refused" } };
    expect((await remove()).status).toBe(500);
    expect(s.purged).toEqual([]);
  });

  it("needs someone signed in", async () => {
    s.signedIn = false;
    expect((await remove()).status).toBe(401);
    expect(s.asked).toEqual([]);
  });
});
