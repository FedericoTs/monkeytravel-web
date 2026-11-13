/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The stay search's door: nothing is looked up for too little, too much or no
 * destination to search near, and the limit comes before Photon is asked.
 */

let allowed = true;
const searched: unknown[][] = [];
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed }) }),
}));
vi.mock("@/lib/places/stay-search", () => ({
  searchStays: async (...args: unknown[]) => {
    searched.push(args);
    return [{ name: "Memmo Alfama", detail: "Alfama, Lisbon", lat: 38.7111, lng: -9.1306 }];
  },
}));

const { POST } = await import("./route");

const post = async (body: unknown) => {
  const res = await POST(new NextRequest("https://monkeytravel.app/api/places/stay-search", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
};
const near = { latitude: 38.7223, longitude: -9.1393 };

beforeEach(() => {
  allowed = true;
  searched.length = 0;
});

describe("POST /api/places/stay-search", () => {
  it("searches near the destination for what was typed", async () => {
    const { status, json } = await post({ input: "  memmo ", near, locale: "pt" });
    expect(status).toBe(200);
    expect(json.places).toEqual([{ name: "Memmo Alfama", detail: "Alfama, Lisbon", lat: 38.7111, lng: -9.1306 }]);
    expect(searched).toEqual([["memmo", { lat: 38.7223, lng: -9.1393 }, "pt"]]);
  });

  it.each([
    ["too little typed", { input: "me", near }],
    ["too much typed", { input: "x".repeat(121), near }],
    ["no destination to search near", { input: "memmo" }],
    ["a destination that isn't a place", { input: "memmo", near: { latitude: "38.7", longitude: -9.1 } }],
  ])("looks nothing up for %s", async (_name, body) => {
    const { status, json } = await post(body);
    expect(status).toBe(200);
    expect(json.places).toEqual([]);
    expect(searched).toEqual([]);
  });

  it("stops at the limit, before Photon is asked", async () => {
    allowed = false;
    const { status } = await post({ input: "memmo", near });
    expect(status).toBe(429);
    expect(searched).toEqual([]);
  });
});
