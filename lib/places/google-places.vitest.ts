// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One Text Search for every caller (an activity's place_id, the places to eat):
 * the same request, the same log row, priced by the SKU its field mask buys.
 * Google bills a call it answered, not one it refused or never answered.
 */

const logApiCall = vi.fn(async (_row: unknown) => undefined);
vi.mock("@/lib/api-gateway", () => ({ logApiCall: (row: unknown) => logApiCall(row) }));

const { textSearch } = await import("./google-places");

const PAID_MASK = "places.displayName,places.businessStatus,places.location,places.types";
let fetchMock: ReturnType<typeof vi.fn>;
const answer = (status: number, body?: unknown) => fetchMock.mockResolvedValueOnce(new Response(body === undefined ? null : JSON.stringify(body), { status }));
const logged = () => logApiCall.mock.calls.map(([row]) => row as { endpoint: string; status: number; costUsd: number });

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  logApiCall.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a Text Search", () => {
  it("asks Google with the key and the field mask, and answers its places", async () => {
    answer(200, { places: [{ id: "p1" }, { id: "p2" }] });
    const places = await textSearch({ textQuery: "Museo del Prado, Madrid", maxResultCount: 5 }, PAID_MASK, "places:searchText (place to eat)");
    expect(places).toEqual([{ id: "p1" }, { id: "p2" }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-Goog-Api-Key": "test-key", "X-Goog-FieldMask": PAID_MASK });
    expect(JSON.parse(init.body as string)).toEqual({ textQuery: "Museo del Prado, Madrid", maxResultCount: 5 });
  });

  it("answers no places when Google found none", async () => {
    answer(200, {});
    expect(await textSearch({ textQuery: "nowhere" }, PAID_MASK, "x")).toEqual([]);
  });

  it("is logged at its SKU's price when Google answered", async () => {
    answer(200, { places: [] });
    await textSearch({ textQuery: "a" }, PAID_MASK, "places:searchText (place to eat)");
    expect(logged()).toEqual([expect.objectContaining({ endpoint: "places:searchText (place to eat)", status: 200 })]);
    expect(logged()[0].costUsd).toBeGreaterThan(0);
  });

  it("is free when it asks for place ids alone", async () => {
    answer(200, { places: [{ id: "p1" }] });
    await textSearch({ textQuery: "a" }, "places.id", "places:searchText (activity)");
    expect(logged()[0].costUsd).toBe(0);
  });

  it("answers nothing, and costs nothing, when Google refused or never answered", async () => {
    answer(403, { error: { message: "denied" } });
    expect(await textSearch({ textQuery: "a" }, PAID_MASK, "x")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await textSearch({ textQuery: "a" }, PAID_MASK, "x")).toBeNull();
    expect(logged().map((row) => [row.status, row.costUsd])).toEqual([[403, 0], [500, 0]]);
  });

  it("is not sent without a key", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "";
    expect(await textSearch({ textQuery: "a" }, PAID_MASK, "x")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logApiCall).not.toHaveBeenCalled();
  });
});
