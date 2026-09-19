/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { countryFromAddress, domesticTripVerdict, itineraryAddresses } from "./domestic-trip";

describe("countryFromAddress", () => {
  it("reads the country Google writes at the end", () => {
    expect(countryFromAddress("3 Kyoto Gyoen, Kamigyo Ward, Kyoto, 602-8651, Japan")).toBe("JP");
    expect(countryFromAddress("Lakeshore Ave #464, Toronto, ON M5J 2W2, Canada")).toBe("CA");
    expect(countryFromAddress("Praça do Comércio, 1100-148 Lisboa, Portugal")).toBe("PT");
    expect(countryFromAddress("Calle de Alcalá, 28014 Madrid, España")).toBe("ES");
  });

  it("reads a US state and zip when the country is implied", () => {
    // Stillwater, Minnesota — the reply that started this.
    expect(countryFromAddress("101 Water St S, Stillwater, MN 55082")).toBe("US");
    expect(countryFromAddress("Hood River, OR 97031")).toBe("US");
    expect(countryFromAddress("512 Main St, Chatham, MA 02633, USA")).toBe("US");
  });

  it("reads a Canadian province and postal code", () => {
    expect(countryFromAddress("Rue Principale, Nominingue, QC J0W 1R0")).toBe("CA");
  });

  it("copes with a postcode on either side of the country", () => {
    expect(countryFromAddress("Place du Casino, 98000 Monaco")).toBe("MC");
    expect(countryFromAddress("No. 1, Section 5, Xinyi Road, Xinyi District, Taipei City, Taiwan 110")).toBe("TW");
    expect(countryFromAddress("1 Fullerton Rd, Singapore 049213")).toBe("SG");
    expect(countryFromAddress("Andrássy út 22, Budapest, 1061 Hungary")).toBe("HU");
  });

  it("drops the notes the model appends", () => {
    expect(countryFromAddress("Shibuya, Tokyo, Japan (Shibuya crossing)")).toBe("JP");
    expect(countryFromAddress("Dotonbori, Osaka, Japan)")).toBe("JP");
    expect(countryFromAddress("Tortuguero, Costa Rica (example: Tortuga Lodge & Gardens)")).toBe("CR");
  });

  it("reads the localized spellings the wizard writes", () => {
    expect(countryFromAddress("Via del Corso, Roma, Italia")).toBe("IT");
    expect(countryFromAddress("Rue de Rivoli, Parigi, Francia")).toBe("FR");
    expect(countryFromAddress("Carrer de Mallorca, Barcelona, Spagna")).toBe("ES");
  });

  it("returns null when the address does not say", () => {
    expect(countryFromAddress("Various locations")).toBeNull();
    expect(countryFromAddress("your cabin's address")).toBeNull();
    expect(countryFromAddress("Himachal Pradesh 176219")).toBeNull();
    expect(countryFromAddress("350000")).toBeNull();
    expect(countryFromAddress("")).toBeNull();
    expect(countryFromAddress(null)).toBeNull();
  });
});

const itinerary = (addresses: (string | null)[]) => [
  { day: 1, activities: addresses.map((address, i) => ({ name: `a${i}`, address })) },
];

describe("domesticTripVerdict", () => {
  it("is domestic when every readable address is in the viewer's country", () => {
    const v = domesticTripVerdict("US", itinerary(["101 Water St S, Stillwater, MN 55082", "Lowell Park, Stillwater, MN 55082, USA", "Various locations"]));
    expect(v.domestic).toBe(true);
    expect(v.destinationCountries).toEqual(["US"]);
    expect(v.resolved).toBe(2);
    expect(v.addresses).toBe(3);
  });

  it("sends when the trip leaves the viewer's country", () => {
    expect(domesticTripVerdict("US", itinerary(["Lisboa, Portugal"])).domestic).toBe(false);
    // A multi-country trip that touches home is still international.
    expect(domesticTripVerdict("US", itinerary(["Buffalo, NY 14202", "Toronto, ON M5J 2W2, Canada"])).domestic).toBe(false);
  });

  it("fails open: unknown viewer or no readable address sends", () => {
    expect(domesticTripVerdict(null, itinerary(["Sedona, AZ 86336, USA"])).domestic).toBe(false);
    expect(domesticTripVerdict("US", itinerary(["Various locations", null])).domestic).toBe(false);
    expect(domesticTripVerdict("US", []).domestic).toBe(false);
    expect(domesticTripVerdict("US", null).domestic).toBe(false);
    expect(domesticTripVerdict("US", "not an itinerary").domestic).toBe(false);
  });

  it("compares case-insensitively and reports what it saw", () => {
    const v = domesticTripVerdict("ph", itinerary(["Session Rd, Baguio, 2600 Benguet, Philippines"]));
    expect(v.domestic).toBe(true);
    expect(v.viewerCountry).toBe("PH");
  });
});

describe("itineraryAddresses", () => {
  it("walks days and activities and skips anything malformed", () => {
    expect(itineraryAddresses([{ activities: [{ address: " A " }, { address: 3 }, null] }, null, { activities: "x" }])).toEqual([" A "]);
  });
});
