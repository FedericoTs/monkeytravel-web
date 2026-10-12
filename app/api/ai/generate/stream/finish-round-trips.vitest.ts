// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * After the model's last day, the stream waits on the activity-image cache
 * before it sends `complete`. Those database round trips must not grow with
 * the trip: one per activity made long trips finish last, against the cap.
 */

vi.hoisted(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
});

let db: ReturnType<typeof fakeSupabase>;
const client = {
  from: (table: string) => db.client.from(table),
  rpc: (fn: string, args: unknown) => db.client.rpc(fn, args),
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...client, auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

const background: Array<Promise<unknown>> = [];
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => void background.push(Promise.resolve(p).catch(() => {})),
}));
vi.mock("@/lib/anonymous/rate-limit", () => ({
  checkAnonymousRateLimit: async () => ({ allowed: true, used: 0, limit: 5, resetAt: Date.now() + 60_000 }),
  recordAnonymousGeneration: async () => {},
}));
vi.mock("@/lib/ai/user-context", () => ({
  loadUserContext: async () => ({ profilePreferences: undefined, userLanguage: "en" }),
}));
vi.mock("@/lib/api-gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-gateway")>()),
  checkApiAccess: async () => ({ allowed: true }),
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 0, remaining: 10, limit: 10 }),
  incrementUsage: async () => {},
}));
vi.mock("@/lib/ai/cache", () => ({
  getCachedItinerary: async () => null,
  cacheItinerary: async () => {},
  adjustItineraryDates: (itinerary: unknown) => itinerary,
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/cache", () => ({ cache: { withDatabase: async () => ({ data: { imageUrl: null } }) } }));

// The model streams the itinerary in chunks; `modelDone` is how many queries
// had run when it finished.
let itineraryText = "";
let modelDone = -1;
vi.mock("@/lib/gemini", () => ({
  validateTripParams: () => ({ valid: true }),
  generateItineraryStream: async function* () {
    for (let i = 0; i < itineraryText.length; i += 400) {
      yield { text: itineraryText.slice(i, i + 400), done: false };
    }
    modelDone = db.log.length;
    yield { text: "", done: true, fullText: itineraryText, latencyMs: 1 };
  },
  parseStreamedItinerary: (text: string) => JSON.parse(text),
}));

import { POST } from "./route";

const photoUrl = (placeId: string) =>
  `/api/places/photo?name=${encodeURIComponent(`places/${placeId}/photos/a${"x".repeat(250)}`)}&w=600&h=400`;

/** Generate a trip of `days` days, five sights a day, every other one cached. */
async function generate(days: number) {
  const places = new Map<string, Record<string, unknown>>();
  const lookups = new Map<string, string>();
  const itinerary = {
    destination: { name: "Rome", country: "Italy" },
    days: Array.from({ length: days }, (_, d) => ({
      day_number: d + 1,
      date: `2026-11-${String(d + 1).padStart(2, "0")}`,
      title: `Day ${d + 1}`,
      activities: Array.from({ length: 5 }, (_, a) => {
        const name = `Sight ${d}-${a}`;
        if ((d * 5 + a) % 2 === 0) {
          const placeId = `ChIJsight${d}x${a}`;
          places.set(placeId, { place_id: placeId, display_name: name, photo_url: photoUrl(placeId), updated_at: new Date().toISOString() });
          lookups.set(`sight ${d} ${a}|rome italy`, placeId);
        }
        return { name, type: "attraction", description: "", location: "Rome" };
      }),
    })),
  };
  itineraryText = JSON.stringify(itinerary);

  db = fakeSupabase((q: FakeQuery) => {
    if (q.table === "places_v2_lookup") {
      const keys = q.filters.flatMap(([op, column, value]) =>
        column !== "normalized_key" ? [] : op === "in" ? (value as string[]) : op === "eq" ? [value as string] : []
      );
      const rows = keys
        .filter((key) => lookups.has(key))
        .map((key) => ({ normalized_key: key, place_id: lookups.get(key), places_v2: places.get(lookups.get(key)!) }));
      return { data: q.end === "list" ? rows : (rows[0] ?? null), error: null };
    }
    if (q.table === "api_config") {
      return { data: { api_name: eqOf(q, "api_name"), enabled: true, block_mode: "none", cost_per_request: "0" }, error: null };
    }
    return { data: null, error: null };
  });
  modelDone = -1;
  background.length = 0;

  const res = await POST(
    new NextRequest("http://localhost/api/ai/generate/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        destination: "Rome, Italy",
        startDate: "2026-11-01",
        endDate: `2026-11-${String(days).padStart(2, "0")}`,
        vibes: ["cultural"],
      }),
    })
  );
  const events = (await res.text()).split("\n\n").filter(Boolean);
  await Promise.all(background);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const complete = JSON.parse(events[events.length - 1].split("\ndata: ")[1]);
  return {
    eventTypes: events.map((event) => event.split("\n")[0].replace("event: ", "")),
    images: complete.itinerary.days.flatMap((day: { activities: Array<{ image_url: string }> }) =>
      day.activities.map((activity) => activity.image_url)
    ) as string[],
    afterModel: db.log.slice(modelDone).map((q) => (q.op === "rpc" ? `rpc ${q.table}` : `${q.op} ${q.table}`)),
  };
}

describe("the end of a streamed generation", () => {
  it("makes the same few round trips for a 3-day and a 14-day trip", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const short = await generate(3);
    const long = await generate(14);

    for (const [trip, days] of [[short, 3], [long, 14]] as const) {
      expect(trip.eventTypes).toEqual(["metadata", ...Array(days).fill("day"), "complete"]);
      // Every other sight is cached; the rest get curated fallbacks.
      expect(trip.images.filter((url) => url.startsWith("/api/places/photo"))).toHaveLength(Math.ceil((days * 5) / 2));
    }
    const expected = [
      "select places_v2_lookup",
      "insert api_request_logs", // the cache hits, one row each
      "rpc record_places_v2_hits",
      "insert api_request_logs", // the generation itself
    ];
    expect(short.afterModel.sort()).toEqual([...expected].sort());
    expect(long.afterModel.sort()).toEqual([...expected].sort());
  });
});
