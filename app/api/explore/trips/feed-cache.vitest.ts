// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Pages render the feed on every visit and every crawl, and each read pulls a
 * window of ranked rows. The feed is the same for everyone, so the CDN answers
 * it, and the database only sees a refresh.
 */

const s = vi.hoisted(() => ({
  error: null as { message: string } | null,
  selects: [] as unknown[][],
}));

vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => true }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const query: unknown = new Proxy(
      {},
      {
        get: (_target, name) => {
          if (name === "then") {
            return (resolve: (r: unknown) => unknown) => resolve({ data: s.error ? null : [], error: s.error });
          }
          if (name === "select") {
            return (...args: unknown[]) => {
              s.selects.push(args);
              return query;
            };
          }
          return () => query;
        },
      }
    );
    return { from: () => query };
  },
}));

const { GET } = await import("./route");
const get = (search = "") => GET(new NextRequest(`https://monkeytravel.app/api/explore/trips${search}`));

beforeEach(() => {
  s.error = null;
  s.selects = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Explore feed in the CDN", () => {
  it("keeps the main feed for 5 minutes, so a new trip shows up soon", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=86400");
  });

  it("keeps later pages and other filters the same way", async () => {
    const res = await get("?page=2&budget=budget");
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=86400");
  });

  it("keeps a destination's feed for an hour", async () => {
    const res = await get("?destination=Rome&page=1");
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
  });

  it("never keeps a failed read", async () => {
    s.error = { message: "read failed" };
    const res = await get("?destination=Rome");
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
  });
});

describe("what the feed asks of the database", () => {
  it("doesn't count the matching rows: the total comes from the deduped list", async () => {
    await get();
    expect(s.selects).toHaveLength(1);
    expect(s.selects[0]).toHaveLength(1);
  });
});
