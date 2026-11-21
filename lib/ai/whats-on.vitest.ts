import { describe, expect, it } from "vitest";
import { whatsOn } from "./whats-on";

/**
 * Told only the season, a December plan for Prague or Munich could leave out
 * the Christmas markets: the plan is told what is on, where and when.
 */

const PRAGUE = { lat: 50.0755, lng: 14.4378 };
const LISBON = { lat: 38.7223, lng: -9.1393 };
const HELSINKI = { lat: 60.1699, lng: 24.9384 };
const BANGKOK = { lat: 13.7563, lng: 100.5018 };
const NEW_YORK = { lat: 40.7128, lng: -74.006 };
const ISTANBUL = { lat: 41.0082, lng: 28.9784 };
const REYKJAVIK = { lat: 64.1466, lng: -21.9426 };
const SEOUL = { lat: 37.5665, lng: 126.978 };

const MARKETS = /Christmas markets are open/;
const AFTER = /Most Christmas markets close on 23 or 24 December/;

describe("whatsOn", () => {
  it("tells a December trip in Europe that the Christmas markets are open", () => {
    const lines = whatsOn(PRAGUE, "2026-12-08", "2026-12-12");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(MARKETS);
    expect(lines[0]).toContain("in the evening");
    expect(whatsOn(LISBON, "2026-12-01", "2026-12-03")[0]).toMatch(MARKETS);
    expect(whatsOn(HELSINKI, "2026-12-01", "2026-12-03")[0]).toMatch(MARKETS);
  });

  it("is on from 21 November to 23 December, whichever days of it the trip covers", () => {
    expect(whatsOn(PRAGUE, "2026-11-16", "2026-11-20")).toEqual([]);
    expect(whatsOn(PRAGUE, "2026-11-20", "2026-11-21")[0]).toMatch(MARKETS);
    expect(whatsOn(PRAGUE, "2026-12-23", "2026-12-23")).toHaveLength(1);
    expect(whatsOn(PRAGUE, "2026-11-01", "2026-12-31")).toHaveLength(2);
  });

  it("warns that most close at Christmas, from 24 December to 6 January", () => {
    expect(whatsOn(PRAGUE, "2026-12-24", "2026-12-26")).toEqual([expect.stringMatching(AFTER)]);
    expect(whatsOn(PRAGUE, "2027-01-02", "2027-01-05")).toEqual([expect.stringMatching(AFTER)]);
    expect(whatsOn(PRAGUE, "2027-01-06", "2027-01-06")).toEqual([expect.stringMatching(AFTER)]);
    expect(whatsOn(PRAGUE, "2027-01-07", "2027-01-10")).toEqual([]);
    const across = whatsOn(PRAGUE, "2026-12-20", "2026-12-28");
    expect(across).toHaveLength(2);
    expect(across[0]).toMatch(MARKETS);
    expect(across[1]).toMatch(AFTER);
  });

  it("holds in any year", () => {
    expect(whatsOn(PRAGUE, "2027-12-05", "2027-12-08")[0]).toMatch(MARKETS);
    expect(whatsOn(PRAGUE, "2028-01-03", "2028-01-04")).toEqual([expect.stringMatching(AFTER)]);
  });

  it("says nothing outside Europe, or at its edges where it isn't the custom", () => {
    expect(whatsOn(BANGKOK, "2026-12-08", "2026-12-12")).toEqual([]);
    expect(whatsOn(NEW_YORK, "2026-12-08", "2026-12-12")).toEqual([]);
    expect(whatsOn(ISTANBUL, "2026-12-08", "2026-12-12")).toEqual([]);
    expect(whatsOn(REYKJAVIK, "2026-12-08", "2026-12-12")).toEqual([]);
    expect(whatsOn({ lat: 55.7558, lng: 37.6173 }, "2026-12-08", "2026-12-12")).toEqual([]); // Moscow
  });

  it("tells Europe's southern edges from the coasts facing them", () => {
    const december = (p: { lat: number; lng: number }) => whatsOn(p, "2026-12-08", "2026-12-12").length;
    expect(december({ lat: 36.7213, lng: -4.4214 })).toBe(1); // Málaga
    expect(december({ lat: 38.1157, lng: 13.3615 })).toBe(1); // Palermo
    expect(december({ lat: 44.4268, lng: 26.1025 })).toBe(1); // Bucharest
    expect(december({ lat: 36.8065, lng: 10.1815 })).toBe(0); // Tunis
    expect(december({ lat: 36.7538, lng: 3.0588 })).toBe(0); // Algiers
    expect(december({ lat: 35.7595, lng: -5.834 })).toBe(0); // Tangier
    expect(december({ lat: 38.4237, lng: 27.1428 })).toBe(0); // Izmir
  });

  // Told only the season, a Seoul plan across the bloom could leave it out; plans for Japan and Washington DC in
  // the season already visit their blossom, so they get no line.
  it("tells a trip to Korea in cherry blossom season the averages and what to plan", () => {
    const seoul = whatsOn(SEOUL, "2027-03-30", "2027-04-12");
    expect(seoul).toHaveLength(1);
    expect(seoul[0]).toMatch(/^Cherry blossom season in Seoul: in an average year the trees first flower on 8 April and are in full bloom on 10 April/);
    expect(seoul[0]).toContain("don't promise blossom before the first flowers");
    // Jinhae, in Changwon, takes the south coast's line.
    expect(whatsOn({ lat: 35.1495, lng: 128.6894 }, "2027-03-28", "2027-03-31")).toEqual([expect.stringMatching(/Jinhae/)]);
    expect(whatsOn({ lat: 35.8562, lng: 129.2247 }, "2027-04-01", "2027-04-04")).toEqual([expect.stringMatching(/in Gyeongju/)]);
    expect(whatsOn({ lat: 35.6762, lng: 139.6503 }, "2027-03-28", "2027-04-02")).toEqual([]); // Tokyo
    expect(whatsOn({ lat: 38.9072, lng: -77.0369 }, "2027-03-25", "2027-03-28")).toEqual([]); // Washington DC
  });

  it("is on from two weeks before the first flowers to ten days after full bloom", () => {
    expect(whatsOn(SEOUL, "2027-03-20", "2027-03-24")).toEqual([]);
    expect(whatsOn(SEOUL, "2027-03-24", "2027-03-25")).toHaveLength(1);
    expect(whatsOn(SEOUL, "2027-04-20", "2027-04-22")).toHaveLength(1);
    expect(whatsOn(SEOUL, "2027-04-21", "2027-04-25")).toEqual([]);
  });

  it("names one year's dates only in that year", () => {
    expect(whatsOn(SEOUL, "2028-04-05", "2028-04-08")).toEqual([]);
  });

  it("holds the blossom to its own city", () => {
    expect(whatsOn({ lat: 35.1796, lng: 129.0756 }, "2027-03-28", "2027-03-31")).toEqual([expect.stringMatching(/Busan/)]);
    expect(whatsOn({ lat: 38.7223, lng: -9.1393 }, "2027-03-28", "2027-04-02")).toEqual([]);
    expect(whatsOn({ lat: 13.7563, lng: 100.5018 }, "2027-03-28", "2027-04-02")).toEqual([]);
  });

  it("says nothing when the place or the dates aren't known", () => {
    expect(whatsOn(null, "2026-12-08", "2026-12-12")).toEqual([]);
    expect(whatsOn(PRAGUE, "8 December", "2026-12-12")).toEqual([]);
    expect(whatsOn(PRAGUE, "2026-12-12", "2026-12-08")).toEqual([]);
    expect(whatsOn(PRAGUE, undefined, undefined)).toEqual([]);
  });
});
