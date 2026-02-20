import { notFound } from "next/navigation";
import { getRequestConfig } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";

// Supported locales
export const locales = ["en", "es", "it"] as const;
export type Locale = (typeof locales)[number];

// Default locale (no URL prefix)
export const defaultLocale: Locale = "en";

// Locale display names
export const localeNames: Record<Locale, string> = {
  en: "English",
  es: "Espanol",
  it: "Italiano",
};

// Locale flags for UI
export const localeFlags: Record<Locale, string> = {
  en: "🇺🇸",
  es: "🇪🇸",
  it: "🇮🇹",
};

export default getRequestConfig(async ({ requestLocale }) => {
  // Get locale from request (set by middleware)
  let locale = await requestLocale;

  // Validate locale, fallback to default if invalid
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  // Load all translation namespaces
  const [common, auth, trips, landing, profile, bananas, consent, destinations, blog, freeTripPlanner, groupTripPlanner, aiItineraryGenerator, weekendTripPlanner, familyTripPlanner, budgetTripPlanner, soloTripPlanner] = await Promise.all([
    import(`./messages/${locale}/common.json`),
    import(`./messages/${locale}/auth.json`),
    import(`./messages/${locale}/trips.json`),
    import(`./messages/${locale}/landing.json`),
    import(`./messages/${locale}/profile.json`),
    import(`./messages/${locale}/bananas.json`),
    import(`./messages/${locale}/consent.json`),
    import(`./messages/${locale}/destinations.json`),
    import(`./messages/${locale}/blog.json`),
    import(`./messages/${locale}/freeTripPlanner.json`),
    import(`./messages/${locale}/groupTripPlanner.json`),
    import(`./messages/${locale}/aiItineraryGenerator.json`),
    import(`./messages/${locale}/weekendTripPlanner.json`),
    import(`./messages/${locale}/familyTripPlanner.json`),
    import(`./messages/${locale}/budgetTripPlanner.json`),
    import(`./messages/${locale}/soloTripPlanner.json`),
  ]);

  return {
    locale,
    messages: {
      common: common.default,
      auth: auth.default,
      trips: trips.default,
      landing: landing.default,
      profile: profile.default,
      bananas: bananas.default,
      consent: consent.default,
      destinations: destinations.default,
      blog: blog.default,
      freeTripPlanner: freeTripPlanner.default,
      groupTripPlanner: groupTripPlanner.default,
      aiItineraryGenerator: aiItineraryGenerator.default,
      weekendTripPlanner: weekendTripPlanner.default,
      familyTripPlanner: familyTripPlanner.default,
      budgetTripPlanner: budgetTripPlanner.default,
      soloTripPlanner: soloTripPlanner.default,
    },
  };
});
