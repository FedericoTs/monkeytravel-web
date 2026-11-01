// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase } from "@/tests/fake-supabase";
import { readSharedTrip } from "./shared-trip";

const TOKEN = "11111111-2222-4333-8444-555555555555";
let answer: { data: unknown; error: unknown };
const db = () => fakeSupabase(() => answer);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readSharedTrip", () => {
  it("returns the live trip behind the token", async () => {
    answer = { data: { id: "trip-1", user_id: "owner-1" }, error: null };
    const fake = db();
    const { trip, errorResponse } = await readSharedTrip<{ id: string; user_id: string }>(fake.client as unknown as SupabaseClient, TOKEN, "id, user_id");
    expect(errorResponse).toBeNull();
    expect(trip).toEqual({ id: "trip-1", user_id: "owner-1" });
    expect(fake.log[0]).toMatchObject({ table: "trips", filters: [["eq", "share_token", TOKEN], ["is", "deleted_at", null]] });
  });

  it("is a 404 for a token no live trip carries, or a malformed one", async () => {
    for (const miss of [{ data: null, error: null }, { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } }]) {
      answer = miss;
      const { trip, errorResponse } = await readSharedTrip(db().client as unknown as SupabaseClient, TOKEN, "id");
      expect(trip).toBeNull();
      expect(errorResponse?.status).toBe(404);
    }
  });

  it("is a 500 when the database refuses the read, so a working link never looks dead", async () => {
    answer = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const { trip, errorResponse } = await readSharedTrip(db().client as unknown as SupabaseClient, TOKEN, "id");
    expect(trip).toBeNull();
    expect(errorResponse?.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith("[shared trip] read failed:", "canceling statement due to statement timeout");
  });
});
