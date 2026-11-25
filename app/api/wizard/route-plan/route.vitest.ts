/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A trip typed as a whole country or region gets the bases to offer on step 1:
 * checked before they go back, nothing for a city, never without limits.
 */

const s = vi.hoisted(() => ({
  answer: null as unknown,
  asked: [] as Array<{ place: string; days: number; month: number | null; language: string }>,
  allowed: true,
  burstAllowed: true,
  open: true,
  logged: [] as Array<{ status: number; costUsd: number; metadata?: unknown; error?: unknown }>,
  limits: {} as Record<string, { max: number; windowMs: number }>,
}));

vi.mock("@/lib/ai/route-plan", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/route-plan")>();
  return {
    ...real,
    askForRoute: async (place: string, days: number, month: number | null, language: string) => {
      s.asked.push({ place, days, month, language });
      return { answer: s.answer, costUsd: s.answer ? 0.0003 : 0 };
    },
  };
});
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: s.open, message: s.open ? undefined : "Gemini is off" }),
  logApiCall: async (row: { status: number; costUsd: number; metadata?: unknown }) => {
    s.logged.push(row);
  },
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: (name: string, max: number, windowMs: number) => {
    s.limits[name] = { max, windowMs };
    return {
      check: async () => ({ allowed: name.endsWith("burst") ? s.burstAllowed : s.allowed, remaining: 1 }),
    };
  },
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

import { POST } from "./route";

const ask = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/wizard/route-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const THAILAND = {
  stops: [
    { name: "Bangkok", country: "Thailand", days: 3 },
    { name: "Chiang Mai", country: "Thailand", days: 4 },
    { name: "Phuket", country: "Thailand", days: 7 },
  ],
};

beforeEach(() => {
  s.answer = null;
  s.asked = [];
  s.allowed = true;
  s.burstAllowed = true;
  s.open = true;
  s.logged = [];
});

describe("asking a route", () => {
  it("sends the bases back as the route builder's rows, asked with the trip's month, and logs what it cost", async () => {
    s.answer = THAILAND;
    const res = await ask({ place: "Thailand", days: 14, startDate: "2027-11-20", locale: "es" });
    expect(res.status).toBe(200);
    expect((await res.json()).route).toEqual([
      { city: "Bangkok", nights: 3 },
      { city: "Chiang Mai", nights: 4 },
      { city: "Phuket", nights: 7 },
    ]);
    expect(s.asked).toEqual([{ place: "Thailand", days: 14, month: 11, language: "es" }]);
    expect(s.logged).toMatchObject([{ status: 200, costUsd: 0.0003, metadata: { days: 14, stops: 3 } }]);
  });

  it("sends no route for one base, or when the model gave no answer", async () => {
    s.answer = { stops: [{ name: "Tokyo", country: "Japan", days: 10 }] };
    let res = await ask({ place: "Tokyo", days: 10 });
    expect((await res.json()).route).toEqual([]);
    expect(s.asked[0].month).toBeNull();
    expect(s.logged[0]).toMatchObject({ status: 200, metadata: { stops: 0 } });

    s.answer = null;
    res = await ask({ place: "Thailand", days: 14 });
    expect(res.status).toBe(200);
    expect((await res.json()).route).toEqual([]);
    expect(s.logged[1]).toMatchObject({ status: 502, error: "no answer" });
  });

  it("refuses a body it can't use without asking", async () => {
    for (const body of [{ place: "T", days: 14 }, { place: "Thailand", days: 1 }, { place: "Thailand", days: 22 }, { place: "Thailand", days: 14, startDate: "soon" }]) {
      expect((await ask(body)).status).toBe(400);
    }
    expect(s.asked).toEqual([]);
  });

  it("stops at its limits, and logs it", async () => {
    s.burstAllowed = false;
    expect((await ask({ place: "Thailand", days: 14 })).status).toBe(429);
    s.burstAllowed = true;
    s.allowed = false;
    expect((await ask({ place: "Thailand", days: 14 })).status).toBe(429);
    expect(s.asked).toEqual([]);
    expect(s.logged).toMatchObject([
      { status: 429, error: "burst" },
      { status: 429, error: "daily cap (per IP)" },
    ]);
  });

  // Step 1 asks each time typing pauses, and refused asks count too.
  it("leaves room for a place typed slowly: 12 asks a minute, 40 a day", () => {
    expect(s.limits["route-plan-burst"]).toEqual({ max: 12, windowMs: 60 * 1000 });
    expect(s.limits["route-plan"]).toEqual({ max: 40, windowMs: 24 * 60 * 60 * 1000 });
  });

  it("answers unavailable while the model is switched off", async () => {
    s.open = false;
    expect((await ask({ place: "Thailand", days: 14 })).status).toBe(503);
    expect(s.asked).toEqual([]);
  });
});
