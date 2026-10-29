/**
 * One identity for the ways a destination is written. "Tokyo", "tokyo" and
 * "Tokyo, Japan" are one place; "Paris, Texas" and "Lisbon, Marrakesh" stay
 * their own, because a trailing part is set aside only when it names a country.
 */

// What Postgres unaccent folds that NFD leaves whole, so a key built here
// matches one built in SQL (supabase/migrations: known_places).
const FOLD: Record<string, string> = { ł: "l", ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ı: "i", þ: "th" };

/** Lowercase, accents folded, spaces collapsed. */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[łøæœßđıþ]/g, (c) => FOLD[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => foldText(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Short forms and names Intl doesn't give, as people type them.
const ALIASES: Record<string, string> = {
  usa: "US",
  us: "US",
  "u s a": "US",
  "u s": "US",
  "united states of america": "US",
  "stati uniti d america": "US",
  uk: "GB",
  "u k": "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  inghilterra: "GB",
  inglaterra: "GB",
  scozia: "GB",
  escocia: "GB",
  holland: "NL",
  "the netherlands": "NL",
  "czech republic": "CZ",
  turkey: "TR",
  "viet nam": "VN",
  korea: "KR",
  uae: "AE",
  "hong kong": "HK",
  macau: "MO",
  macao: "MO",
  burma: "MM",
  "ivory coast": "CI",
  "cape verde": "CV",
  vatican: "VA",
  "vatican city": "VA",
};

let countries: Map<string, string> | undefined;

/** Every region name Intl knows in the app's languages (and two more), by its words. */
function countryNames(): Map<string, string> {
  if (countries) return countries;
  const names = new Map<string, string>();
  const displays = ["en", "es", "it", "pt", "fr", "de"].map(
    (locale) => new Intl.DisplayNames([locale], { type: "region", fallback: "none" })
  );
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      let code: string;
      let localized: Array<string | undefined>;
      try {
        // A retired code names today's country: DD is Germany, UK is GB.
        code = new Intl.Locale(Intl.getCanonicalLocales(`und-${String.fromCharCode(a, b)}`)[0]).region ?? "";
        localized = displays.map((display) => display.of(code));
      } catch {
        continue;
      }
      for (const name of localized) if (name && code) names.set(words(name), code);
    }
  }
  for (const [alias, code] of Object.entries(ALIASES)) if (!names.has(alias)) names.set(alias, code);
  countries = names;
  return names;
}

/** The country a name names ("Japan", "Giappone", "USA" → its code), or null. */
export function countryCode(name: string | null | undefined): string | null {
  if (!name) return null;
  return countryNames().get(words(name)) ?? null;
}

export interface DestinationKey {
  /** The place without its country: "tokyo", "paris, texas". */
  city: string;
  /** Its country's code, when the destination or its plan names one. */
  country: string | null;
}

/**
 * The destination's identity. `resolvedCountry` is the country a plan for it
 * named, for a destination written without one.
 */
export function destinationKey(destination: string, resolvedCountry?: string | null): DestinationKey {
  const parts = destination
    .split(",")
    .map(words)
    .filter(Boolean);
  const named = parts.length > 1 ? countryCode(parts[parts.length - 1]) : null;
  const city = (named ? parts.slice(0, -1) : parts).join(", ");
  return { city, country: named ?? countryCode(resolvedCountry) };
}
