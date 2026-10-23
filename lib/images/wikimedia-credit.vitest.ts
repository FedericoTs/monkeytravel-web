import { describe, expect, it } from "vitest";
import { cardSizedSrc } from "@/lib/img/proxyUrl";
import { atStoredWidth, commonsPage, readCredit, wikimediaCardSrc, wikimediaSheetSrc, wikimediaSrcSet, withCredit } from "./wikimedia-credit";

/**
 * A stored Wikimedia photo carries its credit in its URL, so every place that
 * shows it can credit it; cards and phones get its smaller stored copy.
 */

const credit = { author: "Basile Morin", license: "CC BY-SA 4.0", file: "Pedestrian road, Higashiyama-ku, Kyoto.jpg" };
const cover = withCredit("/api/images/wikimedia/0123456789abcdef0123-1920.jpg", credit);

describe("photo credits in the URL", () => {
  it("reads back what was attached", () => {
    expect(readCredit(cover)).toEqual(credit);
  });

  it("is null for any other photo", () => {
    expect(readCredit("/api/places/photo?name=places%2FX%2Fphotos%2FY&w=600&h=400")).toBeNull();
    expect(readCredit("https://images.pexels.com/photos/1/a.jpeg")).toBeNull();
    expect(readCredit(null)).toBeNull();
  });

  it("links the photo's Commons page", () => {
    expect(commonsPage(credit.file)).toBe(
      "https://commons.wikimedia.org/wiki/File:Pedestrian_road%2C_Higashiyama-ku%2C_Kyoto.jpg",
    );
  });
});

describe("stored sizes", () => {
  it("gives phones the 960px copy and cards the same", () => {
    expect(wikimediaSrcSet(cover)).toBe(`${atStoredWidth(cover, 960)} 960w, ${cover} 1920w`);
    expect(wikimediaCardSrc(cover)).toBe(atStoredWidth(cover, 960));
    expect(cardSizedSrc(cover)).toBe(atStoredWidth(cover, 960));
    expect(readCredit(atStoredWidth(cover, 960))).toEqual(credit);
  });

  it("shows an activity's card photo at its 960px copy in the activity sheet", () => {
    const card = withCredit("/api/images/wikimedia/0123456789abcdef0123-500.jpg", credit);
    expect(wikimediaSheetSrc(card)).toBe(atStoredWidth(card, 960));
    expect(wikimediaSheetSrc(cover)).toBe(cover);
    expect(wikimediaSheetSrc("/api/places/photo?name=x&w=600&h=400")).toBe("/api/places/photo?name=x&w=600&h=400");
    expect(wikimediaSheetSrc(undefined)).toBeUndefined();
  });

  it("leaves a gallery thumbnail and other URLs alone", () => {
    const thumb = withCredit("/api/images/wikimedia/0123456789abcdef0123-330.jpg", credit);
    expect(wikimediaCardSrc(thumb)).toBe(thumb);
    expect(wikimediaSrcSet(thumb)).toBeUndefined();
    expect(wikimediaSrcSet("/api/places/photo?name=x&w=1920&h=1200")).toBeUndefined();
  });
});
