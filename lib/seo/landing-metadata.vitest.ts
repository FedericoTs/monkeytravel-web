import { describe, it, expect } from "vitest";
import { landingMetadata } from "./landing-metadata";

const META = {
  en: { title: "Budget Trip Planner", description: "Plan affordable trips." },
  es: { title: "Planificador de Viajes Económicos", description: "Planifica viajes asequibles." },
};
const generateMetadata = landingMetadata(META, "/budget-trip-planner", "MonkeyTravel — Budget Trip Planner");
const forLocale = (locale: string) => generateMetadata({ params: Promise.resolve({ locale }) });

describe("landingMetadata", () => {
  it("titles the page outside the root template, in its locale", async () => {
    const m = await forLocale("es");
    expect(m.title).toEqual({ absolute: "Planificador de Viajes Económicos" });
    expect(m.description).toBe("Planifica viajes asequibles.");
  });

  it("canonicalises to the locale's URL and lists every locale, English unprefixed", async () => {
    const m = await forLocale("es");
    expect(m.alternates).toEqual({
      canonical: "https://monkeytravel.app/es/budget-trip-planner",
      languages: {
        en: "https://monkeytravel.app/budget-trip-planner",
        es: "https://monkeytravel.app/es/budget-trip-planner",
        it: "https://monkeytravel.app/it/budget-trip-planner",
        pt: "https://monkeytravel.app/pt/budget-trip-planner",
        "x-default": "https://monkeytravel.app/budget-trip-planner",
      },
    });
    expect((await forLocale("en")).alternates?.canonical).toBe("https://monkeytravel.app/budget-trip-planner");
  });

  it("shares the canonical URL, the title and the page's image alt", async () => {
    const m = await forLocale("es");
    expect(m.openGraph).toMatchObject({
      url: "https://monkeytravel.app/es/budget-trip-planner",
      title: "Planificador de Viajes Económicos",
      images: [{ url: "https://monkeytravel.app/og-image.png", alt: "MonkeyTravel — Budget Trip Planner" }],
    });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "Planificador de Viajes Económicos" });
  });

  it("falls back to the English copy for a locale without its own", async () => {
    const m = await forLocale("it");
    expect(m.title).toEqual({ absolute: "Budget Trip Planner" });
    expect(m.alternates?.canonical).toBe("https://monkeytravel.app/it/budget-trip-planner");
  });
});
