import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";

/** Reads the real messages, so a page's words are tested where they live. */
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const messages = JSON.parse(readFileSync(join(process.cwd(), "messages", locale, `${namespace}.json`), "utf8"));
    return (key: "meta.title" | "meta.description") => messages.meta[key.split(".")[1]];
  },
}));

const { landingMetadata } = await import("./landing-metadata");

const LOCALES = ["en", "es", "it", "pt"];
const PAGES = [
  "aiItineraryGenerator",
  "budgetTripPlanner",
  "familyTripPlanner",
  "freeTripPlanner",
  "groupTripPlanner",
  "multiCityTripPlanner",
  "soloTripPlanner",
  "weekendTripPlanner",
];
const messagesOf = (locale: string, namespace: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "messages", locale, `${namespace}.json`), "utf8"));

const generateMetadata = landingMetadata("budgetTripPlanner", "/budget-trip-planner", "MonkeyTravel — Budget Trip Planner");
const forLocale = (locale: string) => generateMetadata({ params: Promise.resolve({ locale }) });

describe("landingMetadata", () => {
  it("titles the page from its messages, outside the root template, in its locale", async () => {
    const m = await forLocale("es");
    const { meta } = messagesOf("es", "budgetTripPlanner");
    expect(m.title).toEqual({ absolute: meta.title });
    expect(m.description).toBe(meta.description);
    expect(meta.title).not.toBe(messagesOf("en", "budgetTripPlanner").meta.title);
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
    const { meta } = messagesOf("es", "budgetTripPlanner");
    expect(m.openGraph).toMatchObject({
      url: "https://monkeytravel.app/es/budget-trip-planner",
      title: meta.title,
      description: meta.description,
      images: [{ url: "https://monkeytravel.app/og-image.png", alt: "MonkeyTravel — Budget Trip Planner" }],
    });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: meta.title, description: meta.description });
  });
});

describe("the words Google shows", () => {
  it.each(PAGES.flatMap((page) => LOCALES.map((locale) => [locale, page])))("%s/%s has a title without the brand and a description", (locale, page) => {
    const { meta } = messagesOf(locale, page);
    expect(meta.title.length).toBeGreaterThan(10);
    // The brand costs 15 of about 60 rendered characters on these searches.
    expect(meta.title).not.toContain("MonkeyTravel");
    expect(meta.description.length).toBeGreaterThan(50);
  });
});
