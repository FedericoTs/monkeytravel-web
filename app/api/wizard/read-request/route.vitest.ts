/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A request typed into step 1's destination box, read into the wizard's
 * fields: checked before it goes back, never a dead end, never without limits.
 */

const s = vi.hoisted(() => ({
  answer: null as unknown,
  asked: [] as Array<{ text: string; today: string; language: string }>,
  allowed: true,
  burstAllowed: true,
  open: true,
  logged: [] as Array<{ status: number; costUsd: number; metadata?: unknown }>,
}));

vi.mock("@/lib/ai/read-request", () => ({
  askForReading: async (text: string, today: string, language: string) => {
    s.asked.push({ text, today, language });
    return { answer: s.answer, costUsd: s.answer ? 0.0004 : 0 };
  },
}));
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: s.open, message: s.open ? undefined : "Gemini is off" }),
  logApiCall: async (row: { status: number; costUsd: number; metadata?: unknown }) => {
    s.logged.push(row);
  },
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: (name: string) => ({
    check: async () => ({ allowed: name.endsWith("burst") ? s.burstAllowed : s.allowed, remaining: 1 }),
  }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

import { POST } from "./route";

const read = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/wizard/read-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const TEXT = "un itinerario di 12 giorni in Giappone a ottobre, famiglia";

beforeEach(() => {
  s.answer = null;
  s.asked = [];
  s.allowed = true;
  s.burstAllowed = true;
  s.open = true;
  s.logged = [];
});

describe("reading a request", () => {
  it("sends the reading back, checked, and logs what it cost", async () => {
    s.answer = { places: [{ name: "Japan", days: 12 }, { name: "x" }], days: 12, start_date: "", end_date: "", month: 10, who: "family", vibes: ["spa"], budget: "" };
    const res = await read({ text: TEXT, today: "2026-11-10", locale: "it" });
    expect(res.status).toBe(200);
    expect((await res.json()).reading).toEqual({
      places: [{ name: "Japan", days: 12 }],
      days: 12,
      startDate: null,
      endDate: null,
      month: 10,
      who: "family",
      vibes: [],
      budget: null,
    });
    expect(s.asked).toEqual([{ text: TEXT, today: "2026-11-10", language: "it" }]);
    expect(s.logged).toMatchObject([{ status: 200, costUsd: 0.0004, metadata: { places: 1, dates: false } }]);
  });

  it("answers with no reading when the model gave none, so the page keeps the words as notes", async () => {
    const res = await read({ text: TEXT, today: "2026-11-10" });
    expect(res.status).toBe(200);
    expect((await res.json()).reading).toBeNull();
    expect(s.logged).toMatchObject([{ status: 502, costUsd: 0 }]);
  });

  it("refuses what isn't a request to read", async () => {
    for (const body of [{ text: "ab", today: "2026-11-10" }, { text: TEXT, today: "2026-02-31" }, { text: "x".repeat(501), today: "2026-11-10" }, { text: TEXT }]) {
      expect((await read(body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(s.asked).toHaveLength(0);
  });

  it("stops past its limits, and while the model is switched off, without asking it", async () => {
    s.allowed = false;
    expect((await read({ text: TEXT, today: "2026-11-10" })).status).toBe(429);
    s.allowed = true;
    s.burstAllowed = false;
    expect((await read({ text: TEXT, today: "2026-11-10" })).status).toBe(429);
    s.burstAllowed = true;
    s.open = false;
    expect((await read({ text: TEXT, today: "2026-11-10" })).status).toBe(503);
    expect(s.asked).toHaveLength(0);
    expect(s.logged.map((l) => l.status)).toEqual([429, 429]);
  });
});
