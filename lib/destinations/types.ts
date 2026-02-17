/**
 * Destination types for SEO landing pages
 *
 * Content is stored inline (not in translation JSON) because it's
 * unique per-city, not reusable UI strings.
 */

export type Locale = "en" | "es" | "it";

export type LocalizedString = Record<Locale, string>;

export type BudgetLevel = 1 | 2 | 3;

export type Continent =
  | "europe"
  | "asia"
  | "americas"
  | "africa"
  | "oceania"
  | "middle-east";

export type ActivityType =
  | "breakfast"
  | "lunch"
  | "dinner"
  | "sightseeing"
  | "museum"
  | "walk"
  | "shopping"
  | "nightlife"
  | "transport"
  | "activity";

export interface DestinationHighlight {
  icon: string;
  title: LocalizedString;
  description: LocalizedString;
}

export interface SampleActivity {
  time: string;
  type: ActivityType;
  title: LocalizedString;
  description: LocalizedString;
}

export interface DestinationFAQ {
  question: LocalizedString;
  answer: LocalizedString;
}

export interface Destination {
  slug: string;
  name: LocalizedString;
  country: LocalizedString;
  countryCode: string;
  continent: Continent;
  coordinates: {
    lat: number;
    lng: number;
  };
  stats: {
    avgStayDays: number;
    bestMonths: number[];
    budgetLevel: BudgetLevel;
  };
  tags: string[];
  content: {
    tagline: LocalizedString;
    description: LocalizedString;
    highlights: DestinationHighlight[];
    sampleDay: {
      activities: SampleActivity[];
    };
    faqs: DestinationFAQ[];
    ctaText: LocalizedString;
  };
}
