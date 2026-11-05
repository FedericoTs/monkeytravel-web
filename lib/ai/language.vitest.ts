/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  AI_LANGUAGES,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  resolveAiLanguage,
  requestLocale,
  type SupportedLanguage,
} from "./language";
import { getLanguageInstruction } from "@/lib/ai/trip-prompt";
import { routing } from "@/lib/i18n/routing-config";

/**
 * Portuguese users were getting their itineraries generated in ENGLISH.
 *
 * The language list was declared independently in six places and every copy
 * read "en" | "es" | "it". A pt user therefore failed the membership check,
 * fell back to "en", and getLanguageInstruction returned an empty string — so
 * nothing in the prompt ever told Gemini to answer in Portuguese. Types alone
 * cannot catch this: the fallback is deliberate and the code was internally
 * consistent. What was missing was the language itself.
 *
 * These tests cover the two things that must hold together: the list reaches
 * every locale the app ships, and each of those locales actually produces a
 * prompt instruction in that language.
 */

describe("the AI language list", () => {
  it("matches routing.locales", () => {
    // Adding a locale to the app must fail here, not silently give those users
    // English.
    expect([...AI_LANGUAGES].sort()).toEqual([...routing.locales].sort());
  });

  it.each(AI_LANGUAGES)("recognises %s", (lang) => {
    expect(isSupportedLanguage(lang)).toBe(true);
    expect(resolveAiLanguage(lang)).toBe(lang);
  });

  it("accepts regional tags by base subtag", () => {
    // NEXT_LOCALE and users.preferred_language are user-supplied and have held
    // both forms.
    expect(resolveAiLanguage("pt-BR")).toBe("pt");
    expect(resolveAiLanguage("pt_PT")).toBe("pt");
    expect(resolveAiLanguage("ES-419")).toBe("es");
    expect(resolveAiLanguage(" it ")).toBe("it");
  });

  it("falls back to English rather than failing", () => {
    // Generation must still run — the wrong language is bad, no itinerary worse.
    for (const raw of [null, undefined, "", "   ", "de", "zz", 42, {}]) {
      expect(resolveAiLanguage(raw), String(raw)).toBe(DEFAULT_LANGUAGE);
    }
    expect(isSupportedLanguage("de")).toBe(false);
  });
});

describe("every language reaches the prompt", () => {
  it("English adds no instruction", () => {
    // The default prompt is already English; an instruction would be noise.
    expect(getLanguageInstruction("en")).toBe("");
    expect(getLanguageInstruction(undefined)).toBe("");
  });

  it.each(AI_LANGUAGES.filter((l) => l !== "en"))(
    "%s produces a non-empty instruction",
    (lang) => {
      // This is the exact failure: pt resolved fine everywhere else, but the
      // prompt builder had no entry for it, so the model was never told.
      const instruction = getLanguageInstruction(lang as SupportedLanguage);
      expect(instruction.trim().length).toBeGreaterThan(40);
    }
  );

  it("the Portuguese instruction is Portuguese, not Spanish or English", () => {
    // A copy-paste stub would pass the length check above.
    const pt = getLanguageInstruction("pt");
    expect(pt).toMatch(/português/i);
    expect(pt).toMatch(/OBRIGATÓRIO/i);
    // Spanish markers that must NOT appear.
    expect(pt).not.toMatch(/espanol|español|OBLIGATORIO/i);
    expect(pt).not.toMatch(/italiano/i);
  });

  it("each language's instruction is distinct", () => {
    const seen = new Map<string, string>();
    for (const lang of AI_LANGUAGES) {
      if (lang === "en") continue;
      const instruction = getLanguageInstruction(lang);
      for (const [other, text] of seen) {
        expect(instruction, `${lang} duplicates ${other}`).not.toBe(text);
      }
      seen.set(lang, instruction);
    }
  });

  it("every instruction preserves the JSON-structure constraint", () => {
    // The instruction sits inside a JSON-emitting prompt. Telling the model to
    // translate without pinning the schema is how you get translated KEYS.
    for (const lang of AI_LANGUAGES) {
      if (lang === "en") continue;
      expect(getLanguageInstruction(lang), lang).toMatch(/JSON/);
    }
  });
});

describe("requestLocale", () => {
  it("takes the page locale a request carries", () => {
    expect(requestLocale("it")).toBe("it");
    expect(requestLocale("pt-BR")).toBe("pt");
    expect(requestLocale(" ES ")).toBe("es");
  });

  it("returns null for anything else, so the caller falls back", () => {
    for (const v of [undefined, null, "", "de", 42, {}]) expect(requestLocale(v)).toBeNull();
  });
});
