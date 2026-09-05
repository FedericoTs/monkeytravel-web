/**
 * The languages the AI can generate in.
 *
 * WHY THIS IS SHARED
 * This list was declared independently in six places — lib/ai/user-context.ts,
 * lib/ai/cache.ts, lib/gemini.ts (five inline copies) and the four
 * app/api/ai/* routes — and every one of them read "en" | "es" | "it".
 * Portuguese was added to the app long ago (routing.locales, 84 translated blog
 * posts, localized landing pages, localized transactional email) but never
 * here, so a pt user failed the check, fell back to "en", and
 * getLanguageInstruction returned an empty string: **their itinerary was
 * generated in English.**
 *
 * That is the core product, and it silently undercut the Portuguese SEO spend —
 * pt visitors were being driven to a product that answers them in English.
 *
 * One definition, imported everywhere, and a test that pins it to
 * routing.locales so adding a locale to the app fails here rather than quietly
 * downgrading those users.
 */

export const AI_LANGUAGES = ["en", "es", "it", "pt"] as const;

export type SupportedLanguage = (typeof AI_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    (AI_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Normalise a locale cookie or stored `preferred_language` to a supported one.
 *
 * Accepts a regional tag by its base subtag ("pt-BR", "es-419") because both
 * the NEXT_LOCALE cookie and the users.preferred_language column are
 * user-supplied and have held both forms. Falls back to English so generation
 * always proceeds — the wrong language is bad, a failed generation is worse.
 */
export function resolveAiLanguage(raw: unknown): SupportedLanguage {
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_LANGUAGE;
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return isSupportedLanguage(base) ? base : DEFAULT_LANGUAGE;
}

/**
 * The language a trip's text is written in, from trip_meta.locale — or null
 * when the trip predates the stamp (Phase 1.3). Callers fall back to the
 * visitor's cookie/profile; the point is that an existing trip's own
 * language wins over where the owner happens to be browsing from.
 */
export function tripLocale(tripMeta: unknown): SupportedLanguage | null {
  const raw = (tripMeta as { locale?: unknown } | null | undefined)?.locale;
  return isSupportedLanguage(raw) ? raw : null;
}
