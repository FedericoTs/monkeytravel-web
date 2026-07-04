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
  alternateName: string;
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
    alternateName: "Monkey Travel",
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
// ItemList Schema (ranked-list / listicle articles)
// ============================================================================

export interface ItemListEntry {
  name: string;
  url: string;
}

/**
 * Emit an `ItemList` for ranked-list articles ("17 Cheapest Countries in
 * Asia", "Where to Go in June"). Each ranked H2/H3 section becomes a
 * `ListItem`, giving Google a machine-readable summary of the ranking — the
 * structured signal AI Overviews and list rich-results use to identify and
 * cite a source. This is the single highest-leverage schema for our
 * highest-impression pages, which are all ranked lists losing the click to
 * the Overview.
 */
export function generateItemListSchema(
  items: ItemListEntry[],
  opts?: { name?: string; url?: string },
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    ...(opts?.name ? { name: opts.name } : {}),
    ...(opts?.url ? { url: opts.url } : {}),
    numberOfItems: items.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

// ============================================================================
// Trip/Travel Itinerary Schema
// ============================================================================

/**
 * Minimal shape of an itinerary activity the Trip schema needs. Structural
 * subset of the app's `Activity` type (types/index.ts) — kept local so this
 * SEO module doesn't take a dependency on the whole trip domain. Every
 * field is optional so we tolerate partial/legacy itinerary rows.
 */
export interface TripSchemaActivity {
  name?: string;
  description?: string;
  location?: string;
  address?: string;
  image_url?: string;
  coordinates?: { lat?: number; lng?: number } | null;
}

/** Minimal shape of an itinerary day the Trip schema needs. */
export interface TripSchemaDay {
  day_number?: number;
  title?: string;
  theme?: string;
  activities?: TripSchemaActivity[];
}

export interface TripSchemaInput {
  name: string;
  description?: string;
  url: string;
  startDate?: string;
  endDate?: string;
  destination?: string;
  image?: string;
  /**
   * When the trip was made public. Emitted as `datePublished` — a real
   * freshness signal for the indexable UGC trip page.
   */
  datePublished?: string;
  /** BCP-47 language tag (e.g. "en", "it") for `inLanguage`. */
  inLanguage?: string;
  /**
   * The trip's itinerary days. When provided, the schema's `itinerary`
   * becomes a real nested ItemList (per-day ItemList of TouristAttraction)
   * instead of the thin day-count-only summary — a far richer signal for
   * Google. Omit to keep the legacy lightweight shape.
   */
  days?: TripSchemaDay[];
}

/**
 * `generateTripSchema` returns a flexible record because the `itinerary`
 * field has two shapes (thin summary vs. full nested ItemList) depending
 * on whether `days` was supplied. Callers treat it as opaque JSON-LD.
 */
export type TripSchema = Record<string, unknown>;

export function generateTripSchema(trip: TripSchemaInput): TripSchema {
  const dayCount = trip.startDate && trip.endDate
    ? Math.ceil((new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : undefined;

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Trip",
    name: trip.name,
    description: trip.description || `Travel itinerary for ${trip.destination || "your destination"} created with MonkeyTravel AI`,
    url: trip.url,
    provider: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };

  if (trip.image) schema.image = trip.image;
  if (trip.datePublished) schema.datePublished = trip.datePublished;
  if (trip.inLanguage) schema.inLanguage = trip.inLanguage;

  // Rich itinerary: nested ItemList of per-day ItemLists whose members are
  // TouristAttraction nodes built from each activity. Only when `days` is
  // supplied AND at least one day has activities — otherwise fall back to
  // the thin day-count summary the legacy callers relied on.
  const daysWithActivities = (trip.days ?? []).filter(
    (d) => Array.isArray(d.activities) && d.activities.length > 0,
  );

  if (daysWithActivities.length > 0) {
    schema.itinerary = {
      "@type": "ItemList",
      numberOfItems: daysWithActivities.length,
      itemListElement: daysWithActivities.map((day, dayIndex) => {
        const activities = day.activities ?? [];
        return {
          "@type": "ItemList",
          position: dayIndex + 1,
          name: day.title || `Day ${day.day_number ?? dayIndex + 1}`,
          numberOfItems: activities.length,
          itemListElement: activities.map((activity, actIndex) => ({
            "@type": "ListItem",
            position: actIndex + 1,
            item: generateTouristAttractionSchema(activity),
          })),
        };
      }),
    };
  } else if (dayCount) {
    schema.itinerary = {
      "@type": "ItemList",
      numberOfItems: dayCount,
      description: `${dayCount}-day travel itinerary`,
    };
  }

  return schema;
}

// ============================================================================
// Tourist Attraction Schema (individual itinerary activity)
// ============================================================================

/**
 * Build a `TouristAttraction` node for a single itinerary activity. Used
 * as the leaf node inside the enriched Trip itinerary ItemList, and can be
 * emitted standalone. Every field is optional — tolerate partial rows.
 *
 * `@context` is intentionally omitted: these nodes are embedded inside a
 * parent schema that already declares the context. When emitted standalone
 * the caller can add it, but for our itinerary use they're always nested.
 */
export function generateTouristAttractionSchema(
  activity: TripSchemaActivity,
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@type": "TouristAttraction",
    name: activity.name || "Attraction",
  };

  if (activity.description) node.description = activity.description;
  if (activity.image_url) node.image = activity.image_url;

  // Prefer full street address; fall back to the location label.
  const address = activity.address || activity.location;
  if (address) node.address = address;

  const lat = activity.coordinates?.lat;
  const lng = activity.coordinates?.lng;
  if (typeof lat === "number" && typeof lng === "number") {
    node.geo = {
      "@type": "GeoCoordinates",
      latitude: lat,
      longitude: lng,
    };
  }

  return node;
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
// Blog Article Schema
// ============================================================================

export interface ArticleAuthorInput {
  /** Display name */
  name: string;
  /** Absolute URL to the author bio page (signals Person, not Organization) */
  url?: string;
  /** Job title (e.g. "Asia & Pacific Editor") */
  jobTitle?: string;
  /** Absolute image URL — square headshot ideally */
  image?: string;
}

export interface ArticleSchemaInput {
  title: string;
  description: string;
  url: string;
  image?: string;
  datePublished: string;
  dateModified: string;
  /**
   * Author can be a string (legacy — emits Organization) or an
   * ArticleAuthorInput (preferred — emits Person with bio URL).
   * Person authorship is a stronger E-E-A-T signal than Organization
   * authorship for editorial content.
   */
  author: string | ArticleAuthorInput;
  wordCount?: number;
  articleSection?: string;
  keywords?: string[];
  inLanguage?: string;
}

export function generateArticleSchema(input: ArticleSchemaInput) {
  const authorNode =
    typeof input.author === "string"
      ? {
          "@type": "Organization" as const,
          name: input.author,
          url: SITE_URL,
        }
      : {
          "@type": "Person" as const,
          name: input.author.name,
          ...(input.author.url && { url: input.author.url }),
          ...(input.author.jobTitle && { jobTitle: input.author.jobTitle }),
          ...(input.author.image && { image: input.author.image }),
        };

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title,
    description: input.description,
    url: input.url,
    image: input.image,
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    author: authorNode,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: LOGO_URL,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": input.url,
    },
  };

  if (input.wordCount) {
    schema.wordCount = input.wordCount;
    schema.timeRequired = `PT${Math.max(1, Math.ceil(input.wordCount / 200))}M`;
  }
  if (input.articleSection) schema.articleSection = input.articleSection;
  if (input.keywords?.length) schema.keywords = input.keywords;
  if (input.inLanguage) schema.inLanguage = input.inLanguage;
  if (input.image) schema.thumbnailUrl = input.image;

  return schema;
}

// ============================================================================
// Collection Page Schema (Blog Index)
// ============================================================================

export interface CollectionPageInput {
  name: string;
  description: string;
  url: string;
  posts: { url: string; name: string }[];
}

export function generateCollectionPageSchema(input: CollectionPageInput) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: input.name,
    description: input.description,
    url: input.url,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: LOGO_URL,
      },
    },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: input.posts.map((post, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: post.url,
        name: post.name,
      })),
    },
  };
}

// ============================================================================
// Person Schema (Author bio pages)
// ============================================================================

export interface PersonSchemaInput {
  name: string;
  url: string;
  /**
   * Optional. Author bio pages pass this (e.g. "Asia & Pacific Editor").
   * UGC creator-profile pages omit it — a community traveler has no job
   * title. Only emitted when present so both callers stay backward-compat.
   */
  jobTitle?: string;
  /** Optional short bio. Author pages set it; creator pages may omit. */
  description?: string;
  image?: string;
  sameAs?: string[];
  knowsAbout?: string[];
}

/**
 * Person JSON-LD node.
 *
 * Serves two callers:
 *   1. Author bio pages (`/about/authors/[slug]`) — pass `jobTitle` +
 *      `description` for a full editorial-authorship E-E-A-T signal.
 *   2. UGC creator profiles (`/creator/[username]`) — pass just
 *      `{ name, url, image?, description? }`. No `jobTitle`.
 *
 * `jobTitle` / `description` are only emitted when supplied, so dropping
 * them for the UGC caller produces a valid, leaner Person node.
 */
export function generatePersonSchema(input: PersonSchemaInput) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: input.name,
    url: input.url,
    worksFor: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
  if (input.jobTitle) schema.jobTitle = input.jobTitle;
  if (input.description) schema.description = input.description;
  if (input.image) schema.image = input.image;
  if (input.sameAs?.length) schema.sameAs = input.sameAs;
  if (input.knowsAbout?.length) schema.knowsAbout = input.knowsAbout;
  return schema;
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

/**
 * Build the props bag for a JSON-LD <script> tag.
 *
 * @param schema   Single schema or array of schemas to inline.
 * @param nonce    Optional CSP nonce — pass the value returned from
 *                 `getNonce()` (see `lib/security/nonce.ts`) so the script
 *                 satisfies the strict, nonce-based Content-Security-Policy
 *                 enforced in production. Omit in dev / when CSP is not
 *                 set; modern browsers treat a missing nonce attribute as
 *                 "no nonce required" when the CSP allows other sources.
 *
 * Note: while CSP's spec applies `script-src` to *all* `<script>` tags,
 * Chrome 90+ exempts `type="application/ld+json"`. Firefox / Safari still
 * block them under strict CSP — passing the nonce keeps the JSON-LD
 * payload (which Google Search relies on for rich results) renderable
 * everywhere.
 */
export function jsonLdScriptProps(
  schema: object | object[],
  nonce?: string,
) {
  return {
    type: "application/ld+json" as const,
    ...(nonce ? { nonce } : {}),
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(schema),
    },
  };
}
