import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A trip's card is cached by the CDN for a day under the trip's tag; the
 * routes that make its link stop resolving drop that tag, so a deleted,
 * unshared or unpublished trip doesn't keep its picture.
 */

const dangerouslyDeleteByTag = vi.fn(async (_tag: string) => undefined);
vi.mock("@vercel/functions", () => ({ dangerouslyDeleteByTag }));

const { purgeTripCard, tripCardTag } = await import("./trip-card-cache");
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");

beforeEach(() => dangerouslyDeleteByTag.mockClear());

describe("purgeTripCard", () => {
  it("drops the trip's tag", async () => {
    await purgeTripCard("trip-1");
    expect(dangerouslyDeleteByTag).toHaveBeenCalledWith("trip-card-trip-1");
  });

  it("never fails the request that triggered it", async () => {
    dangerouslyDeleteByTag.mockRejectedValueOnce(new Error("purge unavailable"));
    await expect(purgeTripCard("trip-1")).resolves.toBeUndefined();
  });
});

describe("trip card wiring", () => {
  it("tags rendered trip cards, not the brand fallback", () => {
    const src = read("app/api/og/trip/route.tsx");
    expect(tripCardTag("x")).toBe("trip-card-x");
    expect(src).toContain('...(tag ? { "Vercel-Cache-Tag": tag } : {})');
    expect(src).toMatch(/stale-while-revalidate=604800",\s*tripCardTag\(data\.id\)/);
    expect(src).toMatch(/const fallback = \(\) => respond\(renderBrandCard\(format, logo\), "public, max-age=300"\);/);
  });

  it("serves a slug's card only for a published trip", () => {
    const src = read("app/api/og/trip/route.tsx");
    expect(src).toContain('query.eq("public_slug", slug).eq("visibility", "public")');
    expect(src).toContain("if (!token && data.is_hidden === true) return fallback();");
  });

  it("purges on delete, stop sharing and unpublish", () => {
    expect(read("app/api/trips/[id]/route.ts")).toContain("if (deleted === true) after(() => purgeTripCard(id));");
    expect(read("app/api/trips/[id]/share/route.ts")).toContain("after(() => purgeTripCard(id));");
    expect(read("app/api/trips/[id]/publish/route.ts")).toContain("after(() => purgeTripCard(tripId));");
  });
});
