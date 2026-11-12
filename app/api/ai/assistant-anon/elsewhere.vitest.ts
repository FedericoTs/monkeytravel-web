/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The wizard's assistant may offer another place for the whole trip: the
 * route lets the engine do so, passes the places on to the page, and logs
 * them with the exchange, so an offer is not read as an ask left unanswered.
 */

const assistTrip = vi.fn();
const logged: Record<string, unknown>[] = [];

vi.mock("@/lib/ai/assistant/engine", () => ({ assistTrip: (input: unknown) => assistTrip(input), MAX_TRIP_DAYS_MULTI: 21 }));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: async () => {} }));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: async (row: Record<string, unknown>) => (logged.push(row), { error: null }) }) }),
}));
vi.mock("@/lib/supabase/server", () => ({ signedInUserId: async () => null }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

import { POST } from "./route";

const ask = (message: string) =>
  POST(
    new NextRequest("http://localhost/api/ai/assistant-anon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, destination: "Moab, USA", tripTitle: "Moab Trip", days: [{ day_number: 1, activities: [] }] }),
    })
  );
const answer = async (res: Response) => {
  const body = await res.json();
  return (body.data ?? body) as Record<string, unknown>;
};
const meta = { model: "m", costUsd: 0, generationTimeMs: 1 };

beforeEach(() => {
  assistTrip.mockReset();
  logged.length = 0;
});

describe("another place for the whole trip", () => {
  it("is allowed, passed on to the page and logged with the exchange", async () => {
    assistTrip.mockResolvedValue({ reply: "Málaga suits a sunny stag-do.", edits: [], elsewhere: [{ name: "Málaga", country: "Spain" }], meta });

    const res = await ask("Give me malaga");

    expect(assistTrip.mock.calls[0][0]).toMatchObject({ canPlanElsewhere: true, destination: "Moab, USA" });
    expect(await answer(res)).toMatchObject({ reply: "Málaga suits a sunny stag-do.", edits: [], elsewhere: [{ name: "Málaga", country: "Spain" }] });
    expect(logged[0].edit).toEqual({ day_number: null, days: [], trip_length: null, elsewhere: ["Málaga, Spain"] });
  });

  it("logs no change for a plain answer", async () => {
    assistTrip.mockResolvedValue({ reply: "Arches opens at 6.", edits: [], meta });

    expect(await answer(await ask("when does Arches open?"))).not.toHaveProperty("elsewhere");
    expect(logged[0].edit).toBeUndefined();
  });
});

describe("a new route for the whole trip", () => {
  const route = [
    { name: "Lisboa", country: "Portugal", days: 7 },
    { name: "Porto", country: "Portugal", days: 4 },
    { name: "Lisboa", country: "Portugal", days: 3 },
  ];

  it("is allowed with multi-city on, passed on to the page and logged with the exchange", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_CITY_ENABLED", "true");
    assistTrip.mockResolvedValue({ reply: "Your new route: …", edits: [], route, meta });

    const res = await ask("the last 3 days back in Lisbon");

    expect(assistTrip.mock.calls[0][0]).toMatchObject({ canPlanRoute: true });
    expect(await answer(res)).toMatchObject({ edits: [], route });
    expect(logged[0].edit).toEqual({
      day_number: null,
      days: [],
      trip_length: null,
      route: ["Lisboa, Portugal: 7", "Porto, Portugal: 4", "Lisboa, Portugal: 3"],
    });
    vi.unstubAllEnvs();
  });

  it("is not asked for with multi-city off", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_CITY_ENABLED", "false");
    assistTrip.mockResolvedValue({ reply: "Done.", edits: [], meta });
    await ask("the last 3 days back in Lisbon");
    expect(assistTrip.mock.calls[0][0]).toMatchObject({ canPlanRoute: false });
    vi.unstubAllEnvs();
  });
});
