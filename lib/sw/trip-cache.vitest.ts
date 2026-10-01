import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncTripCacheOwner } from "./trip-cache";

const OWNER_KEY = "mt-trip-cache-owner";
let stored: Set<string>;

beforeEach(() => {
  stored = new Set(["mt-v3-trips", "mt-v3-static", "mt-v3-images"]);
  vi.stubGlobal("caches", {
    keys: async () => [...stored],
    delete: async (name: string) => stored.delete(name),
  });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("syncTripCacheOwner", () => {
  it("keeps the trips the same account opened", async () => {
    localStorage.setItem(OWNER_KEY, "user-a");
    await syncTripCacheOwner("user-a");
    expect(stored.has("mt-v3-trips")).toBe(true);
  });

  it("drops them on sign-out, and only them", async () => {
    localStorage.setItem(OWNER_KEY, "user-a");
    await syncTripCacheOwner(null);
    expect([...stored].sort()).toEqual(["mt-v3-images", "mt-v3-static"]);
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it("drops them when another account signs in, and remembers the new one", async () => {
    localStorage.setItem(OWNER_KEY, "user-a");
    await syncTripCacheOwner("user-b");
    expect(stored.has("mt-v3-trips")).toBe(false);
    expect(localStorage.getItem(OWNER_KEY)).toBe("user-b");
  });

  it("still clears while signed out, for a copy written after sign-out", async () => {
    await syncTripCacheOwner(null);
    stored.add("mt-v3-trips");
    await syncTripCacheOwner(null);
    expect(stored.has("mt-v3-trips")).toBe(false);
  });

  it("drops them when storage is blocked, since the owner is unknown", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    await syncTripCacheOwner("user-a");
    expect(stored.has("mt-v3-trips")).toBe(false);
  });
});
