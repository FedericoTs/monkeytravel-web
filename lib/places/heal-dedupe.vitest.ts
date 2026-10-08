/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { HEAL_REUSE_MAX_AGE_DAYS, InFlight, readPhotoIndex, reusableFreshRef, withPhotoIndex } from "./heal-dedupe";

const NOW = Date.parse("2026-09-13T10:00:00Z");
const DEAD = "places/ChIJdead/photos/AAAA";
const LIVE = "places/ChIJdead/photos/BBBB";
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("reusableFreshRef", () => {
  it("reuses a different ref refreshed recently (another request already paid)", () => {
    const row = { photo_resource_name: LIVE, photo_url: `/api/places/photo?name=${LIVE}`, updated_at: daysAgo(2) };
    expect(reusableFreshRef(row, DEAD, NOW)).toEqual({
      photo_resource_name: LIVE,
      photo_url: `/api/places/photo?name=${LIVE}`,
    });
  });

  it("does not reuse the dead ref itself, however fresh the row looks", () => {
    const row = { photo_resource_name: DEAD, photo_url: "x", updated_at: daysAgo(0) };
    expect(reusableFreshRef(row, DEAD, NOW)).toBeNull();
  });

  it("does not trust a ref old enough to be dead too", () => {
    const row = { photo_resource_name: LIVE, photo_url: "x", updated_at: daysAgo(HEAL_REUSE_MAX_AGE_DAYS) };
    expect(reusableFreshRef(row, DEAD, NOW)).toBeNull();
    const justInside = { ...row, updated_at: daysAgo(HEAL_REUSE_MAX_AGE_DAYS - 0.01) };
    expect(reusableFreshRef(justInside, DEAD, NOW)).not.toBeNull();
  });

  it("returns null for a missing row, missing fields, or an unparsable timestamp", () => {
    expect(reusableFreshRef(null, DEAD, NOW)).toBeNull();
    expect(reusableFreshRef(undefined, DEAD, NOW)).toBeNull();
    expect(reusableFreshRef({ photo_resource_name: null, photo_url: null, updated_at: daysAgo(1) }, DEAD, NOW)).toBeNull();
    expect(reusableFreshRef({ photo_resource_name: LIVE, photo_url: null, updated_at: daysAgo(1) }, DEAD, NOW)).toBeNull();
    expect(reusableFreshRef({ photo_resource_name: LIVE, photo_url: "x", updated_at: "not a date" }, DEAD, NOW)).toBeNull();
    expect(reusableFreshRef({ photo_resource_name: LIVE, photo_url: "x", updated_at: null }, DEAD, NOW)).toBeNull();
  });

  it("treats a timestamp from the future as untrusted rather than fresh", () => {
    const row = { photo_resource_name: LIVE, photo_url: "x", updated_at: daysAgo(-1) };
    expect(reusableFreshRef(row, DEAD, NOW)).toBeNull();
  });
});

describe("InFlight", () => {
  it("shares one call between concurrent requests for the same key", async () => {
    const flight = new InFlight<number>();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fn = async () => {
      calls += 1;
      await gate;
      return 42;
    };
    const a = flight.run("place-1", fn);
    const b = flight.run("place-1", fn);
    const c = flight.run("place-2", fn);
    expect(flight.size).toBe(2);
    release();
    expect(await Promise.all([a, b, c])).toEqual([42, 42, 42]);
    expect(calls).toBe(2);
    expect(flight.size).toBe(0);
  });

  it("releases the key after settling so a later request runs again", async () => {
    const flight = new InFlight<string>();
    let calls = 0;
    const fn = async () => `run-${++calls}`;
    expect(await flight.run("k", fn)).toBe("run-1");
    expect(await flight.run("k", fn)).toBe("run-2");
  });

  it("propagates a failure to every sharer and still releases the key", async () => {
    const flight = new InFlight<string>();
    const fn = async () => {
      throw new Error("google down");
    };
    const a = flight.run("k", fn);
    const b = flight.run("k", fn);
    await expect(a).rejects.toThrow("google down");
    await expect(b).rejects.toThrow("google down");
    expect(flight.size).toBe(0);
  });
});

describe("gallery photo index", () => {
  const TILE = "/api/places/photo?name=places%2FChIJdead%2Fphotos%2FAAAA&w=200&h=150";

  it("tags a gallery proxy URL with its index, once", () => {
    expect(withPhotoIndex(TILE, 3)).toBe(`${TILE}&i=3`);
    expect(withPhotoIndex(`${TILE}&i=2`, 3)).toBe(`${TILE}&i=2`);
  });

  it("leaves the cover, bad indexes and non-proxy URLs alone", () => {
    expect(withPhotoIndex(TILE, 0)).toBe(TILE);
    expect(withPhotoIndex(TILE, -1)).toBe(TILE);
    expect(withPhotoIndex(TILE, 1.5)).toBe(TILE);
    expect(withPhotoIndex("https://images.pexels.com/photos/1/p.jpeg", 2)).toBe("https://images.pexels.com/photos/1/p.jpeg");
  });

  it("reads the index back; anything else is the first photo", () => {
    expect(readPhotoIndex("3")).toBe(3);
    expect(readPhotoIndex("9")).toBe(9);
    for (const raw of [null, undefined, "", "0", "-1", "10", "2.5", "abc"]) expect(readPhotoIndex(raw)).toBe(0);
  });
});
