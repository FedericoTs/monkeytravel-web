/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { placesCostForCall, placesDetailsTier, placesTextSearchTier } from "./places-sku";

// The four live field masks in the codebase on 2026-09-17.
const ACTIVITY_SEARCH = "places.id,places.displayName,places.location,places.formattedAddress";
const PHOTOS_ONLY = "photos";
const GALLERY_SEARCH =
  "places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri,places.priceLevel,places.priceRange,places.currentOpeningHours";
const DESTINATION_SEARCH = "places.id,places.displayName,places.formattedAddress,places.location,places.photos";

describe("Places SKU by field mask", () => {
  it("prices the photos-only Place Details call as Essentials, not $0.017", () => {
    expect(placesDetailsTier(PHOTOS_ONLY)).toBe("essentials");
    expect(placesCostForCall({ kind: "details", fieldMask: PHOTOS_ONLY })).toEqual({ sku: "details_essentials", usd: 0.005 });
  });

  it("prices the activity Text Search as Pro, not $0.005", () => {
    expect(placesTextSearchTier(ACTIVITY_SEARCH)).toBe("pro");
    expect(placesCostForCall({ kind: "textSearch", fieldMask: ACTIVITY_SEARCH }).usd).toBe(0.032);
  });

  it("prices the gallery search (rating, hours, price, website) as Enterprise", () => {
    expect(placesCostForCall({ kind: "textSearch", fieldMask: GALLERY_SEARCH })).toEqual({ sku: "text_search_enterprise", usd: 0.035 });
  });

  it("keeps the destination cover search on Pro", () => {
    expect(placesCostForCall({ kind: "textSearch", fieldMask: DESTINATION_SEARCH }).sku).toBe("text_search_pro");
  });

  it("an ID-only Text Search is Essentials; Details with atmosphere fields is the top tier", () => {
    expect(placesTextSearchTier("places.id,places.name")).toBe("essentials");
    expect(placesDetailsTier("id,displayName,editorialSummary,currentOpeningHours")).toBe("enterprise_atmosphere");
    expect(placesDetailsTier("id,displayName,rating")).toBe("enterprise");
    expect(placesDetailsTier("id,displayName")).toBe("pro");
  });

  it("treats an unknown field as the most expensive tier, never a cheaper one", () => {
    expect(placesDetailsTier("photos,someFutureField")).toBe("enterprise_atmosphere");
  });

  it("ignores nested paths and the places. prefix", () => {
    expect(placesDetailsTier("photos.name,location.latitude")).toBe("essentials");
    expect(placesTextSearchTier("places.photos.name")).toBe("pro");
  });
});
