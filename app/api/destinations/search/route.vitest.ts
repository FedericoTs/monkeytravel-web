// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The wizard's first field. The real route runs, with only Supabase and the open
 * geocoder faked: the curated list answers what the term contains, the way the real
 * query does, so a misspelling really finds nothing there.
 */

const PLACES = [
  { id: "1", name: "Paris", country: "France", city: "Paris", latitude: 48.8, longitude: 2.3, rating: 5 },
  { id: "2", name: "Kuala Lumpur", country: "Malaysia", city: "Kuala Lumpur", latitude: 3.1, longitude: 101.7, rating: 4 },
  { id: "3", name: "Bangkok", country: "Thailand", city: "Bangkok", latitude: 13.7, longitude: 100.5, rating: 5 },
  { id: "4", name: "Phuket", country: "Thailand", city: "Phuket", latitude: 7.9, longitude: 98.4, rating: 4 },
];

const s = vi.hoisted(() => ({
  geo: [] as Array<Record<string, unknown>>,
  term: "",
  listError: null as unknown,
  geocoder: [] as Array<Record<string, unknown>>,
  geocoderCalls: 0,
}));

const client = fakeSupabase((q: FakeQuery) => {
  if (q.table === "search_geo_cities") return { data: s.geo, error: null };
  if (q.table !== "destinations") return { data: null, error: null };
  if (q.limitTo === undefined) return { data: s.listError ? null : PLACES, error: s.listError };
  const term = s.term.toLowerCase();
  return { data: PLACES.filter((p) => p.name.toLowerCase().includes(term) || p.country.toLowerCase().includes(term)), error: null };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client.client }));

const { POST } = await import("./route");

const search = async (input: string) => {
  s.term = input;
  const res = await POST(
    new NextRequest("https://monkeytravel.app/api/destinations/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, limit: 8, locale: "en" }),
    })
  );
  const body = await res.json();
  return { status: res.status, found: (body.predictions as Array<{ mainText: string; secondaryText: string }>).map((p) => `${p.mainText}, ${p.secondaryText}`) };
};
const GEO_TAILANDIA = { id: 77, name: "Tailândia", country_code: "BR", latitude: -2.9, longitude: -48.9 };
const GEO_PARMA = { id: 78, name: "Parma", country_code: "IT", latitude: 44.8, longitude: 10.3 };

beforeEach(() => {
  s.geo = [];
  s.listError = null;
  s.geocoder = [];
  s.geocoderCalls = 0;
  client.log.length = 0;
  vi.stubGlobal("fetch", async () => {
    s.geocoderCalls++;
    return new Response(JSON.stringify({ features: s.geocoder }), { status: 200 });
  });
  for (const level of ["warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a misspelled destination", () => {
  it("finds the curated place, not a village the open geocoder has with a similar name", async () => {
    s.geocoder = [{ properties: { osm_id: 1, osm_type: "N", osm_key: "place", osm_value: "village", name: "Kuala Lumpur", country: "Indonesia", countrycode: "ID" }, geometry: { coordinates: [0, 0] } }];
    const { found } = await search("KUALUMPUR");
    expect(found).toEqual(["Kuala Lumpur, Malaysia"]);
    expect(s.geocoderCalls).toBe(0);
  });

  it("puts the curated place ahead of a name that only contains the letters", async () => {
    s.geo = [{ id: 5, name: "Kyparissia", country_code: "GR", latitude: 37, longitude: 21 }];
    expect((await search("Pariss")).found).toEqual(["Paris, France", "Kyparissia, Greece"]);
  });

  it("reads a misspelled country as its curated places, ahead of a small town that starts the same", async () => {
    s.geo = [GEO_TAILANDIA];
    expect((await search("Tailand")).found).toEqual(["Bangkok, Thailand", "Phuket, Thailand", "Tailândia, Brazil"]);
  });

  it("still finds what the open geocoder has when nothing is close", async () => {
    s.geocoder = [{ properties: { osm_id: 2, osm_type: "N", osm_key: "place", osm_value: "town", name: "Zzyzx", country: "United States", countrycode: "US" }, geometry: { coordinates: [0, 0] } }];
    expect((await search("Zzyzx")).found).toEqual(["Zzyzx, United States"]);
  });
});

describe("a name spelled right", () => {
  it("answers the curated place, and doesn't read the whole list", async () => {
    expect((await search("Bangkok")).found).toEqual(["Bangkok, Thailand"]);
    expect(client.log.filter((q) => q.table === "destinations" && q.limitTo === undefined)).toEqual([]);
  });

  it("doesn't read the whole list while the name is still being typed", async () => {
    expect((await search("Bangko")).found).toEqual(["Bangkok, Thailand"]);
    expect(client.log.filter((q) => q.table === "destinations" && q.limitTo === undefined)).toEqual([]);
  });

  it("answers a real place with the name typed, with no near match added", async () => {
    s.geo = [GEO_PARMA];
    expect((await search("Parma")).found).toEqual(["Parma, Italy"]);
    s.geo = [{ ...GEO_PARMA, name: "Pariss" }];
    expect((await search("Pariss")).found).toEqual(["Pariss, Italy"]);
  });
});

describe("when the list can't be read", () => {
  it("answers what the other searches found", async () => {
    s.listError = { code: "57014", message: "timeout" };
    s.geo = [GEO_TAILANDIA];
    const { status, found } = await search("Tailand");
    expect(status).toBe(200);
    expect(found).toEqual(["Tailândia, Brazil"]);
  });
});
