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

// ---------------------------------------------------------------------------
// Country-aware holiday data.
// **2026-05-24 live-test fix:** the previous data was a flat list keyed by
// month, with the only filter being "drop (US) holidays unless destination
// is US". This produced absurd output like "Day of the Dead (Mexico)" on a
// trip to Reykjavik and "Diwali" on a trip to Lisbon.
//
// New model: each entry has an optional `countries` allowlist. Empty / undefined
// means the holiday is globally observed (e.g. New Year, Christmas in most of
// the world). Otherwise we only surface the holiday when the destination's
// country code is in the list.
// ---------------------------------------------------------------------------

interface HolidayEntry {
  /** Display label (no "(US)" or "(Mexico)" suffix — we infer that from context). */
  name: string;
  /**
   * ISO-3166-1 alpha-2 country codes where this holiday is widely observed.
   * Omit (undefined) for genuinely global holidays.
   */
  countries?: string[];
  /**
   * Fixed day of the month (1-31). When set together with the month key,
   * we know the exact date and can filter holidays that fall outside the
   * trip's [startDate, endDate] window. Omit for holidays that move year
   * to year (Easter, Lunar New Year, Mother's Day = 2nd Sunday, etc.) —
   * those keep the legacy month-only behavior.
   */
  dayOfMonth?: number;
}

export const HOLIDAYS_BY_MONTH: Record<number, HolidayEntry[]> = {
  1: [
    { name: "New Year's Day", dayOfMonth: 1 },
    { name: "Three Kings Day", dayOfMonth: 6, countries: ["ES", "IT", "MX", "AR", "PT"] },
    { name: "Lunar New Year (varies)", countries: ["CN", "VN", "KR", "SG", "TW", "MY"] },
  ],
  2: [
    { name: "Valentine's Day", dayOfMonth: 14 },
    { name: "Carnival (varies)", countries: ["BR", "IT", "DE", "PT", "ES", "TT"] },
  ],
  3: [
    { name: "St. Patrick's Day", dayOfMonth: 17, countries: ["IE", "US", "GB", "CA", "AU"] },
    { name: "Holi (varies)", countries: ["IN", "NP"] },
    { name: "Las Fallas (Spain)", countries: ["ES"] }, // Mid-March, varies
  ],
  4: [
    { name: "Easter (varies)" }, // Widely observed in Christian countries
    { name: "King's Day (Netherlands)", dayOfMonth: 27, countries: ["NL"] },
    { name: "Songkran (Thai New Year)", dayOfMonth: 13, countries: ["TH", "LA", "KH"] },
  ],
  5: [
    { name: "Cinco de Mayo", dayOfMonth: 5, countries: ["MX", "US"] },
    { name: "Labor Day", dayOfMonth: 1 }, // Many countries, May 1
    { name: "Mother's Day (varies)" }, // Many countries, second Sunday — keep loose
  ],
  6: [
    { name: "Summer Solstice", dayOfMonth: 21 },
    { name: "Midsummer", dayOfMonth: 24, countries: ["SE", "FI", "NO", "DK", "IS", "LV", "EE"] },
    { name: "São João (Portugal)", dayOfMonth: 24, countries: ["PT"] },
  ],
  7: [
    { name: "Independence Day", dayOfMonth: 4, countries: ["US"] },
    { name: "Bastille Day", dayOfMonth: 14, countries: ["FR"] },
    { name: "Tour de France (varies)", countries: ["FR"] },
  ],
  8: [
    { name: "Ferragosto", dayOfMonth: 15, countries: ["IT"] },
    { name: "Notting Hill Carnival", countries: ["GB"] }, // Last weekend of August
    { name: "Edinburgh Fringe", countries: ["GB"] }, // Spans most of August
  ],
  9: [
    { name: "Oktoberfest begins", countries: ["DE"] }, // Mid-late September, varies
    { name: "Mid-Autumn Festival", countries: ["CN", "VN", "KR", "TW", "SG", "MY"] },
  ],
  10: [
    { name: "Halloween", dayOfMonth: 31, countries: ["US", "CA", "GB", "IE", "AU", "NZ"] },
    { name: "Diwali (varies)", countries: ["IN", "NP", "SG", "MY", "GB"] },
    { name: "Oktoberfest (ongoing)", countries: ["DE"] }, // Runs ~16 days, into early Oct
    { name: "Republic Day (Portugal)", dayOfMonth: 5, countries: ["PT"] },
    { name: "Sports Day", countries: ["JP"] }, // Second Monday in October
    { name: "Day of the Spanish Nation", dayOfMonth: 12, countries: ["ES"] },
    { name: "Canadian Thanksgiving", countries: ["CA"] }, // Second Monday in October
  ],
  11: [
    { name: "Day of the Dead", dayOfMonth: 2, countries: ["MX"] },
    { name: "Thanksgiving", countries: ["US"] }, // Fourth Thursday in November
    { name: "Guy Fawkes Night", dayOfMonth: 5, countries: ["GB"] },
    // Widely observed in Catholic countries + Latin America (Nov 1).
    {
      name: "All Saints' Day",
      dayOfMonth: 1,
      countries: ["ES", "PT", "IT", "FR", "PL", "AT", "BE", "DE", "MX", "BR", "AR", "CL", "CO", "PE", "GR", "HR", "HU"],
    },
    { name: "Singles' Day", dayOfMonth: 11, countries: ["CN"] },
    { name: "Bonfire Night", dayOfMonth: 5, countries: ["GB"] }, // alt name for Guy Fawkes
    { name: "Diwali (early Nov varies)", countries: ["IN", "NP", "SG", "MY"] },
  ],
  12: [
    { name: "Christmas", dayOfMonth: 25 }, // Widely celebrated
    { name: "Hanukkah (varies)", countries: ["IL", "US"] },
    { name: "New Year's Eve", dayOfMonth: 31 },
    { name: "Boxing Day", dayOfMonth: 26, countries: ["GB", "CA", "AU", "NZ", "IE"] },
  ],
};

/**
 * Best-effort destination → ISO-3166-1 alpha-2 country code.
 *
 * Pattern-matches a basket of common country names + major-city names. Not
 * exhaustive — designed to cover the destinations Gemini commonly returns
 * from Start Anywhere extraction. Returns null when we can't confidently
 * place the destination — callers then fall back to ONLY-global holidays.
 *
 * Order matters: more specific patterns first (e.g. "United Kingdom" must
 * match before standalone "United" might collide with "United States").
 */
export function destinationCountryCode(destination: string): string | null {
  const d = (destination || "").toLowerCase();
  if (!d) return null;

  // Country-name matches — explicit and unambiguous.
  // Listed roughly by traffic volume in the planner.
  if (/\bitaly\b|\brome\b|\bvenice\b|\bflorence\b|\bmilan\b|\bnaples\b|\bsicily\b|\btuscany\b/.test(d)) return "IT";
  if (/\bfrance\b|\bparis\b|\blyon\b|\bmarseille\b|\bnice\b|\bbordeaux\b|\bprovence\b/.test(d)) return "FR";
  if (/\bspain\b|\bmadrid\b|\bbarcelona\b|\bseville\b|\bvalencia\b|\bgranada\b|\bmallorca\b|\bibiza\b/.test(d)) return "ES";
  if (/\bportugal\b|\blisbon\b|\bporto\b|\bmadeira\b|\balgarve\b/.test(d)) return "PT";
  if (/\bgermany\b|\bberlin\b|\bmunich\b|\bhamburg\b|\bfrankfurt\b|\bcologne\b|\bdresden\b/.test(d)) return "DE";
  if (/\bnetherlands\b|\bholland\b|\bamsterdam\b|\brotterdam\b|\butrecht\b/.test(d)) return "NL";
  if (/\bbelgium\b|\bbrussels\b|\bbruges\b|\bantwerp\b|\bghent\b/.test(d)) return "BE";
  if (/\bswitzerland\b|\bzurich\b|\bgeneva\b|\binterlaken\b|\blucerne\b/.test(d)) return "CH";
  if (/\baustria\b|\bvienna\b|\bsalzburg\b|\binnsbruck\b/.test(d)) return "AT";
  if (/\bgreece\b|\bathens\b|\bsantorini\b|\bmykonos\b|\bcrete\b|\brhodes\b/.test(d)) return "GR";
  if (/\bunited kingdom\b|\bgreat britain\b|\bengland\b|\bscotland\b|\bwales\b|\blondon\b|\bedinburgh\b|\bmanchester\b|\bliverpool\b|\bglasgow\b|\bcardiff\b/.test(d)) return "GB";
  if (/\bireland\b|\bdublin\b|\bgalway\b|\bcork\b/.test(d)) return "IE";
  if (/\bnorway\b|\boslo\b|\bbergen\b|\btromsø\b|\btromso\b/.test(d)) return "NO";
  if (/\bsweden\b|\bstockholm\b|\bgothenburg\b/.test(d)) return "SE";
  if (/\bdenmark\b|\bcopenhagen\b|\baarhus\b/.test(d)) return "DK";
  if (/\bfinland\b|\bhelsinki\b|\brovaniemi\b/.test(d)) return "FI";
  if (/\biceland\b|\breykjavik\b/.test(d)) return "IS";
  if (/\bczech\b|\bprague\b/.test(d)) return "CZ";
  if (/\bpoland\b|\bwarsaw\b|\bkrakow\b|\bcracow\b|\bgdansk\b/.test(d)) return "PL";
  if (/\bhungary\b|\bbudapest\b/.test(d)) return "HU";
  if (/\bcroatia\b|\bzagreb\b|\bdubrovnik\b|\bsplit\b/.test(d)) return "HR";
  if (/\bturkey\b|\bistanbul\b|\bcappadocia\b|\bantalya\b/.test(d)) return "TR";
  if (/\brussia\b|\bmoscow\b|\bst\.? petersburg\b/.test(d)) return "RU";

  // Americas
  if (/\busa\b|united states|\bamerica\b|new york|\blos angeles\b|chicago|\bmiami\b|san francisco|\bvegas\b|\borlando\b|\bboston\b|\bseattle\b|\bhawaii\b/.test(d)) return "US";
  if (/\bcanada\b|toronto|vancouver|montreal|quebec|banff/.test(d)) return "CA";
  if (/\bmexico\b|cancun|cozumel|tulum|cabo|oaxaca|guadalajara/.test(d)) return "MX";
  if (/\bbrazil\b|\brio de janeiro\b|\brio\b|sao paulo|salvador|brasilia/.test(d)) return "BR";
  if (/\bargentina\b|buenos aires|patagonia|mendoza/.test(d)) return "AR";
  if (/\bchile\b|santiago|valparaiso|atacama/.test(d)) return "CL";
  if (/\bperu\b|lima|cusco|machu picchu/.test(d)) return "PE";
  if (/\bcolombia\b|bogota|medellin|cartagena/.test(d)) return "CO";

  // Asia
  if (/\bjapan\b|\btokyo\b|\bkyoto\b|\bosaka\b|\bhokkaido\b|\bokinawa\b/.test(d)) return "JP";
  if (/\bchina\b|\bbeijing\b|\bshanghai\b|\bguangzhou\b|\bxi'?an\b|\bchengdu\b/.test(d)) return "CN";
  if (/\bsouth korea\b|\bkorea\b|\bseoul\b|\bbusan\b/.test(d)) return "KR";
  if (/\bthailand\b|\bbangkok\b|\bphuket\b|\bchiang mai\b|\bkrabi\b/.test(d)) return "TH";
  if (/\bvietnam\b|\bhanoi\b|\bho chi minh\b|\bda nang\b|\bhoi an\b/.test(d)) return "VN";
  if (/\bindonesia\b|\bbali\b|\bjakarta\b|\byogyakarta\b/.test(d)) return "ID";
  if (/\bmalaysia\b|\bkuala lumpur\b|\bpenang\b/.test(d)) return "MY";
  if (/\bsingapore\b/.test(d)) return "SG";
  if (/\bphilippines\b|\bmanila\b|\bcebu\b|\bpalawan\b/.test(d)) return "PH";
  if (/\bindia\b|\bdelhi\b|\bmumbai\b|\bgoa\b|\bjaipur\b|\bbangalore\b|\bagra\b/.test(d)) return "IN";
  if (/\bnepal\b|\bkathmandu\b/.test(d)) return "NP";
  if (/\bcambodia\b|\bsiem reap\b|\bphnom penh\b|\bangkor\b/.test(d)) return "KH";
  if (/\blaos\b|\bluang prabang\b|\bvientiane\b/.test(d)) return "LA";
  if (/\bsri lanka\b|\bcolombo\b|\bkandy\b/.test(d)) return "LK";
  if (/\bisrael\b|\btel aviv\b|\bjerusalem\b/.test(d)) return "IL";
  if (/\buae\b|emirates|\bdubai\b|\babu dhabi\b/.test(d)) return "AE";

  // Oceania
  if (/\baustralia\b|\bsydney\b|\bmelbourne\b|\bbrisbane\b|\bperth\b|\buluru\b/.test(d)) return "AU";
  if (/\bnew zealand\b|\bauckland\b|\bwellington\b|\bqueenstown\b/.test(d)) return "NZ";

  // Africa
  if (/\bmorocco\b|\bmarrakech\b|\bcasablanca\b|\bfez\b|\bfes\b/.test(d)) return "MA";
  if (/\begypt\b|\bcairo\b|\balexandria\b|\bluxor\b|\baswan\b/.test(d)) return "EG";
  if (/\bsouth africa\b|\bcape town\b|\bjohannesburg\b|\bkruger\b/.test(d)) return "ZA";
  if (/\bkenya\b|\bnairobi\b|\bmaasai mara\b/.test(d)) return "KE";
  if (/\btanzania\b|\bzanzibar\b|\bserengeti\b|\bkilimanjaro\b/.test(d)) return "TZ";

  return null;
}

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

/**
 * Pick the holidays that actually apply to the given destination + month.
 *
 * - Entries with no `countries` list are global → always kept.
 * - Entries with a `countries` list are kept only if the destination's
 *   resolved country code is in the list.
 * - If the destination can't be mapped to a country, we keep ONLY the
 *   global holidays — better to under-show than to show "Day of the Dead"
 *   for a trip to a place we don't recognize.
 *
 * Exported for testing + reuse in other surfaces.
 */
export function relevantHolidaysForDestination(
  destination: string,
  month: number,
  /**
   * Optional trip window. When provided, holidays with a known
   * `dayOfMonth` only surface if that day falls inside [startDate, endDate].
   * Holidays without `dayOfMonth` (variable: Easter, Carnival, Mother's Day)
   * keep the legacy month-only behavior — we don't compute moveable-feast
   * dates here.
   *
   * **Why this exists** — 2026-05-25 live-test: a Trieste trip May 28–30
   * incorrectly surfaced "Labor Day" (May 1) and "Mother's Day" (May 10),
   * both clearly outside the trip window. Adding `dayOfMonth` to each
   * fixed-date holiday + filtering here fixes the false positives without
   * dropping the variable holidays we can't pin.
   */
  tripWindow?: { startDate: string; endDate: string }
): string[] {
  const entries = HOLIDAYS_BY_MONTH[month] || [];
  const country = destinationCountryCode(destination);

  const inWindow = (() => {
    if (!tripWindow?.startDate || !tripWindow?.endDate) return null;
    const parseLocal = (s: string): Date | null => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      return m
        ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
        : null;
    };
    const start = parseLocal(tripWindow.startDate);
    const end = parseLocal(tripWindow.endDate);
    if (!start || !end) return null;
    const year = start.getFullYear();
    return (day: number) => {
      const holidayDate = new Date(year, month - 1, day);
      return holidayDate >= start && holidayDate <= end;
    };
  })();

  return entries
    .filter((h) => {
      // Country filter (existing logic).
      if (h.countries && h.countries.length > 0) {
        if (!country) return false;
        if (!h.countries.includes(country)) return false;
      }
      // Date filter (only when we have both a window AND a fixed day).
      if (inWindow && typeof h.dayOfMonth === "number") {
        return inWindow(h.dayOfMonth);
      }
      return true;
    })
    .map((h) => h.name);
}

// Build complete seasonal context.
//
// `endDate` is optional but strongly recommended — when provided, the
// holidays list filters out fixed-date entries that fall outside the trip
// window (e.g. "Labor Day" on May 1 stops surfacing for a May 28–30 trip).
export function buildSeasonalContext(
  destination: string,
  startDate: string,
  latitude?: number,
  endDate?: string
): SeasonalContext {
  // Parse YYYY-MM-DD as local midnight (not UTC) so we don't shift -1 day
  // in negative-offset zones — same bug class fixed elsewhere on 2026-05-24.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  const date = m
    ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
    : new Date(startDate);
  const month = date.getMonth() + 1;

  // Default to northern hemisphere if latitude unknown
  const hemisphere = latitude ? getHemisphere(latitude) : "northern";
  const season = getSeason(date, hemisphere);

  // Destination-aware holiday filter (replaces the old (US)-only hack
  // that surfaced "Day of the Dead (Mexico)" on a trip to Reykjavik).
  // When endDate is provided, also drops fixed-date holidays outside the
  // [startDate, endDate] window.
  const tripWindow = endDate ? { startDate, endDate } : undefined;
  const relevantHolidays = relevantHolidaysForDestination(
    destination,
    month,
    tripWindow
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

/**
 * Legacy export kept for backward compat — some callers may import the
 * old flat list. New code should use HOLIDAYS_BY_MONTH (typed entries)
 * or relevantHolidaysForDestination() (filtered names).
 *
 * @deprecated Use HOLIDAYS_BY_MONTH + destinationCountryCode instead.
 */
export const MAJOR_HOLIDAYS: Record<number, string[]> = Object.fromEntries(
  Object.entries(HOLIDAYS_BY_MONTH).map(([month, entries]) => [
    Number(month),
    entries.map((e) => e.name),
  ])
);
