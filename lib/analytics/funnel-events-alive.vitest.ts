/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ kept: [] as Promise<unknown>[], inserted: [] as unknown[] }));
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => {
    s.kept.push(p);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (row: unknown) => {
        s.inserted.push(row);
        return { error: null };
      },
    }),
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { logFunnelEventServer } from "./funnel-events";

describe("a funnel event written on the server", () => {
  it("keeps the function alive until its row is in, whether the caller awaits it or not", async () => {
    const write = logFunnelEventServer({ event_type: "vote_cast", trip_id: "t-1" });
    expect(s.kept).toHaveLength(1);
    expect(s.kept[0]).toBe(write);
    await write;
    expect(s.inserted).toMatchObject([{ event_type: "vote_cast", trip_id: "t-1" }]);
  });
});
