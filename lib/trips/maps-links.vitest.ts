import { describe, expect, it } from "vitest";
import { dayRouteMapsUrl, placeMapsUrl, placeSearchUrl } from "./maps-links";

const stop = (name: string, over: Record<string, unknown> = {}) => ({ name, address: `${name} Street`, location: "Lisbon", ...over });
const param = (url: string, name: string) => new URL(url).searchParams.get(name);

describe("placeMapsUrl", () => {
  it("finds a place by its name and address", () => {
    const url = placeMapsUrl({ name: "Café & Co", address: "1 Rua #2", location: "Lisbon" });
    expect(url.startsWith("https://www.google.com/maps/search/?api=1&query=")).toBe(true);
    expect(param(url, "query")).toBe("Café & Co 1 Rua #2");
  });

  it("falls back to the location, and names nothing it doesn't have", () => {
    expect(param(placeMapsUrl({ name: "Belém Tower", location: "Lisbon" }), "query")).toBe("Belém Tower Lisbon");
    expect(param(placeMapsUrl({ name: "Belém Tower" }), "query")).toBe("Belém Tower");
    expect(param(placeMapsUrl({ name: "Belém Tower", address: "", location: "Lisbon" }), "query")).toBe("Belém Tower Lisbon");
  });
});

describe("placeSearchUrl", () => {
  it("searches for the same words", () => {
    const url = placeSearchUrl({ name: "Café & Co", location: "Lisbon" });
    expect(url.startsWith("https://www.google.com/search?q=")).toBe(true);
    expect(param(url, "q")).toBe("Café & Co Lisbon");
  });
});

describe("dayRouteMapsUrl", () => {
  it("has no route with fewer than two stops", () => {
    expect(dayRouteMapsUrl([])).toBeNull();
    expect(dayRouteMapsUrl([stop("A")])).toBeNull();
  });

  it("goes from the first stop to the last, with nothing between for two", () => {
    const url = dayRouteMapsUrl([stop("A"), stop("B")])!;
    expect(url.startsWith("https://www.google.com/maps/dir/?api=1&")).toBe(true);
    expect(param(url, "origin")).toBe("A, A Street");
    expect(param(url, "destination")).toBe("B, B Street");
    expect(param(url, "waypoints")).toBeNull();
  });

  it("sends an address with a number alone, since a name Google doesn't know stops the whole route", () => {
    const url = dayRouteMapsUrl([
      stop("Check-in & Stroll", { address: "Rue des Francs-Bourgeois, 75003 Paris" }),
      stop("Sunset at the tower", { address: "5 Av. Anatole France, Paris" }),
      stop("Dinner", { address: "25 Rue Vavin, Paris" }),
    ])!;
    expect(param(url, "origin")).toBe("Rue des Francs-Bourgeois, 75003 Paris");
    expect(param(url, "waypoints")).toBe("5 Av. Anatole France, Paris");
    expect(param(url, "destination")).toBe("25 Rue Vavin, Paris");
  });

  it("names a stop whose address is vague or missing", () => {
    const url = dayRouteMapsUrl([
      stop("Lahore Fort", { address: "Fort Rd, Walled City, Lahore" }),
      stop("Belém Tower", { address: "" }),
      stop("Praça do Comércio", { address: undefined, location: undefined }),
    ])!;
    expect(param(url, "origin")).toBe("Lahore Fort, Fort Rd, Walled City, Lahore");
    expect(param(url, "waypoints")).toBe("Belém Tower, Lisbon");
    expect(param(url, "destination")).toBe("Praça do Comércio");
  });

  it("goes through the stops between, in order", () => {
    const url = dayRouteMapsUrl([stop("A"), stop("B"), stop("C"), stop("D")])!;
    expect(param(url, "origin")).toBe("A, A Street");
    expect(param(url, "waypoints")).toBe("B, B Street|C, C Street");
    expect(param(url, "destination")).toBe("D, D Street");
  });

  it("keeps characters from breaking the link", () => {
    const url = dayRouteMapsUrl([stop("A&B"), stop("C#D"), stop("E|F")])!;
    expect(param(url, "origin")).toBe("A&B, A&B Street");
    expect(param(url, "waypoints")).toBe("C#D, C#D Street");
    expect(param(url, "destination")).toBe("E|F, E|F Street");
  });

  it("skips what's only a way to get somewhere", () => {
    const url = dayRouteMapsUrl([
      stop("Train to Porto", { transport_mode: "train" }),
      stop("A"),
      stop("Taxi", { type: "transport" }),
      stop("B"),
    ])!;
    expect(param(url, "origin")).toBe("A, A Street");
    expect(param(url, "destination")).toBe("B, B Street");
    expect(param(url, "waypoints")).toBeNull();
    expect(dayRouteMapsUrl([stop("Train", { transport_mode: "train" }), stop("A")])).toBeNull();
  });

  it("carries at most nine stops between, and still ends the day at its last", () => {
    const names = Array.from({ length: 14 }, (_, i) => `S${i}`);
    const url = dayRouteMapsUrl(names.map((n) => stop(n)))!;
    const between = param(url, "waypoints")!.split("|");
    expect(between).toHaveLength(9);
    expect(between[0]).toBe("S1 Street");
    expect(between[8]).toBe("S9 Street");
    expect(param(url, "destination")).toBe("S13 Street");
  });

  it("leaves out stops between rather than make a link Google won't take", () => {
    const long = "Avenida da Liberdade ".repeat(12);
    const url = dayRouteMapsUrl(Array.from({ length: 8 }, (_, i) => stop(`S${i}`, { address: long })))!;
    expect(url.length).toBeLessThanOrEqual(2048);
    expect(param(url, "origin")).toContain("S0");
    expect(param(url, "destination")).toContain("S7");
    expect(param(url, "waypoints")).toContain("S1");
  });

  it("still links the two ends when nothing between fits", () => {
    const huge = "Avenida da Liberdade ".repeat(90);
    const url = dayRouteMapsUrl([stop("A", { address: "short" }), stop("B", { address: huge }), stop("C", { address: "short" })])!;
    expect(param(url, "origin")).toBe("A, short");
    expect(param(url, "destination")).toBe("C, short");
    expect(param(url, "waypoints")).toBeNull();
  });
});
