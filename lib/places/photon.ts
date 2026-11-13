/**
 * Photon (photon.komoot.io), OpenStreetMap's free geocoder: no key, no charge.
 *
 * Photon ONLY supports these display languages. It hard-400s on anything else,
 * and it silently DROPPED "it" support, which meant every Italian user
 * (Accept-Language: it-*) got HTTP 400 → empty fallback → "no results" on the
 * wizard's #1 input. For unsupported locales (it/es/pt/…) we use "default",
 * which returns endonyms ("Firenze, Italia", "Sevilla, España") that match what
 * native-language users actually type. `lang=it` answers 400
 * {"message":"Language is not supported. Supported are: default, de, en, fr"}.
 */
const PHOTON_SUPPORTED_LANGS = new Set(["de", "en", "fr"]);

export function resolvePhotonLang(locale?: string, acceptLanguage?: string | null): string {
  // Prefer the explicit app locale (authoritative — the client forwards it)
  // over the browser's Accept-Language, which often disagrees with the site
  // locale (an Italian user browsing /it on an English-configured browser).
  const raw = (locale || acceptLanguage || "").toLowerCase();
  const two = raw.slice(0, 2);
  return PHOTON_SUPPORTED_LANGS.has(two) ? two : "default";
}
