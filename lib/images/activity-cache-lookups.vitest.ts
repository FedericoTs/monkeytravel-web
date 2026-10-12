// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";
import { placesCostForCall } from "@/lib/api-gateway/places-sku";

/**
 * The end of a generation waits on the activity-image cache. Its lookups ran
 * one per activity, all at once, and queued on the database's connection pool.
 * These tests pin the round trips per trip, and that what the cache decides
 * (images, cache writes, Google calls, log rows) does not move.
 */

vi.hoisted(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
});

let db: ReturnType<typeof fakeSupabase>;
// One client for every caller: api-control keeps the first client it gets.
const client = {
  from: (table: string) => db.client.from(table),
  rpc: (fn: string, args: unknown) => db.client.rpc(fn, args),
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));

const legacy: unknown[][] = [];
vi.mock("@/lib/cache", () => ({
  cache: {
    withDatabase: async (type: string, key: string, opts: { cacheDays: number; cacheType: string }) => {
      legacy.push([type, key, opts.cacheDays, opts.cacheType]);
      return { data: { imageUrl: null }, cached: true, source: "database" };
    },
  },
}));

import { curatedFor, fetchActivityImages } from "./activity";

const NOW = new Date("2026-10-12T12:00:00.000Z");
const DEST = "Rome, Italy";
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const photoName = (placeId: string, version = "a") => `places/${placeId}/photos/${version}${"x".repeat(250)}`;
const proxy = (name: string) => `/api/places/photo?name=${encodeURIComponent(name)}&w=600&h=400`;

function placeRow(placeId: string, displayName: string, opts: { updatedDaysAgo: number; photo?: boolean }) {
  const name = opts.photo === false ? null : photoName(placeId);
  return {
    place_id: placeId,
    display_name: displayName,
    formatted_address: `${displayName}, Rome`,
    latitude: 41.9,
    longitude: 12.5,
    photo_resource_name: name,
    photo_url: name ? proxy(name) : null,
    created_at: daysAgo(90),
    updated_at: daysAgo(opts.updatedDaysAgo),
    hit_count: 0,
    last_accessed_at: daysAgo(90),
  };
}

type PlaceRow = ReturnType<typeof placeRow>;
let places: Map<string, PlaceRow>;
let lookups: Map<string, string>;
let lookupError: { message: string } | null;
let rpcError: { code: string; message: string } | null;
/** What Text Search finds for a query; absent means no match. */
let searchable: Record<string, { id: string; name: string }>;

const keysOf = (q: FakeQuery) =>
  q.filters.flatMap(([op, column, value]) =>
    column !== "normalized_key" ? [] : op === "in" ? (value as string[]) : op === "eq" ? [value as string] : []
  );

function answer(q: FakeQuery): { data: unknown; error: unknown } {
  if (q.table === "places_v2_lookup" && q.op === "select") {
    if (lookupError) return { data: null, error: lookupError };
    const rows = keysOf(q)
      .filter((key) => lookups.has(key))
      .map((key) => ({ normalized_key: key, place_id: lookups.get(key), places_v2: places.get(lookups.get(key)!) ?? null }));
    return { data: q.end === "list" ? rows : (rows[0] ?? null), error: null };
  }
  if (q.table === "places_v2" && q.op === "select") {
    return { data: places.get(eqOf(q, "place_id") as string) ?? null, error: null };
  }
  if (q.table === "api_config") {
    const apiName = eqOf(q, "api_name");
    return {
      data: { api_name: apiName, display_name: apiName, enabled: true, block_mode: "none", category: "maps", cost_per_request: "0.017" },
      error: null,
    };
  }
  if (q.op === "rpc") return { data: null, error: rpcError };
  return { data: null, error: null };
}

const google = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === "https://places.googleapis.com/v1/places:searchText") {
    const found = searchable[JSON.parse(String(init?.body)).textQuery];
    const place = found && {
      id: found.id,
      displayName: { text: found.name },
      formattedAddress: `${found.name}, Rome`,
      location: { latitude: 41.9, longitude: 12.5 },
    };
    return Response.json({ places: place ? [place] : [] });
  }
  const placeId = /^https:\/\/places\.googleapis\.com\/v1\/places\/([^/?]+)$/.exec(url)?.[1];
  if (placeId) return Response.json({ photos: [{ name: photoName(placeId, "fresh") }] });
  return new Response("{}", { status: 404 });
});

type Day = { activities: Array<{ name: string; type: string; image_url?: string }> };
const day = (...activities: Array<[name: string, type: string]>): Day => ({
  activities: activities.map(([name, type]) => ({ name, type })),
});

/** One fetchActivityImages call and everything it caused. */
async function run(days: Day[], opts?: { maxPaidLookups?: number }) {
  await fetchActivityImages(days, DEST, opts);
  // The log and hit-count writes are fire-and-forget: let them land.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const sorted = <T,>(items: T[]) => items.map((item) => JSON.stringify(item)).sort();
  return {
    images: days.flatMap((d) => d.activities.map((a) => a.image_url)),
    cacheWrites: sorted(
      db.log.filter((q) => q.table.startsWith("places_v2") && q.op !== "select").map((q) => [q.table, q.op, q.value])
    ),
    google: sorted(
      google.mock.calls.map(([url, init]) => [
        init?.method,
        url,
        (init?.headers as Record<string, string> | undefined)?.["X-Goog-FieldMask"],
        init?.body ? JSON.parse(String(init.body)) : null,
      ])
    ),
    logRows: sorted(
      db.log.filter((q) => q.table === "api_request_logs").flatMap((q) => (Array.isArray(q.value) ? q.value : [q.value]))
    ),
    legacy: sorted(legacy),
    lookups: db.log.filter((q) => q.table === "places_v2_lookup" && q.op === "select"),
    hitCounts: db.log.filter((q) => q.op === "rpc").map((q) => [q.table, q.value]),
    roundTrips: {
      cacheLookups: db.log.filter((q) => q.table === "places_v2_lookup" && q.op === "select").length,
      configReads: db.log.filter((q) => q.table === "api_config").length,
      logInserts: db.log.filter((q) => q.table === "api_request_logs").length,
      hitCountWrites: db.log.filter((q) => q.op === "rpc" || (q.op === "update" && /hit_count/.test(JSON.stringify(q.value)))).length,
      total: db.log.length,
    },
  };
}

const ONE_OF_EACH = { cacheLookups: 1, configReads: 0, logInserts: 1, hitCountWrites: 1, total: 3 };

// The rows logApiCall writes for each kind of call, at the frozen clock.
const SEARCH_MASK = "places.id,places.displayName,places.location,places.formattedAddress";
const logRow = (apiName: string, endpoint: string, cacheHit: boolean, costUsd: number) => ({
  api_name: apiName,
  endpoint,
  response_status: 200,
  response_time_ms: 0,
  cache_hit: cacheHit,
  cost_usd: costUsd,
  error_message: null,
  user_id: null,
  request_params: null,
  timestamp: NOW.toISOString(),
});
const HIT = logRow("google_places_search", "places:searchText (activity, cache hit)", true, 0);
const SEARCH = logRow(
  "google_places_search",
  "places:searchText (activity)",
  false,
  placesCostForCall({ kind: "textSearch", fieldMask: SEARCH_MASK }).usd
);
const DETAILS = logRow(
  "google_places_details",
  "places/{id}:photos (activity)",
  false,
  placesCostForCall({ kind: "details", fieldMask: "photos" }).usd
);
const DEDUP = logRow("google_places_details", "places/{id}:photos (activity, place_id dedup)", true, 0);
const rows = (...items: object[]) => items.map((item) => JSON.stringify(item)).sort();

// Five cache hits (one fresh, three with stale photo refs, one without a
// photo) and three misses (a new place, a new spelling of a cached one, and
// one Google can't find). The Colosseum appears twice, with two types.
const trip = (): Day[] => [
  day(["Colosseum", "attraction"], ["Lunch at Roscioli", "restaurant"], ["Trevi Fountain", "landmark"], ["Spanish Steps", "landmark"]),
  day(["Colosseum", "cultural"], ["Hidden Bar", "bar"], ["Il Colosseo", "attraction"], ["Piazza Navona", "attraction"], ["Secret Garden", "park"]),
];
const HIT_KEYS = [
  "colosseum|rome italy",
  "hidden bar|rome italy",
  "piazza navona|rome italy",
  "spanish steps|rome italy",
  "trevi fountain|rome italy",
];
const cachedPhoto = (placeId: string, type: string) => `${places.get(placeId)!.photo_url}&t=${type}`;
const freshPhoto = (placeId: string, type: string) => `${proxy(photoName(placeId, "fresh"))}&t=${type}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.stubGlobal("fetch", google);
  vi.spyOn(console, "log").mockImplementation(() => {});
  db = fakeSupabase(answer);
  places = new Map(
    [
      placeRow("ChIJcolosseum", "Colosseo", { updatedDaysAgo: 3 }),
      placeRow("ChIJtrevi", "Fontana di Trevi", { updatedDaysAgo: 40 }),
      placeRow("ChIJsteps", "Spanish Steps", { updatedDaysAgo: 35 }),
      placeRow("ChIJnavona", "Piazza Navona", { updatedDaysAgo: 30 }),
      placeRow("ChIJbar", "Hidden Bar", { updatedDaysAgo: 3, photo: false }),
    ].map((row) => [row.place_id, row])
  );
  lookups = new Map([
    ["colosseum|rome italy", "ChIJcolosseum"],
    ["trevi fountain|rome italy", "ChIJtrevi"],
    ["spanish steps|rome italy", "ChIJsteps"],
    ["piazza navona|rome italy", "ChIJnavona"],
    ["hidden bar|rome italy", "ChIJbar"],
  ]);
  searchable = {
    "Lunch at Roscioli Rome, Italy": { id: "ChIJroscioli", name: "Roscioli" },
    "Il Colosseo Rome, Italy": { id: "ChIJcolosseum", name: "Colosseo" },
  };
  lookupError = null;
  rpcError = null;
  legacy.length = 0;
  google.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("generation (no paid lookups)", () => {
  it("picks the same images: cached photos for hits, curated fallbacks for the rest", async () => {
    const result = await run(trip(), { maxPaidLookups: 0 });
    expect(result.images).toEqual([
      cachedPhoto("ChIJcolosseum", "attraction"),
      curatedFor("Lunch at Roscioli", "restaurant"),
      // Stale refs are kept: a refresh is paid, and generation pays nothing.
      cachedPhoto("ChIJtrevi", "landmark"),
      cachedPhoto("ChIJsteps", "landmark"),
      cachedPhoto("ChIJcolosseum", "cultural"),
      curatedFor("Hidden Bar", "bar"),
      curatedFor("Il Colosseo", "attraction"),
      cachedPhoto("ChIJnavona", "attraction"),
      curatedFor("Secret Garden", "park"),
    ]);
    expect(result.google).toEqual([]);
    expect(result.cacheWrites).toEqual([]);
    expect(result.legacy).toEqual([]);
    expect(result.logRows).toEqual(rows(HIT, HIT, HIT, HIT, HIT));
  });

  it("makes one lookup, one log insert and one hit-count call for the whole trip", async () => {
    const result = await run(trip(), { maxPaidLookups: 0 });
    expect(result.roundTrips).toEqual(ONE_OF_EACH);
    expect(keysOf(result.lookups[0]).sort()).toEqual([
      "colosseum|rome italy",
      "hidden bar|rome italy",
      "il colosseo|rome italy",
      "lunch at roscioli|rome italy",
      "piazza navona|rome italy",
      "secret garden|rome italy",
      "spanish steps|rome italy",
      "trevi fountain|rome italy",
    ]);
  });

  it("does not add round trips as the trip grows", async () => {
    const tripOf = (count: number): Day[] => {
      const activities = Array.from({ length: count }, (_, i) => [`Sight ${i}`, "attraction"] as [string, string]);
      // Every other sight is cached, with a fresh photo.
      activities.forEach(([name], i) => {
        if (i % 2) return;
        places.set(`ChIJsight${i}`, placeRow(`ChIJsight${i}`, name, { updatedDaysAgo: 3 }));
        lookups.set(`sight ${i}|rome italy`, `ChIJsight${i}`);
      });
      return [day(...activities)];
    };
    const perTrip: object[] = [];
    const logRowCounts: number[] = [];
    for (const activities of [4, 16, 64]) {
      db = fakeSupabase(answer);
      const result = await run(tripOf(activities), { maxPaidLookups: 0 });
      perTrip.push({ activities, ...result.roundTrips });
      logRowCounts.push(result.logRows.length);
    }
    expect(perTrip).toEqual([4, 16, 64].map((activities) => ({ activities, ...ONE_OF_EACH })));
    // Every hit is still logged, one row each.
    expect(logRowCounts).toEqual([2, 8, 32]);
  });

  it("splits a very long trip's keys so no lookup URL grows past a few KB", async () => {
    const names = Array.from({ length: 150 }, (_, i) => `Evening walk along the old town walls and gardens, stop ${i}`);
    const result = await run([day(...names.map((name) => [name, "attraction"] as [string, string]))], { maxPaidLookups: 0 });
    expect(result.lookups.length).toBeGreaterThan(1);
    expect(result.lookups.length).toBeLessThanOrEqual(3);
    for (const lookup of result.lookups) {
      expect(encodeURIComponent(keysOf(lookup).join(",")).length).toBeLessThan(8000);
    }
    expect(result.lookups.flatMap(keysOf)).toHaveLength(150);
    expect(new Set(result.lookups.flatMap(keysOf)).size).toBe(150);
  });

  it("treats a failed lookup as all misses, as a failed single lookup was", async () => {
    lookupError = { message: "upstream timeout" };
    const result = await run(trip(), { maxPaidLookups: 0 });
    expect(result.images).toEqual([
      curatedFor("Colosseum", "attraction"),
      curatedFor("Lunch at Roscioli", "restaurant"),
      curatedFor("Trevi Fountain", "landmark"),
      curatedFor("Spanish Steps", "landmark"),
      // The group's fallback comes from its first occurrence.
      curatedFor("Colosseum", "attraction"),
      curatedFor("Hidden Bar", "bar"),
      curatedFor("Il Colosseo", "attraction"),
      curatedFor("Piazza Navona", "attraction"),
      curatedFor("Secret Garden", "park"),
    ]);
    expect(result.logRows).toEqual([]);
    expect(result.cacheWrites).toEqual([]);
    expect(result.hitCounts).toEqual([]);
  });

  it("makes no lookup when every activity already has a usable image", async () => {
    const kept = proxy(photoName("ChIJkept"));
    const result = await run([{ activities: [{ name: "Colosseum", type: "attraction", image_url: kept }] }], {
      maxPaidLookups: 0,
    });
    expect(result.images).toEqual([kept]);
    expect(result.roundTrips.total).toBe(0);
  });
});

describe("enrichment (paid lookups)", () => {
  it("makes the same Google calls, cache writes and log rows for misses and stale hits", async () => {
    const result = await run(trip(), { maxPaidLookups: 8 });
    expect(result.images).toEqual([
      cachedPhoto("ChIJcolosseum", "attraction"),
      // A miss: Text Search, Place Details, then both cache rows written.
      freshPhoto("ChIJroscioli", "restaurant"),
      // Stale refs refreshed, up to two per call, in itinerary order.
      freshPhoto("ChIJtrevi", "landmark"),
      freshPhoto("ChIJsteps", "landmark"),
      cachedPhoto("ChIJcolosseum", "cultural"),
      // A hit without a photo falls through to the legacy cache.
      curatedFor("Hidden Bar", "bar"),
      // A new spelling of a cached place: Text Search only.
      cachedPhoto("ChIJcolosseum", "attraction"),
      // Refresh budget spent: the stale ref is kept.
      cachedPhoto("ChIJnavona", "attraction"),
      curatedFor("Secret Garden", "park"),
    ]);

    const search = (textQuery: string) => [
      "POST",
      "https://places.googleapis.com/v1/places:searchText",
      SEARCH_MASK,
      { textQuery, maxResultCount: 1 },
    ];
    const details = (placeId: string) => ["GET", `https://places.googleapis.com/v1/places/${placeId}`, "photos", null];
    expect(result.google).toEqual(
      rows(
        search("Lunch at Roscioli Rome, Italy"),
        details("ChIJroscioli"),
        details("ChIJtrevi"),
        details("ChIJsteps"),
        search("Il Colosseo Rome, Italy"),
        search("Secret Garden Rome, Italy"),
        search("Secret Garden")
      )
    );

    expect(result.cacheWrites).toEqual(
      rows(
        [
          "places_v2",
          "upsert",
          {
            place_id: "ChIJroscioli",
            display_name: "Roscioli",
            formatted_address: "Roscioli, Rome",
            latitude: 41.9,
            longitude: 12.5,
            photo_resource_name: photoName("ChIJroscioli", "fresh"),
            photo_url: proxy(photoName("ChIJroscioli", "fresh")),
            updated_at: NOW.toISOString(),
          },
        ],
        ["places_v2_lookup", "upsert", { normalized_key: "lunch at roscioli|rome italy", place_id: "ChIJroscioli" }],
        ["places_v2_lookup", "upsert", { normalized_key: "il colosseo|rome italy", place_id: "ChIJcolosseum" }]
      )
    );

    expect(result.legacy).toEqual(
      rows(
        ["place_search", "activity_img:hidden bar|rome italy", 365, "activity_image"],
        ["place_search", "activity_img:secret garden|rome italy", 365, "activity_image"]
      )
    );

    expect(result.logRows).toEqual(
      rows(HIT, HIT, HIT, HIT, HIT, DETAILS, DETAILS, DETAILS, SEARCH, SEARCH, SEARCH, SEARCH, DEDUP)
    );
  });

  it("still looks the whole trip up in one request", async () => {
    const result = await run(trip(), { maxPaidLookups: 8 });
    // Paid calls still log a row each as they are made (8 inserts), and the
    // misses still read and write their own cache rows (5).
    expect(result.roundTrips).toEqual({ cacheLookups: 1, configReads: 0, logInserts: 9, hitCountWrites: 1, total: 16 });
  });
});

describe("hit counts", () => {
  it("are recorded in one call with the keys that hit", async () => {
    const result = await run(trip(), { maxPaidLookups: 0 });
    expect(result.hitCounts).toHaveLength(1);
    const [fn, args] = result.hitCounts[0] as [string, { p_keys: string[] }];
    expect(fn).toBe("record_places_v2_hits");
    expect([...args.p_keys].sort()).toEqual(HIT_KEYS);
  });

  it("go uncounted, quietly, until the function's migration is applied", async () => {
    rpcError = { code: "PGRST202", message: "Could not find the function public.record_places_v2_hits(p_keys)" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await run(trip(), { maxPaidLookups: 0 });
    expect(result.images[0]).toBe(cachedPhoto("ChIJcolosseum", "attraction"));
    expect(warn).not.toHaveBeenCalled();
  });

  it("warn on any other failure", async () => {
    rpcError = { code: "57014", message: "canceling statement due to statement timeout" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run(trip(), { maxPaidLookups: 0 });
    expect(warn).toHaveBeenCalledWith("[places_v2] hit counts not recorded:", rpcError.message);
  });
});

describe("kill switch", () => {
  it("makes no lookup at all when activity photos are off", async () => {
    vi.stubEnv("PLACES_ACTIVITY_PHOTOS_ENABLED", "false");
    vi.resetModules();
    const fresh = await import("./activity");
    const days = trip();
    await fresh.fetchActivityImages(days, DEST, { maxPaidLookups: 0 });
    expect(db.log).toEqual([]);
    expect(days[0].activities[0].image_url).toBe(curatedFor("Colosseum", "attraction"));
  });
});
