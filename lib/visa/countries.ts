/**
 * Country names + flag emojis for the Visa Checker UI.
 *
 * Names come from the platform's built-in `Intl.DisplayNames` API
 * (supported in Node 18+, all modern browsers, and Vercel's runtime).
 * This means we get high-quality localized names for every locale we
 * support without hand-maintaining 199 × N translation strings.
 *
 * Flag emojis are computed from ISO-2 codes via regional indicator
 * symbols — no asset files needed, renders natively on every modern
 * platform.
 *
 * The list of supported codes is derived from `getKnownIso2Codes()`
 * (the matrix dataset) so we never offer a passport/destination we
 * have no data for.
 */

import { getKnownIso2Codes } from "./lookup";

export interface CountryOption {
  iso2: string; // uppercase, e.g. "US"
  name: string; // localized display name
  flag: string; // emoji string, e.g. "🇺🇸"
}

/**
 * ISO-2 code → flag emoji via regional indicator symbols.
 * "US" → "🇺🇸" (U+1F1FA + U+1F1F8).
 * Returns an empty string for invalid codes.
 */
export function iso2ToFlag(iso2: string): string {
  const code = (iso2 || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  const A = 0x1f1e6 - "A".charCodeAt(0);
  return String.fromCodePoint(A + code.charCodeAt(0), A + code.charCodeAt(1));
}

/**
 * Localized country list, alphabetically sorted by the localized name.
 * Cached per-locale because building it is cheap but not free.
 */
const cache = new Map<string, CountryOption[]>();

export function getCountryOptions(locale: string): CountryOption[] {
  // Normalize locale — Intl accepts "en", "it", "es", "en-US" etc.
  const norm = locale && /^[a-z]{2}/i.test(locale) ? locale : "en";
  if (cache.has(norm)) return cache.get(norm)!;

  let displayNames: Intl.DisplayNames | null = null;
  try {
    displayNames = new Intl.DisplayNames([norm], { type: "region" });
  } catch {
    // Fallback to English if the locale is unsupported by the runtime.
    displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  }

  const options: CountryOption[] = getKnownIso2Codes().map((iso2) => ({
    iso2,
    // `Intl.DisplayNames.of` is documented to return `undefined` for
    // unknown codes. Fall back to the ISO-2 itself so the UI never
    // shows an empty option.
    name: displayNames?.of(iso2) || iso2,
    flag: iso2ToFlag(iso2),
  }));

  options.sort((a, b) => a.name.localeCompare(b.name, norm));
  cache.set(norm, options);
  return options;
}

/**
 * Single localized country name lookup (for the result page).
 * Cheap — uses the same cache as the options list.
 */
export function getCountryName(iso2: string, locale: string): string {
  const opts = getCountryOptions(locale);
  return opts.find((o) => o.iso2 === iso2.toUpperCase())?.name || iso2;
}
