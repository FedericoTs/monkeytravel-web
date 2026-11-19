import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRouteOffer, routeOfferAsk } from "./route-offer";

const state = (over: Partial<Parameters<typeof routeOfferAsk>[0]> = {}) => ({
  enabled: true,
  multiCityMode: false,
  destination: "Thailand",
  destinationProblem: null,
  picked: false,
  startDate: "2027-01-10",
  endDate: "2027-01-23",
  ...over,
});

describe("routeOfferAsk", () => {
  it("asks for a place typed, not picked, with dates five to fourteen days apart", () => {
    expect(routeOfferAsk(state())).toEqual({ place: "Thailand", days: 14 });
    expect(routeOfferAsk(state({ destination: "  Sri   Lanka ", endDate: "2027-01-14" }))).toEqual({ place: "Sri Lanka", days: 5 });
  });

  it("asks nothing for a picked place, a route already, a refused destination or multi-city switched off", () => {
    expect(routeOfferAsk(state({ picked: true }))).toBeNull();
    expect(routeOfferAsk(state({ multiCityMode: true }))).toBeNull();
    expect(routeOfferAsk(state({ destinationProblem: "tooShort" }))).toBeNull();
    expect(routeOfferAsk(state({ enabled: false }))).toBeNull();
    expect(routeOfferAsk(state({ destination: "   " }))).toBeNull();
  });

  it("asks nothing without both dates, or for a trip too short to move or longer than one place's", () => {
    expect(routeOfferAsk(state({ endDate: "" }))).toBeNull();
    expect(routeOfferAsk(state({ startDate: "" }))).toBeNull();
    expect(routeOfferAsk(state({ endDate: "2027-01-13" }))).toBeNull();
    expect(routeOfferAsk(state({ endDate: "2027-01-24" }))).toBeNull();
  });
});

describe("fetchRouteOffer", () => {
  afterEach(() => vi.unstubAllGlobals());
  const ask = { place: "Japan", days: 10, startDate: "2027-04-01", locale: "en" };

  it("posts the ask and keeps the rows that are stops", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ route: [{ city: "Tokyo", nights: 5 }, { city: " ", nights: 2 }, { city: "Kyoto", nights: 3 }, { city: "Osaka", nights: 0 }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const route = await fetchRouteOffer(ask, new AbortController().signal);
    expect(route).toEqual([
      { city: "Tokyo", nights: 5 },
      { city: "Kyoto", nights: 3 },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/wizard/route-plan");
    expect(JSON.parse(String(init.body))).toEqual(ask);
  });

  it("offers nothing when the server refuses, answers no route or can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    expect(await fetchRouteOffer(ask, new AbortController().signal)).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ route: null }), { status: 200 })));
    expect(await fetchRouteOffer(ask, new AbortController().signal)).toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await fetchRouteOffer(ask, new AbortController().signal)).toEqual([]);
  });
});
