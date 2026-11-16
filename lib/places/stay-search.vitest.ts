/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAY_RESULTS_MAX, searchStays, stayPlaces } from "./stay-search";

/**
 * "Where are you staying?" suggests hotels, streets and areas near the
 * destination from Photon. Only places someone could stay at or near come back,
 * named so two of the same name can be told apart.
 */

const feature = (properties: Record<string, unknown>, coordinates: [number, number] = [-9.1306, 38.7111]) => ({
  geometry: { coordinates },
  properties,
});

describe("stayPlaces", () => {
  it("names a hotel with its street and area, and places it", () => {
    expect(
      stayPlaces([
        feature({ name: "Memmo Alfama", street: "Travessa das Merceeiras", housenumber: "27", district: "Alfama", city: "Lisbon", osm_key: "tourism", osm_value: "hotel" }),
      ])
    ).toEqual([{ name: "Memmo Alfama", detail: "Travessa das Merceeiras 27, Alfama, Lisbon", lat: 38.7111, lng: -9.1306 }]);
  });

  it("names an address without a name by its street and number", () => {
    expect(stayPlaces([feature({ street: "Rua da Prata", housenumber: "80", city: "Lisbon", type: "house" })])).toEqual([
      { name: "Rua da Prata 80", detail: "Lisbon", lat: 38.7111, lng: -9.1306 },
    ]);
  });

  it("keeps an area, and doesn't repeat its own name in the detail", () => {
    expect(stayPlaces([feature({ name: "Alfama", district: "Alfama", city: "Lisbon", osm_key: "place", osm_value: "suburb", type: "district" })])).toEqual([
      { name: "Alfama", detail: "Lisbon", lat: 38.7111, lng: -9.1306 },
    ]);
  });

  it("leaves out countries, regions and whole cities, things with no name or street, and things with no place", () => {
    expect(
      stayPlaces([
        feature({ name: "Portugal", type: "country" }),
        feature({ name: "Lisbon", osm_key: "place", osm_value: "city", type: "city" }),
        feature({ name: "Lisboa", type: "state" }),
        feature({ city: "Lisbon", type: "house" }),
        { properties: { name: "Nowhere Hotel" } },
      ])
    ).toEqual([]);
  });

  it("gives each place once, and at most a handful", () => {
    const same = feature({ name: "Memmo Alfama", district: "Alfama" });
    const many = Array.from({ length: 9 }, (_, i) => feature({ name: `Hotel ${i}` }, [-9.13 + i / 1000, 38.71]));
    expect(stayPlaces([same, same])).toHaveLength(1);
    expect(stayPlaces(many)).toHaveLength(STAY_RESULTS_MAX);
  });
});

describe("searchStays", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks Photon near the destination, held to a box around it, in a language it speaks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [feature({ name: "Memmo Alfama" })] }) });
    vi.stubGlobal("fetch", fetchMock);
    const places = await searchStays("memmo", { lat: 38.7223, lng: -9.1393 }, "it");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/api/");
    expect(url.searchParams.get("q")).toBe("memmo");
    expect(url.searchParams.get("lat")).toBe("38.7223");
    expect(url.searchParams.get("lon")).toBe("-9.1393");
    expect(url.searchParams.get("bbox")).toBe("-9.5393,38.3223,-8.7393,39.1223");
    expect(url.searchParams.get("lang")).toBe("default");
    expect(places.map((p) => p.name)).toEqual(["Memmo Alfama"]);
  });

  it("answers nothing when Photon refuses or can't be reached: the field still takes typed words", async () => {
    // A refusal is never read as places, whatever its body holds.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ features: [feature({ name: "Memmo Alfama" })] }) }));
    expect(await searchStays("memmo", { lat: 38.7, lng: -9.1 })).toEqual([]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await searchStays("memmo", { lat: 38.7, lng: -9.1 })).toEqual([]);
  });
});
