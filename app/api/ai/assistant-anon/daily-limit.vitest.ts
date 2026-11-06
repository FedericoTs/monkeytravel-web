/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** Anonymous questions count against today's limit for everyone; a signed-in person's don't. */

const assistTrip = vi.fn();
const s = vi.hoisted(() => ({ user: null as string | null, within: true, asked: 0 }));

vi.mock("@/lib/ai/assistant/engine", () => ({ assistTrip: (input: unknown) => assistTrip(input), MAX_TRIP_DAYS_MULTI: 21 }));
vi.mock("@/lib/ai/anon-daily-limit", () => ({
  withinAnonDailyLimit: async () => {
    s.asked++;
    return s.within;
  },
}));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: async () => {} }));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));
vi.mock("@/lib/supabase/server", () => ({ signedInUserId: async () => s.user }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

import { POST } from "./route";

const ask = () =>
  POST(
    new NextRequest("http://localhost/api/ai/assistant-anon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "when does it open?", destination: "Moab, USA", tripTitle: "Moab Trip", days: [{ day_number: 1, activities: [] }] }),
    })
  );

beforeEach(() => {
  assistTrip.mockReset();
  assistTrip.mockResolvedValue({ reply: "At 6.", edits: [], meta: { model: "m", costUsd: 0, generationTimeMs: 1 } });
  s.user = null;
  s.within = true;
  s.asked = 0;
});

describe("today's limit on the anonymous assistant", () => {
  it("answers within it", async () => {
    expect((await ask()).status).toBe(200);
    expect(s.asked).toBe(1);
  });

  it("stops past it, without calling the model", async () => {
    s.within = false;
    const res = await ask();
    expect(res.status).toBe(429);
    expect((await res.json()).reason).toBe("daily_anon");
    expect(assistTrip).not.toHaveBeenCalled();
  });

  it("doesn't count someone signed in", async () => {
    s.user = "u-1";
    s.within = false;
    expect((await ask()).status).toBe(200);
    expect(s.asked).toBe(0);
  });
});
