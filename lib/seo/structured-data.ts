/**
 * Structured Data (JSON-LD) Generators for SEO
 *
 * These utilities generate schema.org compliant JSON-LD markup
 * for rich snippets in Google Search results.
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data
 * @see https://schema.org
 */

const SITE_URL = "https://monkeytravel.app";
const SITE_NAME = "MonkeyTravel";
const LOGO_URL = `${SITE_URL}/icon-512.png`;

// ============================================================================
// Organization Schema
// ============================================================================

export interface OrganizationSchema {
  "@context": "https://schema.org";
  "@type": "Organization";
  name: string;
  url: string;
  logo: string;
  sameAs?: string[];
  contactPoint?: {
    "@type": "ContactPoint";
    contactType: string;
    email: string;
  };
}

export function generateOrganizationSchema(): OrganizationSchema {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: LOGO_URL,
    sameAs: [
      "https://twitter.com/monkeytravel",
      // Add more social profiles as they're created
    ],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "support@monkeytravel.app",
    },
  };
}

// ============================================================================
// WebSite Schema (with Sitelinks Search Box potential)
// ============================================================================

export interface WebSiteSchema {
  "@context": "https://schema.org";
  "@type": "WebSite";
  name: string;
  url: string;
  description: string;
  publisher: {
    "@type": "Organization";
    name: string;
    logo: {
      "@type": "ImageObject";
      url: string;
    };
  };
}

export function generateWebSiteSchema(): WebSiteSchema {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    description: "AI-powered travel planning app that creates personalized day-by-day itineraries in seconds",
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: LOGO_URL,
      },
    },
  };
}

// ============================================================================
// Software Application Schema (for App/Service)
// ============================================================================

export interface SoftwareApplicationSchema {
  "@context": "https://schema.org";
  "@type": "SoftwareApplication";
  name: string;
  applicationCategory: string;
  operatingSystem: string;
  description: string;
  url: string;
  offers: {
    "@type": "Offer";
    price: string;
    priceCurrency: string;
  };
  featureList: string[];
  screenshot?: string;
}

export function generateSoftwareApplicationSchema(): SoftwareApplicationSchema {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "TravelApplication",
    operatingSystem: "Web Browser, iOS (coming soon), Android (coming soon)",
    description: "AI-powered travel planning app that creates personalized day-by-day itineraries with restaurants, attractions, and activities in under 30 seconds",
    url: SITE_URL,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "AI-generated day-by-day itineraries",
      "3 budget options (Budget, Balanced, Premium)",
      "Real-time verified information from Google Places",
      "Export to PDF and calendar",
      "Share trips with friends",
      "Customize any activity",
    ],
    screenshot: `${SITE_URL}/og-image.png`,
  };
}

// ============================================================================
// FAQ Page Schema
// ============================================================================

export interface FAQItem {
  question: string;
  answer: string;
}

export interface FAQPageSchema {
  "@context": "https://schema.org";
  "@type": "FAQPage";
  mainEntity: Array<{
    "@type": "Question";
    name: string;
    acceptedAnswer: {
      "@type": "Answer";
      text: string;
    };
  }>;
}

export function generateFAQSchema(faqs: FAQItem[]): FAQPageSchema {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

// ============================================================================
// Trip/Travel Itinerary Schema
// ============================================================================

export interface TripSchemaInput {
  name: string;
  description?: string;
  url: string;
  startDate?: string;
  endDate?: string;
  destination?: string;
  image?: string;
}

export interface TripSchema {
  "@context": "https://schema.org";
  "@type": "Trip";
  name: string;
  description: string;
  url: string;
  itinerary?: {
    "@type": "ItemList";
    numberOfItems: number;
    description: string;
  };
  provider: {
    "@type": "Organization";
    name: string;
    url: string;
  };
}

export function generateTripSchema(trip: TripSchemaInput): TripSchema {
  const dayCount = trip.startDate && trip.endDate
    ? Math.ceil((new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Trip",
    name: trip.name,
    description: trip.description || `Travel itinerary for ${trip.destination || "your destination"} created with MonkeyTravel AI`,
    url: trip.url,
    ...(dayCount && {
      itinerary: {
        "@type": "ItemList",
        numberOfItems: dayCount,
        description: `${dayCount}-day travel itinerary`,
      },
    }),
    provider: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

// ============================================================================
// Breadcrumb Schema
// ============================================================================

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface BreadcrumbSchema {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }>;
}

export function generateBreadcrumbSchema(items: BreadcrumbItem[]): BreadcrumbSchema {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// ============================================================================
// Tourist Destination Schema
// ============================================================================

export interface TouristDestinationSchemaInput {
  name: string;
  description: string;
  url: string;
  latitude: number;
  longitude: number;
  countryName: string;
  image?: string;
}

export function generateTouristDestinationSchema(
  input: TouristDestinationSchemaInput
) {
  return {
    "@context": "https://schema.org",
    "@type": "TouristDestination",
    name: input.name,
    description: input.description,
    url: input.url,
    image: input.image,
    geo: {
      "@type": "GeoCoordinates",
      latitude: input.latitude,
      longitude: input.longitude,
    },
    containedInPlace: {
      "@type": "Country",
      name: input.countryName,
    },
    touristType: ["Leisure", "Cultural", "Adventure"],
    potentialAction: {
      "@type": "PlanAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: input.url,
        actionPlatform: ["http://schema.org/DesktopWebPlatform"],
      },
      agent: {
        "@type": "Organization",
        name: SITE_NAME,
        url: SITE_URL,
      },
    },
  };
}

// ============================================================================
// Combined Schema for Homepage
// ============================================================================

export function generateHomepageSchemas(faqs: FAQItem[]) {
  return [
    generateOrganizationSchema(),
    generateWebSiteSchema(),
    generateSoftwareApplicationSchema(),
    generateFAQSchema(faqs),
  ];
}

// ============================================================================
// JSON-LD Script Component Helper
// ============================================================================

export function jsonLdScriptProps(schema: object | object[]) {
  return {
    type: "application/ld+json" as const,
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(schema),
    },
  };
}
