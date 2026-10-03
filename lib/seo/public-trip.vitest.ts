/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  MIN_ACTIVITIES_FOR_INDEX,
  isTripIndexable,
  itineraryFingerprint,
  publicTripAlternates,
} from "./public-trip";

/**
 * es/it/pt trip pages repeat the itinerary in its own language under
 * translated navigation. Each public trip has one indexable URL, and the
 * sitemap lists that URL only.
 */

const day = (...names: string[]) => ({ activities: names.map((name) => ({ name })) });

describe("publicTripAlternates", () => {
  it("points an English trip at the unprefixed URL", () => {
    expect(publicTripAlternates("rome-trip-1a2b", { locale: "en" })).toEqual({
      canonical: "https://monkeytravel.app/trip/rome-trip-1a2b",
      languages: {
        en: "https://monkeytravel.app/trip/rome-trip-1a2b",
        "x-default": "https://monkeytravel.app/trip/rome-trip-1a2b",
      },
    });
  });

  it("points a trip written in Italian at the /it URL", () => {
    const { canonical, languages } = publicTripAlternates("roma-trip-9f8e", { locale: "it" });
    expect(canonical).toBe("https://monkeytravel.app/it/trip/roma-trip-9f8e");
    expect(Object.keys(languages)).toEqual(["it", "x-default"]);
  });

  it("treats a trip without a language stamp as English", () => {
    expect(publicTripAlternates("x", null).canonical).toBe("https://monkeytravel.app/trip/x");
    expect(publicTripAlternates("x", { locale: "fr" }).canonical).toBe("https://monkeytravel.app/trip/x");
  });
});

describe("isTripIndexable", () => {
  it("needs four activities", () => {
    expect(MIN_ACTIVITIES_FOR_INDEX).toBe(4);
    expect(isTripIndexable([day("A", "B"), day("C")])).toBe(false);
    expect(isTripIndexable([day("A", "B"), day("C", "D")])).toBe(true);
    expect(isTripIndexable([{ activities: null }, {}])).toBe(false);
  });
});

describe("itineraryFingerprint", () => {
  it("matches the same activities in the same order, ignoring case and spacing", () => {
    expect(itineraryFingerprint([day("Colosseum", "Forum"), day("Vatican")])).toBe(
      itineraryFingerprint([day(" colosseum", "Forum "), day("VATICAN")]),
    );
  });

  it("tells a different order or day split apart", () => {
    const base = itineraryFingerprint([day("Colosseum", "Forum"), day("Vatican")]);
    expect(itineraryFingerprint([day("Forum", "Colosseum"), day("Vatican")])).not.toBe(base);
    expect(itineraryFingerprint([day("Colosseum"), day("Forum", "Vatican")])).not.toBe(base);
  });
});
