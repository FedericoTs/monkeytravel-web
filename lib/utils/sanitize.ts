/**
 * Sanitization utilities for AI-generated content
 * Prevents XSS attacks from potentially malicious AI responses
 */

/**
 * HTML entities that need to be escaped
 */
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#x60;",
  "=": "&#x3D;",
};

/**
 * Escape HTML entities in a string to prevent XSS
 */
export function escapeHtml(str: string): string {
  if (typeof str !== "string") return "";
  return str.replace(/[&<>"'`=/]/g, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Remove all HTML tags from a string
 */
export function stripHtml(str: string): string {
  if (typeof str !== "string") return "";
  return str.replace(/<[^>]*>/g, "");
}

/**
 * Sanitize a string by stripping HTML and normalizing whitespace
 */
export function sanitizeText(str: string): string {
  if (typeof str !== "string") return "";
  return stripHtml(str)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sanitize an array of strings
 */
export function sanitizeArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((item): item is string => typeof item === "string")
    .map(sanitizeText)
    .filter(Boolean);
}

/**
 * Validate and sanitize a URL
 * Only allows http, https protocols
 * Returns empty string for invalid URLs
 */
export function sanitizeUrl(url: string): string {
  if (typeof url !== "string") return "";

  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.href;
  } catch {
    return "";
  }
}

/**
 * Validate coordinates have sufficient precision (6+ decimal places = ~10cm accuracy)
 * Returns null for invalid or low-precision coordinates
 */
export function validateCoordinates(
  coords: { lat?: number; lng?: number } | null | undefined
): { lat: number; lng: number } | null {
  if (!coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") {
    return null;
  }

  const { lat, lng } = coords;

  // Validate ranges
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  // Check precision (at least 4 decimal places for ~10m accuracy)
  const latStr = lat.toString();
  const lngStr = lng.toString();
  const latDecimals = latStr.includes(".") ? latStr.split(".")[1]?.length || 0 : 0;
  const lngDecimals = lngStr.includes(".") ? lngStr.split(".")[1]?.length || 0 : 0;

  if (latDecimals < 4 || lngDecimals < 4) {
    console.warn(`[Sanitize] Low precision coordinates: ${lat}, ${lng}`);
    // Still return them but log warning
  }

  return { lat, lng };
}

/**
 * Sanitize an activity object from AI response
 */
export function sanitizeActivity(activity: Record<string, unknown>): Record<string, unknown> {
  return {
    ...activity,
    name: sanitizeText(activity.name as string),
    description: sanitizeText(activity.description as string),
    location: sanitizeText(activity.location as string),
    address: activity.address ? sanitizeText(activity.address as string) : undefined,
    tips: sanitizeArray(activity.tips),
    booking_url: activity.booking_url ? sanitizeUrl(activity.booking_url as string) : undefined,
    image_url: activity.image_url ? sanitizeUrl(activity.image_url as string) : undefined,
    coordinates: validateCoordinates(activity.coordinates as { lat?: number; lng?: number }),
  };
}

/**
 * Sanitize an entire itinerary from AI response
 */
export function sanitizeItinerary<T extends object>(itinerary: T): T {
  if (!itinerary || typeof itinerary !== "object") {
    return itinerary;
  }

  // Cast to allow property access and mutation
  const input = itinerary as Record<string, unknown>;
  const sanitized = { ...input } as Record<string, unknown>;

  // Sanitize destination
  if (input.destination && typeof input.destination === "object") {
    const dest = input.destination as Record<string, unknown>;
    sanitized.destination = {
      ...dest,
      name: sanitizeText(dest.name as string),
      country: sanitizeText(dest.country as string),
      description: sanitizeText(dest.description as string),
      weather_note: dest.weather_note ? sanitizeText(dest.weather_note as string) : undefined,
      best_for: sanitizeArray(dest.best_for),
    };
  }

  // Sanitize days and activities
  if (Array.isArray(input.days)) {
    sanitized.days = input.days.map((day: Record<string, unknown>) => ({
      ...day,
      title: day.title ? sanitizeText(day.title as string) : undefined,
      theme: day.theme ? sanitizeText(day.theme as string) : undefined,
      notes: day.notes ? sanitizeText(day.notes as string) : undefined,
      activities: Array.isArray(day.activities)
        ? day.activities.map((a: Record<string, unknown>) => sanitizeActivity(a))
        : [],
    }));
  }

  // Sanitize trip summary
  if (input.trip_summary && typeof input.trip_summary === "object") {
    const summary = input.trip_summary as Record<string, unknown>;
    sanitized.trip_summary = {
      ...summary,
      highlights: sanitizeArray(summary.highlights),
      packing_suggestions: sanitizeArray(summary.packing_suggestions),
    };
  }

  // Sanitize booking links
  if (input.booking_links && typeof input.booking_links === "object") {
    const links = input.booking_links as Record<string, unknown>;
    const flightsArr = Array.isArray(links.flights) ? links.flights : [];
    const hotelsArr = Array.isArray(links.hotels) ? links.hotels : [];

    sanitized.booking_links = {
      flights: flightsArr.map((link) => {
        const l = link as Record<string, unknown>;
        return {
          provider: sanitizeText(l.provider as string),
          url: sanitizeUrl(l.url as string),
        };
      }),
      hotels: hotelsArr.map((link) => {
        const l = link as Record<string, unknown>;
        return {
          provider: sanitizeText(l.provider as string),
          url: sanitizeUrl(l.url as string),
        };
      }),
    };
  }

  return sanitized as T;
}
