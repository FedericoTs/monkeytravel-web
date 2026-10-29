import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedItinerary } from "@/types";

/** The plan cache knows a destination however it is written, and never mixes up namesakes. */

type Row = { id: string; destination_country: string | null; hit_count: number; activities: unknown[]; trip_summary: unknown };
let rows: Row[] = [];
let countries: Array<string | null> = [];
const queries: Array<Array<[string, unknown]>> = [];
const upserts: Array<Record<string, unknown>> = [];

function table() {
  const filters: Array<[string, unknown]> = [];
  let columns = "";
  const query = {
    select(c: string) {
      columns = c;
      return query;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return query;
    },
    contains: () => query,
    gt: () => query,
    order: () => query,
    limit: () => query,
    then(resolve: (r: unknown) => unknown) {
      queries.push(filters);
      const data = columns === "*" ? rows : countries.map((c) => ({ destination_country: c }));
      return Promise.resolve({ data, error: null }).then(resolve);
    },
    upsert(payload: Record<string, unknown>) {
      upserts.push(payload);
      return Promise.resolve({ error: null });
    },
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  };
  return query;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: table, rpc: () => Promise.resolve({ error: null }) }),
}));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");

const { cacheItinerary, getCachedItinerary, usualCountry } = await import("./cache");

const plan = (name: string, country: string) =>
  ({
    destination: { name, country, description: "" },
    days: [{ day_number: 1, date: "2027-05-01", activities: [] }],
  }) as unknown as GeneratedItinerary;

const row = (id: string, country: string | null, hits = 0): Row => ({
  id,
  destination_country: country,
  hit_count: hits,
  activities: [{ day_number: 1, activities: [] }],
  trip_summary: { destination: { name: id, country: country ?? "" } },
});

beforeEach(() => {
  rows = [];
  countries = [];
  queries.length = 0;
  upserts.length = 0;
});

describe("the plan cache", () => {
  it("files a plan under its city and country, whichever way the request wrote it", async () => {
    await cacheItinerary(null, "Tokyo", ["cultural"], "balanced", "en", plan("Tokyo", "Japan"));
    await cacheItinerary(null, "Tokyo, Japan", ["cultural"], "balanced", "en", plan("Tokyo", "Japan"));
    const hash = crypto.createHash("md5").update("tokyo|JP").digest("hex");
    for (const written of upserts) {
      expect(written).toMatchObject({ destination_hash: hash, destination_city: "tokyo", destination_country: "JP" });
    }
    expect(upserts[1].destination_name).toBe("Tokyo, Japan");
  });

  it("answers a request that names the country with plans for that country only", async () => {
    rows = [row("Japan", "JP")];
    const cached = await getCachedItinerary(null, "Tokyo, Japan", ["cultural"], "balanced", "en", "classic", 1);
    expect(cached?.destination.name).toBe("Japan");
    expect(queries[0]).toEqual(
      expect.arrayContaining([
        ["destination_city", "tokyo"],
        ["destination_country", "JP"],
      ])
    );
  });

  it("answers a request without a country with the namesake most plans are for", async () => {
    rows = [row("United States", "US", 9), row("England", "GB", 1)];
    countries = ["GB", "GB", "GB", "US"];
    const cached = await getCachedItinerary(null, "Manchester", ["cultural"], "balanced", "en", "classic", 1);
    expect(cached?.destination.name).toBe("England");
  });

  it("finds nothing for a namesake it has no plan for", async () => {
    countries = ["GB"];
    expect(await getCachedItinerary(null, "Manchester", ["cultural"], "balanced", "en", "classic", 1)).toBeNull();
  });
});

describe("usualCountry", () => {
  it("is the country most plans are for", () => {
    expect(usualCountry(["JP", null, "JP"])).toBe("JP");
    expect(usualCountry([null, null, "JP"])).toBeNull();
    expect(usualCountry([])).toBeNull();
  });
});
