/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { getStaySearchUrl, isStayAffiliateActive } from "./stay-search";

/**
 * These links were dead in production for every surface that renders them.
 * The old builder emitted /pwa/wds/s, which 301s to /pwa/s and returns 404 —
 * and nothing in the app could tell, because an outbound link that 404s looks
 * identical to one that works until a human clicks it.
 *
 * So the shape of the URL is asserted here rather than trusted.
 */
describe("getStaySearchUrl", () => {
  const base = { destination: "Tokyo", startDate: "2026-09-26", endDate: "2026-09-30" };

  it("points at Booking.com's search endpoint, not the dead Hostelworld path", () => {
    const u = new URL(getStaySearchUrl(base));
    expect(u.hostname).toBe("www.booking.com");
    expect(u.pathname).toBe("/searchresults.html");
    // The exact string that was 404ing.
    expect(u.href).not.toContain("/pwa/");
  });

  it("passes the destination as a QUERY param, never a path segment", () => {
    // This is the whole reason for the vendor switch: a path segment lets an
    // unknown city resolve to a confident, wrong destination (bali -> Bahrain).
    const u = new URL(getStaySearchUrl(base));
    expect(u.searchParams.get("ss")).toBe("Tokyo");
    expect(u.pathname).not.toContain("Tokyo");
  });

  it("handles multi-word cities that broke the old builder", () => {
    // "Rio de Janeiro" 404'd on Hostelworld's path form.
    const u = new URL(getStaySearchUrl({ ...base, destination: "Rio de Janeiro" }));
    expect(u.searchParams.get("ss")).toBe("Rio de Janeiro");
  });

  it("sends the bare city when given 'City, Country'", () => {
    const u = new URL(getStaySearchUrl({ ...base, destination: "Barcelona, Spain" }));
    expect(u.searchParams.get("ss")).toBe("Barcelona");
  });

  it("carries the dates and guest count through", () => {
    const u = new URL(getStaySearchUrl({ ...base, guests: 3 }));
    expect(u.searchParams.get("checkin")).toBe("2026-09-26");
    expect(u.searchParams.get("checkout")).toBe("2026-09-30");
    expect(u.searchParams.get("group_adults")).toBe("3");
  });

  it("defaults to one guest — the solo-traveller assumption /backpacker makes", () => {
    expect(new URL(getStaySearchUrl(base)).searchParams.get("group_adults")).toBe("1");
  });

  it("filters to hostels only when asked, and not otherwise", () => {
    // /backpacker is hostel-branded; a hotel list there is the wrong product.
    expect(new URL(getStaySearchUrl({ ...base, hostelsOnly: true })).searchParams.get("nflt"))
      .toBe("ht_id=203");
    expect(new URL(getStaySearchUrl(base)).searchParams.get("nflt")).toBeNull();
  });

  it("encodes rather than concatenates, so a stray value cannot break the URL", () => {
    const u = new URL(getStaySearchUrl({ ...base, destination: "Saint-Jean-de-Luz & Biarritz" }));
    expect(u.searchParams.get("ss")).toBe("Saint-Jean-de-Luz & Biarritz");
    expect(u.hostname).toBe("www.booking.com");
  });
});

describe("isStayAffiliateActive", () => {
  it("reports false while no partner program is live", () => {
    // Travelpayouts returns 400 for this account and no AWIN id is set.
    // Callers gate rel="sponsored" and the disclosure on this, so a wrong
    // `true` would put a false commercial claim on every stay link.
    expect(isStayAffiliateActive()).toBe(false);
  });
});
