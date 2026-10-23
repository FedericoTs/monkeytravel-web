/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { ItineraryDay } from "@/types";
import { coverSizedPlacesSrc, pickCoverFromItinerary } from "./cover";

const photo = (id: string, t: string) => `/api/places/photo?name=places%2F${id}%2Fphotos%2Fp&w=600&h=400&t=${t}`;
const day = (...activities: Array<{ type: string; image_url?: string }>) =>
  ({ day_number: 1, activities: activities.map((a, i) => ({ id: `a${i}`, name: `A${i}`, ...a })) }) as unknown as ItineraryDay;
const params = (src: string | null) => new URLSearchParams((src ?? "").split("?")[1]);

describe("pickCoverFromItinerary", () => {
  it("takes the first sight with a real place photo, at cover size", () => {
    const cover = pickCoverFromItinerary([
      day({ type: "restaurant", image_url: photo("lunch", "foodie") }, { type: "attraction", image_url: photo("tower", "attraction") }),
      day({ type: "museum", image_url: photo("museum", "museum") }),
    ]);
    expect(cover?.startsWith("/api/places/photo?")).toBe(true);
    expect(params(cover).get("name")).toBe("places/tower/photos/p");
    expect(params(cover).get("w")).toBe("1920");
    expect(params(cover).get("h")).toBe("1200");
    expect(params(cover).get("t")).toBe("attraction");
  });

  it("falls back to another real photo, never transport or lodging", () => {
    const cover = pickCoverFromItinerary([
      day({ type: "transport", image_url: photo("station", "transport") }, { type: "accommodation", image_url: photo("hotel", "accommodation") }),
      day({ type: "restaurant", image_url: photo("dinner", "foodie") }),
    ]);
    expect(params(cover).get("name")).toBe("places/dinner/photos/p");
  });

  it("takes a stored Wikimedia photo too, at its larger copy, credit kept", () => {
    const wikimedia = "/api/images/wikimedia/0123456789abcdef0123-500.jpg?a=X&l=CC+BY-SA+4.0&f=Colosseo.jpg";
    expect(pickCoverFromItinerary([day({ type: "attraction", image_url: wikimedia })])).toBe(
      "/api/images/wikimedia/0123456789abcdef0123-960.jpg?a=X&l=CC+BY-SA+4.0&f=Colosseo.jpg",
    );
  });

  it("is null when the trip has only curated stand-ins or nothing usable", () => {
    expect(pickCoverFromItinerary([day({ type: "attraction", image_url: "https://images.pexels.com/photos/1/a.jpeg?w=600" })])).toBeNull();
    expect(pickCoverFromItinerary([day({ type: "transport", image_url: photo("airport", "transport") })])).toBeNull();
    expect(pickCoverFromItinerary([day({ type: "attraction" })])).toBeNull();
    expect(pickCoverFromItinerary(undefined)).toBeNull();
  });
});

describe("coverSizedPlacesSrc", () => {
  it("sets the cover size and keeps every other param", () => {
    const out = coverSizedPlacesSrc(`${photo("x", "nature")}&_r=1`);
    expect(out.startsWith("/api/places/photo?")).toBe(true);
    expect([params(out).get("w"), params(out).get("h"), params(out).get("t"), params(out).get("_r")]).toEqual(["1920", "1200", "nature", "1"]);
  });
});
