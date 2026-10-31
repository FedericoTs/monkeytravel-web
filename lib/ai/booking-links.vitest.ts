import { describe, it, expect } from "vitest";
import { bookingLinksFor, flightLink, hotelLinks } from "./booking-links";

const query = (url: string) => new URL(url).searchParams.get("q");

describe("bookingLinksFor", () => {
  const links = bookingLinksFor({ destination: "Lisbon, Portugal", startDate: "2026-11-07", endDate: "2026-11-12" });

  it("searches flights to the destination for the trip's dates, from wherever the traveller is", () => {
    expect(links.flights).toHaveLength(1);
    expect(links.flights[0].provider).toBe("Google Flights");
    expect(query(links.flights[0].url)).toBe("Flights to Lisbon, Portugal on 2026-11-07 through 2026-11-12");
    expect(links.flights.some((l) => /skyscanner|\/nyc\//i.test(l.url))).toBe(false);
  });

  it("searches stays from the first day to the last", () => {
    expect(links.hotels.map((l) => l.provider)).toEqual(["Booking.com", "Airbnb"]);
    for (const l of links.hotels) expect(l.url).toContain("checkin=2026-11-07&checkout=2026-11-12");
  });
});

describe("hotelLinks", () => {
  it("asks for one night at least, and names the city when given one", () => {
    const [booking, airbnb] = hotelLinks("Coimbra", "2026-11-13", "2026-11-13", "Coimbra");
    expect(booking.url).toContain("checkin=2026-11-13&checkout=2026-11-14");
    expect(airbnb.url).toContain("checkin=2026-11-13&checkout=2026-11-14");
    expect(booking.city).toBe("Coimbra");
    expect(hotelLinks("Rome", "2026-11-13", "2026-11-15")[0].city).toBeUndefined();
  });
});

describe("flightLink", () => {
  it("is one way without a return date", () => {
    expect(query(flightLink("Madrid", "2026-11-07").url)).toBe("One way flights to Madrid on 2026-11-07");
  });
});
