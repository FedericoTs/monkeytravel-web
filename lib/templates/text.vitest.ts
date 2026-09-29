import { describe, expect, it, vi } from "vitest";

// The routing module also builds next-intl's navigation helpers, which need Next's router.
vi.mock("@/lib/i18n/routing", () => ({ routing: { locales: ["en", "es", "it", "pt"], defaultLocale: "en" } }));

import { countryName, templateLocale, templateText, TRANSLATED_TEMPLATE_IDS } from "./text";

const english = { title: "Rome: Eternal City Unveiled", short: "Colosseum and more", full: "Walk through history." };

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
