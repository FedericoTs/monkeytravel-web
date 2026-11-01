// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * A trip gets one share link however many requests ask at once: the mint
 * lands only where there is still no token, and a request that loses the race
 * hands out the token the other one wrote.
 */

let stored: string | null;
let raced: string | null;
let writeError: unknown;
let client: ReturnType<typeof fakeSupabase>["client"];
let log: FakeQuery[];
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));

beforeEach(() => {
  stored = null;
  raced = null;
  writeError = null;
  ({ client, log } = fakeSupabase((q) => {
    if (q.op === "update") {
      if (writeError) return { data: null, error: writeError };
      // Another request wrote its token first: this write matches no row.
      if (raced) {
        stored = raced;
        return { data: [], error: null };
      }
      stored = (q.value as { share_token: string }).share_token;
      return { data: [{ id: "trip-1" }], error: null };
    }
    return { data: { share_token: stored }, error: null };
  }));
});

const { ensureShareToken } = await import("./share-token");

describe("ensureShareToken", () => {
  it("hands out the existing token and writes nothing", async () => {
    stored = "tok-old";
    expect(await ensureShareToken("trip-1", "shared")).toEqual({ token: "tok-old", isNew: false });
    expect(log.filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("mints one only where there is still none, with the visibility given", async () => {
    const out = await ensureShareToken("trip-1", "public");
    expect(out.isNew).toBe(true);
    const [update] = log.filter((q) => q.op === "update");
    expect(update.value).toMatchObject({ share_token: out.token, visibility: "public" });
    expect(update.filters).toEqual(
      expect.arrayContaining([
        ["eq", "id", "trip-1"],
        ["is", "share_token", null],
        ["is", "deleted_at", null],
      ])
    );
  });

  it("hands out the other request's token when that one wrote first", async () => {
    raced = "tok-first";
    expect(await ensureShareToken("trip-1", "shared")).toEqual({ token: "tok-first", isNew: false });
  });

  it("throws when the token can't be written", async () => {
    writeError = { message: "boom" };
    await expect(ensureShareToken("trip-1", "shared")).rejects.toEqual({ message: "boom" });
  });
});
