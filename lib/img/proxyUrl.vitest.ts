/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { cardSizedSrc, isApiImageSrc } from "./proxyUrl";

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
