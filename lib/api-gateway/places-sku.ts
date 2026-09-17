/**
 * Google Places API (New): which SKU a request buys, and its list price.
 *
 * WHY (2026-09-17)
 * cost_usd in api_request_logs was a flat guess per api_name: every Place
 * Details call booked at $0.017, the activity Text Search at $0.005. Google
 * prices by the FIELDS in X-Goog-FieldMask, in four tiers, so the guesses had
 * the picture inverted: the photos-only Details call is the cheapest tier
 * ($5 per 1,000) while the activity Text Search, which asks for displayName,
 * location and formattedAddress, is Pro ($32 per 1,000). Over the 30 days to
 * 2026-09-17 that turns "photos $72, search $16" into "search ~$102, photos
 * ~$25" at list price. Optimising the wrong line is the expensive mistake.
 *
 * Tier membership below follows Google's published field lists for the
 * March 2025 structure (Essentials / Pro / Enterprise / Enterprise +
 * Atmosphere). An unknown field is treated as the top tier, so a new field
 * can only make the estimate conservative, never optimistic.
 *
 * Prices are Google's LIST prices in USD per 1,000 requests. Google also
 * grants a free monthly allowance per SKU tier (published as 10,000 Essentials,
 * 5,000 Pro, 1,000 Enterprise, 1,000 Enterprise + Atmosphere). A per-call log
 * cannot know where the month stands, so cost_usd stays list price; the bill
 * (Cloud console → Billing → Reports, filter Places API (New), group by SKU) is
 * the source of truth, and `verified` says which prices were checked against
 * it. Nothing here is a limit or a block; it only prices what was already spent.
 */

export type PlacesTier = "essentials" | "pro" | "enterprise" | "enterprise_atmosphere";
export type PlacesCallKind = "details" | "textSearch" | "autocomplete";
export type PlacesSku =
  | `details_${PlacesTier}`
  | `text_search_${PlacesTier}`
  | "autocomplete";

const TIER_ORDER: PlacesTier[] = ["essentials", "pro", "enterprise", "enterprise_atmosphere"];

export const PLACES_SKU_LIST_PRICE: Record<PlacesSku, { usdPer1000: number; verified: boolean; note?: string }> = {
  details_essentials: { usdPer1000: 5, verified: false },
  details_pro: { usdPer1000: 17, verified: false },
  details_enterprise: { usdPer1000: 20, verified: false },
  details_enterprise_atmosphere: { usdPer1000: 25, verified: false },
  text_search_essentials: {
    usdPer1000: 32,
    verified: false,
    note: "ID-only tier; Google lists it separately from Pro. Confirm on the bill before relying on it: if it is free, the activity lookup should become ID-only search + Details.",
  },
  text_search_pro: { usdPer1000: 32, verified: false },
  text_search_enterprise: { usdPer1000: 35, verified: false },
  text_search_enterprise_atmosphere: { usdPer1000: 40, verified: false },
  autocomplete: { usdPer1000: 2.83, verified: false },
};

/** Place Details field tiers. Text Search maps the Essentials set to Pro (no photos in an ID-only search). */
const DETAILS_ESSENTIALS = new Set([
  "id", "name", "photos", "addressComponents", "adrFormatAddress", "formattedAddress", "location",
  "plusCode", "postalAddress", "shortFormattedAddress", "types", "viewport", "attributions",
]);
const DETAILS_PRO = new Set([
  "accessibilityOptions", "businessStatus", "displayName", "googleMapsUri", "iconBackgroundColor",
  "iconMaskBaseUri", "primaryType", "primaryTypeDisplayName", "subDestinations", "utcOffsetMinutes",
  "googleMapsLinks", "containingPlaces", "pureServiceAreaBusiness", "addressDescriptor",
]);
const DETAILS_ENTERPRISE = new Set([
  "currentOpeningHours", "currentSecondaryOpeningHours", "internationalPhoneNumber", "nationalPhoneNumber",
  "priceLevel", "priceRange", "rating", "regularOpeningHours", "regularSecondaryOpeningHours",
  "userRatingCount", "websiteUri",
]);
/** Fields that only matter to a Text Search response, never priced above Essentials. */
const TEXT_SEARCH_ID_ONLY = new Set(["id", "name", "attributions", "nextPageToken", "contextualContents"]);

function fieldsOf(fieldMask: string): string[] {
  return fieldMask
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => f.replace(/^places\./, "").replace(/^suggestions\./, "").split(".")[0]);
}

function detailsTierOfField(field: string): PlacesTier {
  if (DETAILS_ESSENTIALS.has(field)) return "essentials";
  if (DETAILS_PRO.has(field)) return "pro";
  if (DETAILS_ENTERPRISE.has(field)) return "enterprise";
  return "enterprise_atmosphere";
}

function maxTier(tiers: PlacesTier[]): PlacesTier {
  return tiers.reduce<PlacesTier>((acc, t) => (TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(acc) ? t : acc), "essentials");
}

export function placesDetailsTier(fieldMask: string): PlacesTier {
  return maxTier(fieldsOf(fieldMask).map(detailsTierOfField));
}

export function placesTextSearchTier(fieldMask: string): PlacesTier {
  const fields = fieldsOf(fieldMask);
  if (fields.length > 0 && fields.every((f) => TEXT_SEARCH_ID_ONLY.has(f))) return "essentials";
  const tiers = fields.map((f) => {
    if (TEXT_SEARCH_ID_ONLY.has(f)) return "pro" as PlacesTier;
    const t = detailsTierOfField(f);
    return t === "essentials" ? "pro" : t;
  });
  return maxTier(["pro", ...tiers]);
}

export function placesSkuFor(kind: PlacesCallKind, fieldMask: string): PlacesSku {
  if (kind === "autocomplete") return "autocomplete";
  if (kind === "details") return `details_${placesDetailsTier(fieldMask)}`;
  return `text_search_${placesTextSearchTier(fieldMask)}`;
}

/** List price of one call, in USD, for the given kind and field mask. */
export function placesCostForCall(input: { kind: PlacesCallKind; fieldMask: string }): { sku: PlacesSku; usd: number } {
  const sku = placesSkuFor(input.kind, input.fieldMask);
  return { sku, usd: PLACES_SKU_LIST_PRICE[sku].usdPer1000 / 1000 };
}
