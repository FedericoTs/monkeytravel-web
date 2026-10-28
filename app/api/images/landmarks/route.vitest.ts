/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The planner asks for the Wikimedia photos found for its plan's places since
 * the plan was shown. Only the shared cache is read: each name gets the photo
 * stored for it, or null, in the order asked.
 */

const WIKI = "/api/images/wikimedia/abc-500.jpg?a=X&l=CC0&f=Y.jpg";
let cached: Map<string, string | null>;
const asked: string[][] = [];
vi.mock("@/lib/images/landmark-photos", () => ({
  cachedLandmarkPhotos: async (keys: string[]) => {
    asked.push(keys);
    return new Map([...cached].filter(([key]) => keys.includes(key)));
  },
}));
let allowed = true;
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed, remaining: 1 }) }) }));

const { POST } = await import("./route");
const { normalizeActivityKey } = await import("@/lib/images/activity");

const ask = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/images/landmarks", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  cached = new Map([
    [normalizeActivityKey("Charles Bridge", "Prague, Czechia"), WIKI],
    [normalizeActivityKey("Lokál", "Prague, Czechia"), null],
  ]);
  asked.length = 0;
  allowed = true;
});

describe("POST /api/images/landmarks", () => {
  it("answers each name with its stored photo, or null, in the order asked", async () => {
    const res = await ask({ destination: "Prague, Czechia", names: ["Lokál", "Charles Bridge", "Unknown Café", "Charles Bridge"] });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ photos: [null, WIKI, null, WIKI] });
    // One read, each key once.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toHaveLength(3);
  });

  it("refuses a request without a destination or with too many names", async () => {
    expect((await ask({ names: ["Charles Bridge"] })).status).toBe(400);
    expect((await ask({ destination: "Prague", names: [] })).status).toBe(400);
    expect((await ask({ destination: "Prague", names: Array(81).fill("x") })).status).toBe(400);
    expect((await ask({ destination: "Prague", names: [42] })).status).toBe(400);
    expect(asked).toHaveLength(0);
  });

  it("is rate limited", async () => {
    allowed = false;
    expect((await ask({ destination: "Prague, Czechia", names: ["Charles Bridge"] })).status).toBe(429);
  });
});
