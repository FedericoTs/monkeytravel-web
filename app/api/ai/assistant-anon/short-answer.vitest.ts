/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The planner's assistant asks questions ("Delete the whole trip?", "Which
 * day?") and travellers answer in a word: "sì", "ok", "2". Those reach the
 * assistant; an empty message still doesn't.
 */

const assistTrip = vi.fn();

vi.mock("@/lib/ai/assistant/engine", () => ({ assistTrip: (input: unknown) => assistTrip(input), MAX_TRIP_DAYS_MULTI: 21 }));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: async () => {} }));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }));
vi.mock("@/lib/supabase/server", () => ({ signedInUserId: async () => null }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

import { POST } from "./route";

const ask = (message: string) =>
  POST(
    new NextRequest("http://localhost/api/ai/assistant-anon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        destination: "Roma, Italia",
        tripTitle: "Roma",
        days: [{ day_number: 1, activities: [] }],
        history: [
          { role: "user", text: "cancella tutto" },
          { role: "assistant", text: "Vuoi cancellare tutto il viaggio?" },
        ],
      }),
    })
  );

beforeEach(() => {
  assistTrip.mockReset();
  assistTrip.mockResolvedValue({ reply: "Fatto.", edits: [], meta: { model: "m", costUsd: 0, generationTimeMs: 1 } });
});

describe("a one-word answer", () => {
  it.each(["sì", "sí", "ok", "no", "2", "y"])("reaches the assistant: %s", async (message) => {
    const res = await ask(message);
    expect(res.status).toBe(200);
    expect(assistTrip.mock.calls[0][0]).toMatchObject({ message });
  });

  it("but an empty message doesn't", async () => {
    for (const message of ["", "   "]) {
      expect((await ask(message)).status).toBe(400);
    }
    expect(assistTrip).not.toHaveBeenCalled();
  });
});
