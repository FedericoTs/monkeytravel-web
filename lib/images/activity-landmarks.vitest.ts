// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * A place with a free Wikimedia photo takes it before Google: no search, no
 * photo list, no paid download, and none of the trip's paid budget. A plan
 * being generated never waits for a new lookup; a saved trip does.
 */

vi.hoisted(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
});

const KNOWN = new Map([["colosseum|rome italy", "/api/images/wikimedia/aaaaaaaaaaaaaaaaaaaa-500.jpg?a=X&l=CC+BY-SA+4.0&f=Colosseo.jpg"]]);
const landmarkPhotos = vi.fn<(lookups: { key: string }[], opts: { waitMs: number; maxNew: number }) => Promise<Map<string, string>>>(async (lookups) => {
  return new Map(lookups.flatMap((l) => (KNOWN.has(l.key) ? [[l.key, KNOWN.get(l.key)!] as const] : [])));
});
vi.mock("@/lib/images/landmark-photos", () => ({ landmarkPhotos: (...a: Parameters<typeof landmarkPhotos>) => landmarkPhotos(...a) }));

// The Colosseum is a place Google found before, under another name.
const answer = (q: FakeQuery) => {
  if (q.table === "places_v2_lookup" && q.op === "select") {
    const keys = (q.filters.find(([op]) => op === "in")?.[2] ?? []) as string[];
    const rows = keys
      .filter((k) => k === "colosseum|rome italy")
      .map((k) => ({
        normalized_key: k,
        place_id: "ChIJcol",
        places_v2: { place_id: "ChIJcol", display_name: "Colosseo", latitude: 41.8902, longitude: 12.4922, photo_resource_name: null, photo_url: null, updated_at: new Date().toISOString() },
      }));
    return { data: rows, error: null };
  }
  return { data: null, error: null };
};
const db = fakeSupabase(answer);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));
vi.mock("@/lib/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cache")>()),
  cache: { withDatabase: async () => ({ data: { imageUrl: null } }) },
}));

const google = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
  if (url.endsWith("places:searchText")) {
    return Response.json({ places: [{ id: "ChIJnew", displayName: { text: "Pantheon" }, location: { latitude: 41.8986, longitude: 12.4769 } }] });
  }
  return Response.json({ photos: [{ name: `places/ChIJnew/photos/${"p".repeat(250)}` }] });
});
vi.stubGlobal("fetch", google);

const { fetchActivityImages } = await import("./activity");

type Activity = { name: string; type: string; image_url?: string; coordinates?: { lat: number; lng: number } };
const plan = (): { activities: Activity[] }[] => [
  {
    activities: [
      { name: "Colosseum", type: "attraction" },
      { name: "Pantheon", type: "landmark", coordinates: { lat: 41.8986, lng: 12.4769 } },
      { name: "Train to Florence", type: "transport", coordinates: { lat: 41.9, lng: 12.5 } },
      { name: "Gelato stop", type: "food", coordinates: { lat: 0, lng: 0 } },
    ],
  },
];

beforeEach(() => {
  landmarkPhotos.mockClear();
  google.mockClear();
});

describe("fetchActivityImages with Wikimedia photos", () => {
  it("gives a place its free photo without asking Google, and leaves the paid budget to the others", async () => {
    const days = plan();
    await fetchActivityImages(days, "Rome, Italy", { maxPaidLookups: 1 });
    expect(days[0].activities[0].image_url).toBe(KNOWN.get("colosseum|rome italy"));
    expect(days[0].activities[1].image_url).toMatch(/^\/api\/places\/photo\?name=places%2FChIJnew/);
    const searched = google.mock.calls.filter(([url]) => url.endsWith("places:searchText")).map(([, init]) => JSON.parse(String(init?.body)).textQuery);
    expect(searched).toEqual(["Pantheon Rome, Italy"]);
  });

  it("asks with Google's name and coordinates for a known place, the activity's own otherwise, without a point for a missing one, and not for transport", async () => {
    await fetchActivityImages(plan(), "Rome, Italy", { maxPaidLookups: 1 });
    const [lookups] = landmarkPhotos.mock.calls[0];
    expect(lookups).toEqual([
      { key: "colosseum|rome italy", names: ["Colosseo", "Colosseum"], lat: 41.8902, lng: 12.4922 },
      { key: "pantheon|rome italy", names: ["Pantheon"], lat: 41.8986, lng: 12.4769 },
      { key: "gelato stop|rome italy", names: ["Gelato stop"] },
    ]);
  });

  it("waits for new lookups for a saved trip, never for a plan being generated", async () => {
    await fetchActivityImages(plan(), "Rome, Italy", { maxPaidLookups: 0 });
    await fetchActivityImages(plan(), "Rome, Italy", { maxPaidLookups: 8 });
    expect(landmarkPhotos.mock.calls.map(([, opts]) => opts.waitMs)).toEqual([0, 5000]);
  });

  it("gives a plan in the planner's preview free photos only: Wikimedia or stock, never Google's, cached ones included", async () => {
    const googlePhoto = "/api/places/photo?name=places%2FChIJcol%2Fphotos%2Fp&w=600&h=400&t=attraction";
    const days = [
      {
        activities: [
          { name: "Colosseum", type: "attraction", image_url: googlePhoto },
          { name: "Pantheon", type: "landmark", coordinates: { lat: 41.8986, lng: 12.4769 } },
          // A stock image from when the plan was cached gets its free photo now.
          { name: "Colosseum", type: "landmark", image_url: "https://images.pexels.com/photos/1/old.jpeg" },
        ],
      },
    ];
    const before = db.log.length;
    await fetchActivityImages(days, "Rome, Italy", { maxPaidLookups: 0, freePhotosOnly: true });
    expect(days[0].activities[0].image_url).toBe(KNOWN.get("colosseum|rome italy"));
    expect(days[0].activities[1].image_url).toMatch(/^https:\/\/images\.pexels\.com\//);
    expect(days[0].activities[2].image_url).toBe(KNOWN.get("colosseum|rome italy"));
    expect(google).not.toHaveBeenCalled();
    // Google's cached places lend names and coordinates, not counted as photo hits.
    expect(db.log.slice(before).filter((q) => q.table === "api_request_logs" || q.op === "rpc")).toEqual([]);
    expect(landmarkPhotos.mock.calls[0][0][0]).toMatchObject({ key: "colosseum|rome italy", names: ["Colosseo", "Colosseum"], lat: 41.8902 });
    expect(landmarkPhotos.mock.calls[0][1].waitMs).toBe(0);
  });

  it("keeps a Wikimedia photo already in the plan, also when a save upgrades stock images", async () => {
    for (const reresolveCurated of [false, true]) {
      const days = [{ activities: [{ name: "Colosseum", type: "attraction", image_url: KNOWN.get("colosseum|rome italy") }] }];
      await fetchActivityImages(days, "Rome, Italy", { maxPaidLookups: 8, reresolveCurated });
      expect(days[0].activities[0].image_url).toBe(KNOWN.get("colosseum|rome italy"));
    }
    expect(landmarkPhotos).not.toHaveBeenCalled();
    expect(google).not.toHaveBeenCalled();
  });
});
