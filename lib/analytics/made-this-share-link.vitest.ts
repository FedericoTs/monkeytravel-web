/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A trip a signed-out planner shared has no owner, so the browser that made
 * its link is told from a friend's by its session: the one on the link's own
 * row (share_link_created).
 */

const cookieJar: Record<string, string> = {};
const filters: Array<[string, unknown]> = [];
let rows: unknown[] | null = [];
let fails = false;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name in cookieJar ? { value: cookieJar[name] } : undefined) }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q = {
      select: () => q,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return q;
      },
      limit: async () => {
        if (fails) throw new Error("no database");
        return { data: rows, error: null };
      },
    };
    return {
      from: (table: string) => {
        filters.push(["table", table]);
        return q;
      },
    };
  },
}));

const { madeThisShareLink } = await import("./funnel-events");

beforeEach(() => {
  for (const key of Object.keys(cookieJar)) delete cookieJar[key];
  filters.length = 0;
  rows = [];
  fails = false;
});

describe("madeThisShareLink", () => {
  it("is true for the session on the trip's share link row", async () => {
    cookieJar.mt_session_id = "session-of-the-sharer";
    rows = [{ id: "event-1" }];
    expect(await madeThisShareLink("trip-1")).toBe(true);
    expect(filters).toEqual([
      ["table", "funnel_events"],
      ["trip_id", "trip-1"],
      ["event_type", "share_link_created"],
      ["session_id", "session-of-the-sharer"],
    ]);
  });

  it("is false for another browser's session", async () => {
    cookieJar.mt_session_id = "session-of-a-friend";
    expect(await madeThisShareLink("trip-1")).toBe(false);
  });

  it("is false, without a read, for a browser with no session", async () => {
    rows = [{ id: "event-1" }];
    expect(await madeThisShareLink("trip-1")).toBe(false);
    expect(filters).toEqual([]);
  });

  it("is false when the read fails or answers nothing: the visit is then counted", async () => {
    cookieJar.mt_session_id = "session-of-the-sharer";
    fails = true;
    expect(await madeThisShareLink("trip-1")).toBe(false);
    fails = false;
    rows = null;
    expect(await madeThisShareLink("trip-1")).toBe(false);
  });
});
