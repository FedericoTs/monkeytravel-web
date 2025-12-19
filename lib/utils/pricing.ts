/**
 * Pricing utilities for activity cost estimation
 *
 * Extracted from ActivityCard.tsx and EditableActivityCard.tsx to avoid duplication.
 * Used for converting Google's price_level (0-4) to estimated price ranges.
 */

// Activity type categories for price range mapping
export const FOOD_TYPES = ["restaurant", "food", "cafe", "bar", "foodie", "wine bar"];
export const ATTRACTION_TYPES = ["attraction", "cultural", "museum", "landmark"];
export const WELLNESS_TYPES = ["spa", "wellness"];
export const SHOPPING_TYPES = ["shopping", "market"];
export const ENTERTAINMENT_TYPES = ["entertainment", "nightlife", "event"];

// Price ranges by category and level (per person, in base currency)
// Intentionally on the higher side to avoid underestimating costs
export const PRICE_RANGES: Record<string, Record<number, { min: number; max: number }>> = {
  food: {
    0: { min: 0, max: 0 },      // Free
    1: { min: 15, max: 30 },    // $ - Budget
    2: { min: 35, max: 60 },    // $$ - Moderate
    3: { min: 65, max: 110 },   // $$$ - Expensive
    4: { min: 120, max: 220 },  // $$$$ - Very Expensive
  },
  attraction: {
    0: { min: 0, max: 0 },
    1: { min: 10, max: 22 },
    2: { min: 25, max: 50 },
    3: { min: 55, max: 95 },
    4: { min: 100, max: 180 },
  },
  wellness: {
    0: { min: 0, max: 0 },
    1: { min: 45, max: 80 },
    2: { min: 90, max: 160 },
    3: { min: 180, max: 320 },
    4: { min: 350, max: 600 },
  },
  shopping: {
    0: { min: 0, max: 0 },
    1: { min: 25, max: 55 },
    2: { min: 65, max: 130 },
    3: { min: 150, max: 300 },
    4: { min: 350, max: 700 },
  },
  entertainment: {
    0: { min: 0, max: 0 },
    1: { min: 20, max: 45 },
    2: { min: 50, max: 95 },
    3: { min: 110, max: 200 },
    4: { min: 220, max: 450 },
  },
};

/**
 * Determine the price category based on activity type
 */
export function getPriceCategory(activityType: string): string {
  const type = activityType.toLowerCase();

  if (FOOD_TYPES.includes(type)) return "food";
  if (WELLNESS_TYPES.includes(type)) return "wellness";
  if (SHOPPING_TYPES.includes(type)) return "shopping";
  if (ENTERTAINMENT_TYPES.includes(type)) return "entertainment";
  if (ATTRACTION_TYPES.includes(type)) return "attraction";

  return "attraction"; // Default category
}

/**
 * Convert Google's price level (0-4) to an estimated price range.
 * Intentionally overestimates to avoid disappointing users.
 * Ranges are per person for the activity type.
 *
 * @param priceLevel - Google's price level (0-4)
 * @param activityType - The type of activity (restaurant, attraction, etc.)
 * @param _currency - Unused, kept for backward compatibility
 */
export function convertPriceLevelToRange(
  priceLevel: number,
  activityType: string,
  _currency?: string
): { min: number; max: number } | null {
  const category = getPriceCategory(activityType);
  const levelRanges = PRICE_RANGES[category];

  if (!levelRanges || levelRanges[priceLevel] === undefined) {
    return null;
  }

  return levelRanges[priceLevel];
}

/**
 * Get estimated price value from a range.
 * Uses 80% of the way from min to max, rounded UP to nearest 5.
 * This ensures we lean toward overestimating (safer for budgeting).
 */
export function getEstimatedPriceValue(min: number, max: number): number {
  if (min === 0 && max === 0) return 0;

  // Use 80% of the way between min and max for a realistic high estimate
  const estimate = min + 0.8 * (max - min);

  // Round UP to nearest 5 to avoid any underestimation
  return Math.ceil(estimate / 5) * 5;
}

/**
 * Format a single estimated price from a range with currency.
 * Uses 80% of the way from min to max, rounded UP to nearest 5.
 */
export function formatEstimatedPrice(
  min: number,
  max: number,
  currency: string
): string {
  if (min === 0 && max === 0) return "Free";

  const estimated = getEstimatedPriceValue(min, max);
  return `${currency} ${estimated}`;
}

/**
 * Get price level symbol ($, $$, $$$, $$$$)
 */
export function getPriceLevelSymbol(priceLevel: number): string {
  const symbols: Record<number, string> = {
    0: "Free",
    1: "$",
    2: "$$",
    3: "$$$",
    4: "$$$$",
  };
  return symbols[priceLevel] ?? "";
}

/**
 * Get price level label (Inexpensive, Moderate, etc.)
 */
export function getPriceLevelLabel(priceLevel: number): string {
  const labels: Record<number, string> = {
    0: "Free",
    1: "Inexpensive",
    2: "Moderate",
    3: "Expensive",
    4: "Very Expensive",
  };
  return labels[priceLevel] ?? "";
}

/**
 * Interface for verified price data from Google Places API
 */
export interface VerifiedPriceData {
  priceRange?: string;         // Direct range from Google like "EUR 40-50"
  priceLevel?: number;         // 0-4 price level from Google
  priceLevelSymbol?: string;   // $, $$, $$$, $$$$
  priceLevelLabel?: string;    // "Inexpensive", "Moderate", etc.
}

/**
 * Get a displayable price string from various price data sources.
 * Priority: priceRange > priceLevel > estimated_cost
 */
export function getDisplayPrice(
  verifiedPrice: VerifiedPriceData | undefined,
  activityType: string,
  estimatedCost: { amount?: number; currency?: string } | undefined,
  defaultCurrency: string = "EUR"
): { price: string; isVerified: boolean; isFree: boolean } {
  // 1. Use verified price range if available
  if (verifiedPrice?.priceRange) {
    return {
      price: verifiedPrice.priceRange,
      isVerified: true,
      isFree: verifiedPrice.priceRange.toLowerCase().includes("free"),
    };
  }

  // 2. Convert price level to range
  if (verifiedPrice?.priceLevel !== undefined) {
    const range = convertPriceLevelToRange(verifiedPrice.priceLevel, activityType);
    if (range) {
      const currency = estimatedCost?.currency || defaultCurrency;
      const price = formatEstimatedPrice(range.min, range.max, currency);
      return {
        price,
        isVerified: true,
        isFree: range.min === 0 && range.max === 0,
      };
    }
  }

  // 3. Fallback to AI estimated cost
  if (estimatedCost?.amount !== undefined) {
    const currency = estimatedCost.currency || defaultCurrency;
    if (estimatedCost.amount === 0) {
      return { price: "Free", isVerified: false, isFree: true };
    }
    return {
      price: `${currency} ${estimatedCost.amount}`,
      isVerified: false,
      isFree: false,
    };
  }

  // No price info available
  return { price: "", isVerified: false, isFree: false };
}
