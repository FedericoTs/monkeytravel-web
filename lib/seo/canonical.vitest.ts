import { describe, it, expect } from "vitest";
import { buildAlternates, openGraphLocales } from "./canonical";

describe("buildAlternates", () => {
  it("canonicalises to the locale's URL, English unprefixed, with every locale and x-default", () => {
    expect(buildAlternates("/blog", { locale: "it" })).toEqual({
      canonical: "https://monkeytravel.app/it/blog",
      languages: {
        en: "https://monkeytravel.app/blog",
        es: "https://monkeytravel.app/es/blog",
        it: "https://monkeytravel.app/it/blog",
        pt: "https://monkeytravel.app/pt/blog",
        "x-default": "https://monkeytravel.app/blog",
      },
    });
  });

  it("builds the home page from an empty path", () => {
    expect(buildAlternates("", { locale: "en" }).canonical).toBe("https://monkeytravel.app");
    expect(buildAlternates("", { locale: "pt" }).canonical).toBe("https://monkeytravel.app/pt");
  });

  it("canonicalises an unknown locale to English", () => {
    expect(buildAlternates("/tools", { locale: "fr" }).canonical).toBe("https://monkeytravel.app/tools");
  });
});

describe("openGraphLocales", () => {
  it("names the page's own locale and lists the others as alternates", () => {
    expect(openGraphLocales("pt")).toEqual({ locale: "pt_BR", alternateLocale: ["en_US", "es_ES", "it_IT"] });
    expect(openGraphLocales("en")).toEqual({ locale: "en_US", alternateLocale: ["es_ES", "it_IT", "pt_BR"] });
  });

  it("treats a locale without a code as English", () => {
    expect(openGraphLocales("fr")).toEqual({ locale: "en_US", alternateLocale: ["es_ES", "it_IT", "pt_BR"] });
  });
});
