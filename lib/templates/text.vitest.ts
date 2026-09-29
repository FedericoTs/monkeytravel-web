import { describe, expect, it, vi } from "vitest";

// The routing module also builds next-intl's navigation helpers, which need Next's router.
vi.mock("@/lib/i18n/routing", () => ({ routing: { locales: ["en", "es", "it", "pt"], defaultLocale: "en" } }));

import {
  countryName,
  templateItinerary,
  templateLocale,
  templateMeta,
  templatePacking,
  templateText,
  TRANSLATED_TEMPLATE_IDS,
} from "./text";
import { TEMPLATE_ITINERARIES } from "./itineraries";
import type { ItineraryDay, TripMeta } from "@/types";

const english = { title: "Rome: Eternal City Unveiled", short: "Colosseum and more", full: "Walk through history." };
const PARIS = "c2a4acd9-c5be-4992-ae53-28aa599d2a02";

const day = (title: string, names: string[]): ItineraryDay => ({
  day_number: 1,
  date: "2026-10-01",
  title,
  activities: names.map((name) => ({
    name,
    description: `${name} description`,
    time_slot: "morning",
    start_time: "09:00",
    duration_minutes: 60,
    type: "activity",
  })),
});

describe("templateItinerary", () => {
  it("has every template translated in every locale, with the same number of days and activities as the English", () => {
    for (const id of TRANSLATED_TEMPLATE_IDS) {
      for (const locale of ["es", "it", "pt"] as const) {
        const translation = TEMPLATE_ITINERARIES[id]?.[locale];
        expect(translation, `${id} ${locale}`).toBeDefined();
        expect(translation!.days.length).toBeGreaterThan(0);
        for (const [d, translatedDay] of translation!.days.entries()) {
          expect(translatedDay.title.trim(), `${id} ${locale} day ${d + 1}`).not.toBe("");
          for (const [a, activity] of translatedDay.activities.entries()) {
            expect(activity.name.trim(), `${id} ${locale} day ${d + 1} activity ${a + 1}`).not.toBe("");
          }
        }
        expect(translation!.meta.highlights?.length, `${id} ${locale} highlights`).toBeGreaterThan(0);
        expect(translation!.meta.weather_note?.trim(), `${id} ${locale} weather`).not.toBe("");
      }
    }
  });

  it("overlays the meta texts, stamps the locale and keeps a list whose length changed", () => {
    const paris = TEMPLATE_ITINERARIES[PARIS]!.it!.meta;
    const english: TripMeta = {
      locale: "en",
      timezone: "Europe/Paris",
      highlights: paris.highlights!.map((_, i) => `Highlight ${i + 1}`),
      weather_note: "Warm days, cool evenings.",
      packing_suggestions: ["Only one"],
    };
    const localized = templateMeta(PARIS, "it", english);
    expect(localized.highlights).toEqual(paris.highlights);
    expect(localized.weather_note).toBe(paris.weather_note);
    expect(localized.packing_suggestions).toEqual(["Only one"]);
    expect(localized.locale).toBe("it");
    expect(localized.timezone).toBe("Europe/Paris");
    expect(templateMeta(PARIS, "en", english)).toBe(english);
    expect(templateMeta("not-a-template", "it", english)).toBe(english);
  });

  it("overlays the translated texts by position and keeps everything else", () => {
    const paris = TEMPLATE_ITINERARIES[PARIS]!.it!;
    const days = paris.days.map((d, i) => ({
      ...day(`Day ${i + 1}`, d.activities.map((_, a) => `Activity ${a + 1}`)),
      day_number: i + 1,
    }));
    const localized = templateItinerary(PARIS, "it", days);
    expect(localized[0].title).toBe(paris.days[0].title);
    expect(localized[0].activities[0].name).toBe(paris.days[0].activities[0].name);
    expect(localized[0].activities[0].start_time).toBe("09:00");
    expect(localized[0].day_number).toBe(1);
    expect(templateItinerary(PARIS, "en", days)).toBe(days);
  });

  it("leaves the English alone when the shape no longer matches or nothing is translated", () => {
    const days = [day("Only day", ["One"])];
    expect(templateItinerary(PARIS, "it", days)).toBe(days);
    expect(templateItinerary("not-a-template", "it", days)).toBe(days);
    expect(templatePacking(PARIS, "it", ["a", "b"])).toEqual(["a", "b"]);
    expect(templatePacking(PARIS, "it", TEMPLATE_ITINERARIES[PARIS]!.it!.packing.map((_, i) => `item ${i}`))).toBe(
      TEMPLATE_ITINERARIES[PARIS]!.it!.packing
    );
  });
});

describe("templateText", () => {
  it("returns the row's English for en and for a template without translations", () => {
    expect(templateText("e4d5f6a7-b8c9-7d8e-2f1a-0b9c8d7e6f5a", "en", english)).toBe(english);
    expect(templateText("not-a-template", "it", english)).toBe(english);
  });

  it("carries every field in every locale for every translated template", () => {
    expect(TRANSLATED_TEMPLATE_IDS.length).toBeGreaterThanOrEqual(7);
    for (const id of TRANSLATED_TEMPLATE_IDS) {
      for (const locale of ["es", "it", "pt"]) {
        const text = templateText(id, locale, english);
        expect(text, `${id} ${locale}`).not.toBe(english);
        for (const field of ["title", "short", "full"] as const) {
          expect(text[field].trim().length, `${id} ${locale} ${field}`).toBeGreaterThan(10);
        }
      }
    }
  });
});

describe("templateLocale", () => {
  it("accepts the supported locales and falls back to English", () => {
    expect(templateLocale("it")).toBe("it");
    expect(templateLocale("de")).toBe("en");
    expect(templateLocale(null)).toBe("en");
  });
});

describe("countryName", () => {
  it("names the country in the visitor's language and keeps the stored name without a code", () => {
    expect(countryName("IT", "it", "Italy")).toBe("Italia");
    expect(countryName("US", "es", "United States")).toBe("Estados Unidos");
    expect(countryName("", "it", "Italy")).toBe("Italy");
  });
});
