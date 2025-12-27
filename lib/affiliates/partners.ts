/**
 * Travelpayouts Partner Configuration
 *
 * All authorized Travelpayouts partners with their deep link configuration.
 * Commission rates and promo_ids are from the Travelpayouts dashboard.
 */

// Our Travelpayouts marker ID
export const MARKER = process.env.NEXT_PUBLIC_TRAVELPAYOUTS_MARKER || "483997";

export type PartnerCategory =
  | "hotels"
  | "flights"
  | "activities"
  | "attractions"
  | "transport"
  | "esim"
  | "compensation"
  | "vacation_rentals"
  | "all";

export interface PartnerConfig {
  name: string;
  subdomain: string;
  promo_id: string;
  category: PartnerCategory;
  baseUrl: string;
  commission: string;
  regions?: string[];
  icon?: string;
}

/**
 * Authorized Travelpayouts Partners
 *
 * Only using the partners specified by the user:
 * Booking.com, Trip.com, Agoda, Expedia, Klook, Tiqets,
 * Omio, Yesim, CheapOair, AirHelp, VRBO, Saily
 */
export const PARTNERS = {
  // Hotels
  booking: {
    name: "Booking.com",
    subdomain: "c84",
    promo_id: "3650",
    category: "hotels" as const,
    baseUrl: "https://www.booking.com",
    commission: "4%",
    icon: "🏨",
  },
  agoda: {
    name: "Agoda",
    subdomain: "c104",
    promo_id: "2854",
    category: "hotels" as const,
    baseUrl: "https://www.agoda.com",
    commission: "6%",
    regions: ["asia", "global"],
    icon: "🏨",
  },
  vrbo: {
    name: "VRBO",
    subdomain: "c102",
    promo_id: "3738",
    category: "vacation_rentals" as const,
    baseUrl: "https://www.vrbo.com",
    commission: "4%",
    icon: "🏠",
  },

  // Flights
  tripcom: {
    name: "Trip.com",
    subdomain: "c125",
    promo_id: "3616",
    category: "flights" as const,
    baseUrl: "https://www.trip.com",
    commission: "3-5%",
    regions: ["asia", "global"],
    icon: "✈️",
  },
  cheapoair: {
    name: "CheapOair",
    subdomain: "c108",
    promo_id: "3008",
    category: "flights" as const,
    baseUrl: "https://www.cheapoair.com",
    commission: "Up to $25",
    regions: ["americas"],
    icon: "✈️",
  },
  expedia: {
    name: "Expedia",
    subdomain: "c103",
    promo_id: "3709",
    category: "all" as const,
    baseUrl: "https://www.expedia.com",
    commission: "6%",
    regions: ["americas", "global"],
    icon: "🌐",
  },

  // Activities & Attractions
  klook: {
    name: "Klook",
    subdomain: "c137",
    promo_id: "4110",
    category: "activities" as const,
    baseUrl: "https://www.klook.com",
    commission: "2-5%",
    regions: ["asia", "global"],
    icon: "🎟️",
  },
  tiqets: {
    name: "Tiqets",
    subdomain: "c89",
    promo_id: "2074",
    category: "attractions" as const,
    baseUrl: "https://www.tiqets.com",
    commission: "8%",
    regions: ["europe", "global"],
    icon: "🎫",
  },

  // Transport
  omio: {
    name: "Omio",
    subdomain: "c91",
    promo_id: "2078",
    category: "transport" as const,
    baseUrl: "https://www.omio.com",
    commission: "6%",
    regions: ["europe"],
    icon: "🚆",
  },

  // Travel Services
  yesim: {
    name: "Yesim",
    subdomain: "c152",
    promo_id: "4526",
    category: "esim" as const,
    baseUrl: "https://yesim.app",
    commission: "18%",
    icon: "📱",
  },
  saily: {
    name: "Saily",
    subdomain: "c167",
    promo_id: "4812",
    category: "esim" as const,
    baseUrl: "https://saily.com",
    commission: "20%",
    icon: "📶",
  },
  airhelp: {
    name: "AirHelp",
    subdomain: "c95",
    promo_id: "3195",
    category: "compensation" as const,
    baseUrl: "https://www.airhelp.com",
    commission: "15%+",
    icon: "⚖️",
  },
} as const;

export type PartnerKey = keyof typeof PARTNERS;

/**
 * Get partners by category
 */
export function getPartnersByCategory(
  category: PartnerCategory
): PartnerKey[] {
  return (Object.keys(PARTNERS) as PartnerKey[]).filter(
    (key) =>
      PARTNERS[key].category === category || PARTNERS[key].category === "all"
  );
}

/**
 * Get partners by region
 */
export function getPartnersByRegion(
  region: "asia" | "europe" | "americas" | "global"
): PartnerKey[] {
  return (Object.keys(PARTNERS) as PartnerKey[]).filter((key) => {
    const partner = PARTNERS[key];
    // Check if regions property exists on this partner
    if ("regions" in partner && partner.regions) {
      // Cast to readonly string array to make TypeScript happy with the includes check
      return (partner.regions as readonly string[]).includes(region);
    }
    // Partners without regions are considered global
    return true;
  });
}

/**
 * Get hotel partners (for accommodation booking)
 */
export function getHotelPartners(): PartnerKey[] {
  return ["booking", "agoda", "vrbo"];
}

/**
 * Get flight partners
 */
export function getFlightPartners(): PartnerKey[] {
  return ["tripcom", "cheapoair", "expedia"];
}

/**
 * Get activity partners
 */
export function getActivityPartners(): PartnerKey[] {
  return ["klook", "tiqets"];
}

/**
 * Get eSIM partners
 */
export function getEsimPartners(): PartnerKey[] {
  return ["yesim", "saily"];
}
