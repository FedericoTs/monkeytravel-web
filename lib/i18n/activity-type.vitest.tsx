import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import enTrips from "@/messages/en/trips.json";
import esTrips from "@/messages/es/trips.json";
import itTrips from "@/messages/it/trips.json";
import ptTrips from "@/messages/pt/trips.json";
import { ACTIVITY_TYPE_COLORS, DEFAULT_ACTIVITY_COLOR, getActivityTypeColors } from "@/lib/constants/activityColors";
import { ACTIVITY_TYPE_KEYS, activityTypeKey, useActivityTypeLabel } from "./activity-type";

/**
 * Activity types as the itinerary generator writes them into saved trips. Before
 * the normalizer, every one without a message key was shown raw ("food_market",
 * "cultural attraction", "attraction/shopping") in all four languages.
 */
const REAL: Array<[string, string]> = [
  ["restaurant", "restaurant"],
  ["attraction", "attraction"],
  ["foodie", "foodie"],
  ["nature", "nature"],
  ["cultural", "cultural"],
  ["museum", "museum"],
  ["transport", "transport"],
  ["shopping", "shopping"],
  ["activity", "activity"],
  ["adventure", "adventure"],
  ["urban", "urban"],
  ["food", "food"],
  ["market", "market"],
  ["sightseeing", "sightseeing"],
  ["accommodation", "accommodation"],
  ["food_market", "market"],
  ["food market", "market"],
  ["travel", "transport"],
  ["romantic", "romantic"],
  ["transportation", "transport"],
  ["cultural_site", "cultural"],
  ["cultural_attraction", "cultural"],
  ["cultural attraction", "cultural"],
  ["cultural_experience", "cultural"],
  ["historic_site", "landmark"],
  ["historical_site", "landmark"],
  ["attraction/shopping", "attraction"],
  ["restaurant/viewpoint", "restaurant"],
  ["foodie/urban", "foodie"],
  ["food_experience", "foodie"],
  ["foodie_experience", "foodie"],
  ["meal", "restaurant"],
  ["dining", "restaurant"],
  ["ristorante", "restaurant"],
  ["restaurante", "restaurant"],
  ["nature_attraction", "nature"],
  ["tour", "tour"],
  ["walking_tour", "tour"],
  ["day_trip", "tour"],
  ["hiking", "nature"],
  ["beach", "beach"],
  ["spiaggia", "beach"],
  ["lodging", "accommodation"],
  ["urban_exploration", "urban"],
  ["neighborhood_exploration", "urban"],
  ["shopping_district", "shopping"],
  ["theme_park", "entertainment"],
  ["art_gallery", "museum"],
  ["religious_site", "landmark"],
  ["adventure/nature", "adventure"],
  ["nature/adventure", "nature"],
  ["nature/cultural attraction", "nature"],
  ["shopping, malls, international food", "shopping"],
  ["restaurant & foodie", "restaurant"],
  ["restaurant (self-catered)", "restaurant"],
  ["food_and_drink", "food"],
  ["attività acquatica", "activity"],
  ["atracción cultural", "attraction"],
  ["gastronomía/cultural", "foodie"],
];

const UNKNOWN = ["experience", "leisure", "offbeat", "logistics", "iconic tourst", "constructor", "__proto__"];

describe("activityTypeKey", () => {
  it.each(REAL)("%s → %s", (raw, key) => {
    expect(activityTypeKey(raw)).toBe(key);
  });

  it("ignores case, spaces and hyphens", () => {
    expect(activityTypeKey("Restaurant")).toBe("restaurant");
    expect(activityTypeKey("  Cultural Attraction ")).toBe("cultural");
    expect(activityTypeKey("UNESCO_site")).toBe("landmark");
    expect(activityTypeKey("wine bar")).toBe("wineBar");
    expect(activityTypeKey("Wine-Bar")).toBe("wineBar");
    expect(activityTypeKey("wineBar")).toBe("wineBar");
  });

  it("takes the first part it recognises", () => {
    expect(activityTypeKey("leisure/shopping")).toBe("shopping");
    expect(activityTypeKey("experience/romantic")).toBe("romantic");
    expect(activityTypeKey("relaxation, nature")).toBe("nature");
    expect(activityTypeKey("offbeat | nightlife")).toBe("nightlife");
  });

  it("returns null when nothing is recognisable", () => {
    for (const raw of [...UNKNOWN, "", "   ", undefined, null]) expect(activityTypeKey(raw)).toBeNull();
  });
});

const TRIPS = { en: enTrips, es: esTrips, it: itTrips, pt: ptTrips } as const;
type Locale = keyof typeof TRIPS;
const LOCALES = Object.keys(TRIPS) as Locale[];

function labeler(locale: Locale) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={{ trips: TRIPS[locale] }}>
      {children}
    </NextIntlClientProvider>
  );
  return renderHook(() => useActivityTypeLabel(), { wrapper }).result.current;
}

describe("useActivityTypeLabel", () => {
  it.each(LOCALES)("%s labels exactly the keys the normalizer returns", (locale) => {
    expect(Object.keys(TRIPS[locale].activityTypes).sort()).toEqual([...ACTIVITY_TYPE_KEYS].sort());
  });

  it.each(LOCALES)("%s shows a label from its own messages for every type, never the raw word", (locale) => {
    const label = labeler(locale);
    const labels = Object.values(TRIPS[locale].activityTypes);
    for (const [raw] of REAL) expect(labels).toContain(label(raw));
    for (const raw of UNKNOWN) expect(label(raw)).toBe(TRIPS[locale].activityTypes.activity);
  });

  it("reads naturally in Italian", () => {
    const label = labeler("it");
    expect(label("food_market")).toBe("Mercato");
    expect(label("cultural attraction")).toBe("Culturale");
    expect(label("sightseeing")).toBe("Giro turistico");
    expect(label("experience")).toBe("Attività");
  });

  it("shows nothing for an activity without a type", () => {
    expect(labeler("es")(undefined)).toBe("");
  });
});

describe("getActivityTypeColors", () => {
  it("colours a type the way its label reads", () => {
    expect(getActivityTypeColors("food_market")).toBe(ACTIVITY_TYPE_COLORS.market);
    expect(getActivityTypeColors("Restaurant/Viewpoint")).toBe(ACTIVITY_TYPE_COLORS.restaurant);
    expect(getActivityTypeColors("wine bar")).toBe(ACTIVITY_TYPE_COLORS.wineBar);
    expect(getActivityTypeColors("experience")).toBe(DEFAULT_ACTIVITY_COLOR);
    expect(getActivityTypeColors(undefined)).toBe(DEFAULT_ACTIVITY_COLOR);
  });

  it("keys every colour by a type the normalizer can return", () => {
    for (const key of Object.keys(ACTIVITY_TYPE_COLORS)) expect(ACTIVITY_TYPE_KEYS).toContain(key);
  });
});
