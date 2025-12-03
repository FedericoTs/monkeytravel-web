import { SeasonalContext, TripVibe } from "@/types";

type Season = "spring" | "summer" | "autumn" | "winter";
type Hemisphere = "northern" | "southern" | "tropical";

// Detect hemisphere from latitude
export function getHemisphere(latitude: number): Hemisphere {
  if (latitude > 23.5) return "northern";
  if (latitude < -23.5) return "southern";
  return "tropical";
}

// Calculate season based on date and hemisphere
export function getSeason(date: Date, hemisphere: Hemisphere): Season {
  const month = date.getMonth() + 1; // 1-12

  if (hemisphere === "northern") {
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 9 && month <= 11) return "autumn";
    return "winter";
  }

  if (hemisphere === "southern") {
    // Southern hemisphere: seasons are inverted
    if (month >= 9 && month <= 11) return "spring";
    if (month >= 12 || month <= 2) return "summer";
    if (month >= 3 && month <= 5) return "autumn";
    return "winter";
  }

  // Tropical: Use wet/dry season approximation, default to "summer"
  // Could be enhanced with more specific tropical season logic
  return month >= 5 && month <= 10 ? "summer" : "winter";
}

// Season emoji mapping
export const SEASON_EMOJI: Record<Season, string> = {
  spring: "🌸",
  summer: "☀️",
  autumn: "🍂",
  winter: "❄️",
};

// Season descriptions
export const SEASON_DESCRIPTIONS: Record<Season, string> = {
  spring: "Pleasant temperatures, blooming flowers, and longer days",
  summer: "Warm weather, peak tourist season, and outdoor activities",
  autumn: "Mild temperatures, fall colors, and harvest festivals",
  winter: "Cold weather, holiday atmosphere, and winter activities",
};

// Vibe suggestions based on season and events
export interface SeasonalVibeSuggestion {
  vibeId: TripVibe;
  reason: string;
}

export function getSeasonalVibeSuggestions(
  season: Season,
  holidays: string[],
  month: number
): SeasonalVibeSuggestion[] {
  const suggestions: SeasonalVibeSuggestion[] = [];

  // Check for specific holiday/event suggestions
  const holidayLower = holidays.map((h) => h.toLowerCase()).join(" ");

  if (
    holidayLower.includes("christmas") ||
    holidayLower.includes("new year") ||
    (month === 12 && season === "winter")
  ) {
    suggestions.push({
      vibeId: "fairytale",
      reason: "Perfect for Christmas markets and winter wonderland vibes",
    });
  }

  if (
    holidayLower.includes("carnival") ||
    holidayLower.includes("mardi gras") ||
    holidayLower.includes("festival")
  ) {
    suggestions.push({
      vibeId: "cultural",
      reason: "Experience local festivals and celebrations",
    });
  }

  if (holidayLower.includes("valentine") || month === 2) {
    suggestions.push({
      vibeId: "romantic",
      reason: "Ideal for romantic getaways",
    });
  }

  // Season-based suggestions
  switch (season) {
    case "spring":
      suggestions.push({
        vibeId: "nature",
        reason: "Cherry blossoms and spring blooms await",
      });
      break;
    case "summer":
      suggestions.push({
        vibeId: "adventure",
        reason: "Great weather for outdoor activities",
      });
      break;
    case "autumn":
      suggestions.push({
        vibeId: "foodie",
        reason: "Harvest season with amazing local produce",
      });
      suggestions.push({
        vibeId: "retro",
        reason: "Cozy vintage cafes and autumn colors",
      });
      break;
    case "winter":
      suggestions.push({
        vibeId: "wellness",
        reason: "Perfect for spa retreats and cozy escapes",
      });
      break;
  }

  return suggestions.slice(0, 2); // Return max 2 suggestions
}

// Major world holidays by month (simplified)
export const MAJOR_HOLIDAYS: Record<number, string[]> = {
  1: ["New Year's Day", "Three Kings Day"],
  2: ["Valentine's Day", "Lunar New Year (varies)", "Carnival (varies)"],
  3: ["St. Patrick's Day", "Holi (varies)"],
  4: ["Easter (varies)", "Earth Day"],
  5: ["Labor Day (varies)", "Mother's Day (varies)"],
  6: ["Summer Solstice"],
  7: ["Independence Day (US)", "Bastille Day (France)"],
  8: ["Ferragosto (Italy)"],
  9: ["Oktoberfest begins (Germany)", "Mid-Autumn Festival (varies)"],
  10: ["Halloween", "Diwali (varies)"],
  11: ["Day of the Dead (Mexico)", "Thanksgiving (US)"],
  12: ["Christmas", "Hanukkah (varies)", "New Year's Eve"],
};

// Crowd level estimation based on season and holidays
export function estimateCrowdLevel(
  season: Season,
  holidays: string[],
  destination: string
): SeasonalContext["crowdLevel"] {
  // Major holiday periods are always busy
  const isHolidayPeriod = holidays.some(
    (h) =>
      h.toLowerCase().includes("christmas") ||
      h.toLowerCase().includes("new year") ||
      h.toLowerCase().includes("easter")
  );

  if (isHolidayPeriod) return "peak";

  // Summer is generally high season for most destinations
  if (season === "summer") return "high";

  // Spring and autumn are shoulder seasons
  if (season === "spring" || season === "autumn") return "moderate";

  // Winter is typically low season (except ski resorts and holiday periods)
  return "low";
}

// Weather descriptions by season (simplified)
export function getWeatherDescription(
  season: Season,
  hemisphere: Hemisphere
): string {
  if (hemisphere === "tropical") {
    return season === "summer"
      ? "Wet season with afternoon showers, humid"
      : "Dry season with warm temperatures";
  }

  switch (season) {
    case "spring":
      return "Mild temperatures (10-20C), occasional rain, blooming flowers";
    case "summer":
      return "Warm to hot (20-35C), long days, peak sunshine";
    case "autumn":
      return "Cool temperatures (10-18C), crisp air, colorful foliage";
    case "winter":
      return "Cold temperatures (0-10C), possible snow, shorter days";
  }
}

// Average temperature ranges by season (simplified, Northern hemisphere baseline)
export function getAverageTemp(
  season: Season,
  hemisphere: Hemisphere
): { min: number; max: number } {
  if (hemisphere === "tropical") {
    return { min: 22, max: 32 };
  }

  switch (season) {
    case "spring":
      return { min: 10, max: 20 };
    case "summer":
      return { min: 18, max: 30 };
    case "autumn":
      return { min: 8, max: 18 };
    case "winter":
      return { min: -2, max: 8 };
  }
}

// Build complete seasonal context
export function buildSeasonalContext(
  destination: string,
  startDate: string,
  latitude?: number
): SeasonalContext {
  const date = new Date(startDate);
  const month = date.getMonth() + 1;

  // Default to northern hemisphere if latitude unknown
  const hemisphere = latitude ? getHemisphere(latitude) : "northern";
  const season = getSeason(date, hemisphere);

  // Get holidays for this month
  const holidays = MAJOR_HOLIDAYS[month] || [];

  // Filter holidays that might be relevant (simplified)
  const relevantHolidays = holidays.filter(
    (h) =>
      !h.includes("(US)") ||
      destination.toLowerCase().includes("usa") ||
      destination.toLowerCase().includes("united states") ||
      destination.toLowerCase().includes("america")
  );

  return {
    season,
    hemisphere,
    avgTemp: getAverageTemp(season, hemisphere),
    weather: getWeatherDescription(season, hemisphere),
    holidays: relevantHolidays.slice(0, 3),
    events: [], // Would be populated by external API
    crowdLevel: estimateCrowdLevel(season, relevantHolidays, destination),
  };
}
