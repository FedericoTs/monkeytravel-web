import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/cache-admin", () => ({ cacheAdminDb: () => null }));
/** The cities table's answers, and each lookup asked of it. */
const cities = vi.hoisted(() => ({ points: {} as Record<string, { lat: number; lng: number }>, asked: [] as string[][] }));
vi.mock("./city-points", () => ({
  cityPointsFor: async (names: string[]) => {
    cities.asked.push(names);
    return names.map((n) => cities.points[n] ?? null);
  },
}));

import { placePointFor } from "./place-point";

/**
 * A place typed by its bare name: the curated destination of that name first,
 * as the destination search ranks it, then the cities table. The table's
 * biggest "Bali" is a town in India and its "Goa" a town in the Philippines,
 * so a plan for either got another country's sunrise and sunset.
 */

const BALI = { latitude: -8.34, longitude: 115.09 };
const INDIA_BALI = { lat: 22.65, lng: 88.34 };

/** A database holding these curated destinations, recording each name asked. */
function curated(rows: Record<string, { latitude: number; longitude: number }>, fail = false) {
  const asked: string[] = [];
  const db = {
    from: (table: string) => ({
      // Only the columns asked for come back, as from PostgREST.
      select: (columns: string) => ({
        ilike: (column: string, name: string) => ({
          limit: async () => {
            asked.push(`${table}.${column}=${name}`);
            if (fail) throw new Error("down");
            const hit = Object.entries(rows).find(([key]) => key.toLowerCase() === name.toLowerCase());
            const picked = hit && Object.fromEntries(Object.entries(hit[1]).filter(([key]) => columns.split(/,\s*/).includes(key)));
            return { data: picked ? [picked] : [], error: null };
          },
        }),
      }),
    }),
  };
  return { db: db as never, asked };
}

beforeEach(() => {
  cities.points = { Bali: INDIA_BALI, Prague: { lat: 50.0755, lng: 14.4378 } };
  cities.asked.length = 0;
});

describe("placePointFor", () => {
  it("takes the curated destination of that name before the cities table's namesake", async () => {
    const { db, asked } = curated({ Bali: BALI });
    expect(await placePointFor("Bali", db)).toEqual({ lat: -8.34, lng: 115.09 });
    expect(asked).toEqual(["destinations.name=Bali"]);
    expect(cities.asked).toEqual([]);
  });

  it("says the curated destination's country", async () => {
    const { db } = curated({ Bali: { ...BALI, country: "Indonesia" } as never });
    expect(await placePointFor("Bali", db)).toEqual({ lat: -8.34, lng: 115.09, country: "Indonesia" });
  });

  it("whatever case it is typed in, and with stray spaces", async () => {
    const { db, asked } = curated({ Bali: BALI });
    expect(await placePointFor("  bali ", db)).toEqual({ lat: -8.34, lng: 115.09 });
    expect(asked).toEqual(["destinations.name=bali"]);
  });

  it("asks the cities table for a name no curated destination has", async () => {
    const { db } = curated({ Bali: BALI });
    expect(await placePointFor("Prague", db)).toEqual({ lat: 50.0755, lng: 14.4378 });
    expect(cities.asked).toEqual([["Prague"]]);
  });

  it("asks the cities table when the curated destination has no location", async () => {
    const { db } = curated({ Bali: { latitude: null, longitude: null } as never });
    expect(await placePointFor("Bali", db)).toEqual(INDIA_BALI);
  });

  it("asks the cities table when the curated read fails, or there is no database", async () => {
    expect(await placePointFor("Bali", curated({ Bali: BALI }, true).db)).toEqual(INDIA_BALI);
    expect(await placePointFor("Prague", null)).toEqual({ lat: 50.0755, lng: 14.4378 });
  });

  it("never reads a name with a pattern character as a pattern", async () => {
    const { db, asked } = curated({ Bali: BALI });
    expect(await placePointFor("B_li", db)).toBeNull();
    expect(await placePointFor("Ba%", db)).toBeNull();
    expect(await placePointFor("Ba*", db)).toBeNull();
    expect(asked).toEqual([]);
    expect(cities.asked).toEqual([["B_li"], ["Ba%"], ["Ba*"]]);
  });

  it("nothing for a blank name", async () => {
    const { db, asked } = curated({ Bali: BALI });
    expect(await placePointFor("   ", db)).toBeNull();
    expect(asked).toEqual([]);
    expect(cities.asked).toEqual([]);
  });
});
