/** @vitest-environment node */
import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Each place's Wikimedia photo is looked up once and shared through the cache:
 * a found photo for a year, "none" for two months, a failure not at all. A plan
 * being generated never waits for a lookup; a saved trip does.
 */

const build = vi.fn();
vi.mock("@/lib/images/wikimedia-landmark", () => ({ buildLandmarkPhoto: (...a: unknown[]) => build(...a) }));
vi.mock("@/lib/api-gateway", () => ({ logApiCall: vi.fn(async () => {}) }));
const background: Promise<unknown>[] = [];
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => background.push(p) }));

let rows: { place_id: string; data: unknown }[];
const upserts: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/cache-admin", () => ({
  cacheAdminDb: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        in: () => chain,
        gt: async () => ({ data: rows, error: null }),
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row);
          return { error: null };
        },
      };
      return chain;
    },
  }),
}));

const { landmarkPhotos } = await import("./landmark-photos");

const hash = (key: string) => createHash("md5").update(`wikimedia_landmark_v1:${key}`).digest("hex");
const lookup = (key: string) => ({ key, names: [key], lat: 41.89, lng: 12.49 });
const url = (n: string) => `/api/images/wikimedia/${n.repeat(20)}-500.jpg?a=X&l=CC0&f=X.jpg`;
const days = (row: Record<string, unknown>) => Math.round((Date.parse(String(row.expires_at)) - Date.now()) / 86_400_000);

beforeEach(() => {
  rows = [];
  upserts.length = 0;
  background.length = 0;
  build.mockReset();
});

describe("landmarkPhotos", () => {
  it("answers from the cache, a place without a photo included, without looking anything up", async () => {
    rows = [
      { place_id: hash("colosseum|rome"), data: { url: url("a") } },
      { place_id: hash("trattoria da enzo|rome"), data: { none: true } },
    ];
    const photos = await landmarkPhotos([lookup("colosseum|rome"), lookup("trattoria da enzo|rome")], { waitMs: 5000, maxNew: 12 });
    expect([...photos]).toEqual([["colosseum|rome", url("a")]]);
    expect(build).not.toHaveBeenCalled();
  });

  it("for a saved trip, looks up new places and keeps a photo for a year, none for two months", async () => {
    build.mockImplementation(async (_db: unknown, q: { names: string[] }) => (q.names[0] === "pantheon|rome" ? url("b") : null));
    const photos = await landmarkPhotos([lookup("pantheon|rome"), lookup("bar del fico|rome")], { waitMs: 5000, maxNew: 12 });
    expect(photos.get("pantheon|rome")).toBe(url("b"));
    expect(upserts.map((r) => [r.data, days(r)])).toEqual(
      expect.arrayContaining([
        [{ url: url("b") }, 365],
        [{ none: true }, 60],
      ]),
    );
  });

  it("for a plan being generated, answers from the cache now and looks up the rest afterwards", async () => {
    build.mockResolvedValue(url("c"));
    const photos = await landmarkPhotos([lookup("trevi fountain|rome")], { waitMs: 0, maxNew: 12 });
    expect(photos.size).toBe(0);
    expect(background).toHaveLength(1);
    await Promise.all(background);
    expect(upserts[0]).toMatchObject({ cache_type: "wikimedia_landmark", data: { url: url("c") } });
  });

  it("looks up at most maxNew places per call", async () => {
    build.mockResolvedValue(null);
    await landmarkPhotos(["a", "b", "c", "d"].map(lookup), { waitMs: 5000, maxNew: 2 });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("does not remember a failure, so the next save tries again", async () => {
    build.mockRejectedValue(new Error("www.wikidata.org answered 429"));
    const photos = await landmarkPhotos([lookup("pantheon|rome")], { waitMs: 5000, maxNew: 12 });
    expect(photos.size).toBe(0);
    expect(upserts).toHaveLength(0);
  });

  it("waits only so long for a saved trip; a slower lookup finishes in the background", async () => {
    let finish!: (url: string) => void;
    build.mockImplementation((_db: unknown, q: { names: string[] }) =>
      q.names[0] === "slow|rome" ? new Promise((resolve) => (finish = resolve)) : Promise.resolve(url("d")),
    );
    const photos = await landmarkPhotos([lookup("quick|rome"), lookup("slow|rome")], { waitMs: 50, maxNew: 12 });
    expect([...photos.keys()]).toEqual(["quick|rome"]);
    finish(url("e"));
    await Promise.all(background);
    expect(upserts.map((r) => r.data)).toContainEqual({ url: url("e") });
  });
});
