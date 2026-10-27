import { describe, expect, it } from "vitest";
import { ACTIVITY_TYPES, normalizeActivityType } from "./activity-type";

/**
 * Real types and names from generated trips. In two months a fifth of all
 * activities were typed with a vibe ("foodie", "cultural", "adventure") and
 * another sixth with a word off the list ("food_market", "restaurante").
 */

describe("normalizeActivityType", () => {
  it("keeps a type that is already on the list", () => {
    for (const type of ACTIVITY_TYPES) expect(normalizeActivityType(type, "Dinner at Locavore")).toBe(type);
    expect(normalizeActivityType(" Museum ", "x")).toBe("museum");
  });

  it.each([
    ["restaurante", "Lunch at Restaurante do Forte", "restaurant"],
    ["food_market", "Tsukiji Outer Market", "market"],
    ["transportation", "Train to Kyoto", "transport"],
    ["art_gallery", "Nairobi Gallery", "museum"],
    ["historic_site", "Old Walls", "landmark"],
    ["spiaggia", "Spiaggia dei Conigli", "beach"],
    ["day_trip", "Hakone", "tour"],
    ["wine_bar", "Enoteca Pinchiorri", "bar"],
  ])("maps the synonym %s to its own type", (type, name, expected) => {
    expect(normalizeActivityType(type, name)).toBe(expected);
  });

  it.each([
    ["foodie", "Christmas Dinner in Maple Shade", "restaurant"],
    ["foodie", "Borough Market", "market"],
    ["foodie", "Pranzo nel Parco di Ueno", "restaurant"],
    ["foodie", "Street food lunch at Pratunam", "food"],
    ["foodie", "Gelateria dei Gracchi", "cafe"],
    ["cultural", "Museo Nazionale di Tokyo", "museum"],
    ["cultural", "Pura Tirta Empul Temple", "landmark"],
    ["cultural", "Maasai Market Shopping", "market"],
    ["cultural", "Kok-Borou Game Demonstration or Felt Workshop", "activity"],
    ["adventure", "Dameisha Beach", "beach"],
    ["adventure", "Diamond Head State Monument Hike", "nature"],
    ["adventure", "Kitesurfing Lesson in Paje", "activity"],
    ["adventure", "ATV Adventure Tour near Luquillo", "tour"],
    ["urban", "Myeongdong Shopping Street", "shopping"],
    ["urban", "Live Jazz on Frenchmen Street", "nightlife"],
    ["romantic", "Sunset Drinks at Perky's Floating Bar", "bar"],
    ["romantic", "Flamenco Show and Dinner at Corral de la Morería", "restaurant"],
    ["romantic", "Cena romantica e tramonto al ristorante", "restaurant"],
    ["wellness", "Yoga Class at The Yoga Barn", "activity"],
    ["wellness", "Traditional Hammam and Massage", "spa"],
    ["sightseeing", "Royal Mile Walk & St Giles' Cathedral", "landmark"],
    ["nature_exploration", "Karura Forest Nature Walk", "nature"],
  ])("reads a vague %s from the name %j", (type, name, expected) => {
    expect(normalizeActivityType(type, name)).toBe(expected);
  });

  it.each([
    ["foodie", "Tamago Sando", "food"],
    ["cultural", "Doi Suthep", "attraction"],
    ["urban", "Shibuya Crossing", "attraction"],
    ["romantic", "Oia Sunset Viewpoint", "attraction"],
    ["adventure", "Vogel Cable Car for Panoramic Views", "activity"],
    ["wellness", "Takaosan Onsen Gokurakuyu", "spa"],
  ])("falls back to the closest type for %s when the name says nothing", (type, name, expected) => {
    expect(normalizeActivityType(type, name)).toBe(expected);
  });

  it("reads an unknown or missing type from the name, else calls it an activity", () => {
    expect(normalizeActivityType("leisure", "Breakfast at the hotel")).toBe("restaurant");
    expect(normalizeActivityType("experience", "Something special")).toBe("activity");
    expect(normalizeActivityType(undefined, "Lunch at Fava")).toBe("restaurant");
    expect(normalizeActivityType(null, undefined)).toBe("activity");
  });

  it("does not read a sight as food from a word inside another word", () => {
    expect(normalizeActivityType("cultural", "Great Wall at Mutianyu")).toBe("attraction");
    expect(normalizeActivityType("urban", "Barcelona Waterfront")).toBe("attraction");
    expect(normalizeActivityType("cultural", "Il Cenacolo Vinciano")).toBe("attraction");
  });
});
