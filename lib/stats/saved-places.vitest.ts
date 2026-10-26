import { describe, expect, it } from "vitest";
import { buildSavedPlaceIndex, placeKey, savedTripsFor, type SavedPlace } from "./saved-places";

describe("placeKey", () => {
  it("matches lower(unaccent(btrim(name)))", () => {
    expect(placeKey("Musée d'Orsay")).toBe("musee d'orsay");
    expect(placeKey("  Park Güell ")).toBe("park guell");
    expect(placeKey("Marché des Enfants Rouges")).toBe("marche des enfants rouges");
    expect(placeKey("Kinkaku-ji (Golden Pavilion)")).toBe("kinkaku-ji (golden pavilion)");
  });

  it("expands the letters unaccent spells out", () => {
    expect(placeKey("Straße")).toBe("strasse");
    expect(placeKey("Ærø")).toBe("aero");
    expect(placeKey("Łazienki")).toBe("lazienki");
  });

  it("trims spaces only, as btrim does", () => {
    expect(placeKey("\tLouvre")).toBe("\tlouvre");
  });
});

describe("savedTripsFor", () => {
  const places: SavedPlace[] = [
    ["pantheon", 41.899, 12.477, 14],
    ["pantheon", 48.846, 2.346, 6],
    ["eiffel tower", 48.858, 2.294, 17],
  ];
  const index = buildSavedPlaceIndex(places);

  it("finds the place by its name and where it is", () => {
    expect(savedTripsFor(index, "Panthéon", { lat: 48.8462, lng: 2.3464 })).toBe(6);
    expect(savedTripsFor(index, "Pantheon", { lat: 41.8986, lng: 12.4769 })).toBe(14);
    expect(savedTripsFor(index, "Eiffel Tower", { lat: 48.8584, lng: 2.2945 })).toBe(17);
  });

  it("does not lend a count to a namesake in another city", () => {
    expect(savedTripsFor(index, "Eiffel Tower", { lat: 36.1125, lng: -115.1724 })).toBeNull();
  });

  it("shows nothing without a name, coordinates or a counted place", () => {
    expect(savedTripsFor(index, undefined, { lat: 48.85, lng: 2.29 })).toBeNull();
    expect(savedTripsFor(index, "Eiffel Tower", undefined)).toBeNull();
    expect(savedTripsFor(index, "Eiffel Tower", { lat: Number.NaN, lng: 2.29 })).toBeNull();
    expect(savedTripsFor(index, "Louvre Museum", { lat: 48.86, lng: 2.33 })).toBeNull();
  });
});
