/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { cardSizedSrc, isApiImageSrc, placesPhotoSrcSet } from "./proxyUrl";

describe("isApiImageSrc", () => {
  it("is true for our /api/ image routes only", () => {
    expect(isApiImageSrc("/api/places/photo?name=places%2Fabc&w=600&h=400")).toBe(true);
    expect(isApiImageSrc("/api/img/proxy/https%3A%2F%2Fexample.com%2Fa.jpg")).toBe(true);
    expect(isApiImageSrc("/images/destinations/rome.jpg")).toBe(false);
    expect(isApiImageSrc(null)).toBe(false);
  });
});

describe("cardSizedSrc", () => {
  it("caps a cover-sized proxy src at card size", () => {
    const out = cardSizedSrc("/api/places/photo?name=places%2Fabc%2Fphotos%2Fxyz&w=1920&h=1200&t=attraction");
    const params = new URLSearchParams(out.split("?")[1]);
    expect(out.startsWith("/api/places/photo?")).toBe(true);
    expect(params.get("w")).toBe("800");
    expect(params.get("h")).toBe("500");
    expect(params.get("name")).toBe("places/abc/photos/xyz");
    expect(params.get("t")).toBe("attraction");
  });

  it("leaves small proxy srcs and other srcs unchanged", () => {
    const small = "/api/places/photo?name=places%2Fabc&w=600&h=400";
    expect(cardSizedSrc(small)).toBe(small);
    expect(cardSizedSrc("https://lh3.googleusercontent.com/p/abc")).toBe("https://lh3.googleusercontent.com/p/abc");
  });
});

describe("placesPhotoSrcSet", () => {
  const stored = "/api/places/photo?name=places%2Fabc%2Fphotos%2Fxyz&w=1920&h=1200&t=destination";
  const candidates = (set: string) =>
    set.split(", ").map((c) => {
      const [url, width] = c.split(" ");
      return { params: new URLSearchParams(url.split("?")[1]), width };
    });

  it("offers phone widths and the stored one, with the stored aspect ratio and params", () => {
    const set = candidates(placesPhotoSrcSet(stored)!);
    expect(set.map((c) => c.width)).toEqual(["828w", "1200w", "1920w"]);
    expect(set.map((c) => `${c.params.get("w")}x${c.params.get("h")}`)).toEqual(["828x518", "1200x750", "1920x1200"]);
    for (const c of set) {
      expect(c.params.get("name")).toBe("places/abc/photos/xyz");
      expect(c.params.get("t")).toBe("destination");
    }
  });

  it("carries a retry's cache-buster on every candidate", () => {
    for (const c of candidates(placesPhotoSrcSet(`${stored}&_r=1`)!)) expect(c.params.get("_r")).toBe("1");
  });

  it("is undefined for photos already phone-sized and for other srcs", () => {
    expect(placesPhotoSrcSet("/api/places/photo?name=places%2Fabc&w=600&h=400")).toBeUndefined();
    expect(placesPhotoSrcSet("/api/img/proxy/https%3A%2F%2Fimages.pexels.com%2Fa.jpg")).toBeUndefined();
    expect(placesPhotoSrcSet(null)).toBeUndefined();
  });
});
