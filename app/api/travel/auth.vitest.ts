// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The travel routes are for signed-in users only: a stranger could otherwise
 * spend the Google quota once the APIs are on, and fill the request log while
 * they are off.
 */

let signedIn = false;
const checkApiAccess = vi.fn(async () => ({ allowed: false, message: "disabled" }));
const logApiCall = vi.fn(async () => {});

vi.mock("@/lib/api/auth", async () => {
  const { errors } = await import("@/lib/api/response-wrapper");
  return {
    getAuthenticatedUser: async () =>
      signedIn
        ? { user: { id: "u1" }, supabase: {}, errorResponse: null }
        : { user: null, supabase: {}, errorResponse: errors.unauthorized() },
  };
});
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: (...args: unknown[]) => checkApiAccess(...(args as [])),
  logApiCall: (...args: unknown[]) => logApiCall(...(args as [])),
}));
vi.mock("@/lib/supabase/cache-admin", () => ({ cacheAdminDb: () => null }));

const geocode = await import("./geocode/route");
const distance = await import("./distance/route");

const post = (path: string, body: unknown) =>
  new NextRequest(`https://monkeytravel.app/api/travel/${path}`, { method: "POST", body: JSON.stringify(body) });

const pair = { index: 0, origin: { lat: 41.39, lng: 2.17 }, destination: { lat: 41.4, lng: 2.18 }, mode: "WALKING" };

beforeEach(() => {
  signedIn = false;
  checkApiAccess.mockClear();
  logApiCall.mockClear();
});

describe("POST /api/travel/geocode", () => {
  it("answers 401 to a stranger, before the access check or any log row", async () => {
    const res = await geocode.POST(post("geocode", { addresses: ["Sagrada Familia"] }));
    expect(res.status).toBe(401);
    expect(checkApiAccess).not.toHaveBeenCalled();
    expect(logApiCall).not.toHaveBeenCalled();
  });

  it("answers 503 to a signed-in user while the API is off", async () => {
    signedIn = true;
    const res = await geocode.POST(post("geocode", { addresses: ["Sagrada Familia"] }));
    expect(res.status).toBe(503);
    expect(checkApiAccess).toHaveBeenCalledWith("google_geocoding");
  });
});

describe("POST /api/travel/distance", () => {
  it("answers 401 to a stranger, before the access check or any log row", async () => {
    const res = await distance.POST(post("distance", { pairs: [pair] }));
    expect(res.status).toBe(401);
    expect(checkApiAccess).not.toHaveBeenCalled();
    expect(logApiCall).not.toHaveBeenCalled();
  });

  it("answers a signed-in user with the local estimate while the API is off", async () => {
    signedIn = true;
    const res = await distance.POST(post("distance", { pairs: [pair] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const data = body.data ?? body;
    expect(data.stats).toMatchObject({ total: 1, estimated: 1, fetched: 0 });
    expect(data.results[0].distanceText).toMatch(/^~/);
  });
});
