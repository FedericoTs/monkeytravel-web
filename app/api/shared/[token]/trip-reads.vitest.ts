// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase } from "@/tests/fake-supabase";

/**
 * The share-link routes read their trip through readSharedTrip: a token no
 * live trip carries is a 404, and a read the database refused is a 500 - not
 * "Shared trip not found", which would make a working link look dead.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
let tripRead: { data: unknown; error: unknown };

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));
vi.mock("@/lib/participants/flag", () => ({ isLiveTripParticipantsEnabled: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  signedInUserId: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeSupabase((q) => (q.table === "trips" ? tripRead : { data: [], error: null })).client,
}));

const get = () => new NextRequest(`http://localhost/api/shared/${TOKEN}`);
const ctx = { params: Promise.resolve({ token: TOKEN }) };
const routes: Array<[string, () => Promise<Response>]> = [
  ["the expenses", async () => (await import("./expenses/route")).GET(get(), ctx)],
  ["the feed", async () => (await import("./feed/route")).GET(get(), ctx)],
  ["who's going", async () => (await import("./participants/route")).GET(get(), ctx)],
  ["Today's actions", async () => (await import("./today-actions/route")).GET(get(), ctx)],
  ["the votes", async () => (await import("./votes/route")).GET(get(), ctx)],
];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a shared trip read", () => {
  it.each(routes)("the database refused is a 500 when reading %s", async (_, call) => {
    tripRead = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    expect((await call()).status).toBe(500);
  });

  it.each(routes)("for a token no live trip carries is a 404 when reading %s", async (_, call) => {
    tripRead = { data: null, error: null };
    expect((await call()).status).toBe(404);
  });
});
