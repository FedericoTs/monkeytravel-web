/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AI_LANGUAGES,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  resolveAiLanguage,
  type SupportedLanguage,
} from "./language";
import { getLanguageInstruction } from "@/lib/gemini";

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
    // The drift guard. Adding a locale to the app must fail HERE rather than
    // silently downgrading those users to English, which is how pt was missed.
    //
    // routing.locales is read from SOURCE TEXT: lib/i18n/routing.ts builds
    // next-intl navigation helpers, which pull next/navigation and cannot load
    // under vitest.
    const src = readFileSync(join(process.cwd(), "lib", "i18n", "routing.ts"), "utf8");
    const literal = src.match(/locales:\s*\[([^\]]+)\]/)?.[1];
    expect(literal, "could not find routing.locales — has the file moved?").toBeTruthy();
    const routingLocales = [...literal!.matchAll(/["']([a-z-]+)["']/g)].map((m) => m[1]);

    expect(routingLocales.length).toBeGreaterThan(0);
    expect([...AI_LANGUAGES].sort()).toEqual([...routingLocales].sort());
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

describe("the entry points actually use it", () => {
  /** Every place that turns a cookie or profile column into a language. */
  const ENTRY_POINTS = [
    "lib/ai/user-context.ts",
    "app/api/ai/assistant/route.ts",
    "app/api/ai/generate-more-days/route.ts",
    "app/api/ai/regenerate-activity/route.ts",
    "app/api/ai/regenerate-day/route.ts",
  ];

  it.each(ENTRY_POINTS)("%s resolves the locale instead of membership-testing it", (file) => {
    // Shipping the helper is not the same as calling it. The first pass at this
    // fix swapped the inline ["en","es","it"] arrays for isSupportedLanguage()
    // and the unit tests above all passed — but a strict membership test still
    // rejects "pt-BR" outright, so pt-BR users kept getting English. Only
    // driving the real route caught it.
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src).toContain("resolveAiLanguage");
    expect(src, "strict check on the locale cookie").not.toMatch(
      /isSupportedLanguage\(\s*localeCookie\.value/
    );
    expect(src, "strict check on preferred_language").not.toMatch(
      /isSupportedLanguage\(\s*profile(Row)?\.preferred_language/
    );
  });

  it.each(ENTRY_POINTS)("%s does not re-declare the language list", (file) => {
    // Six independent copies of ["en","es","it"] is how pt was missed.
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src).not.toMatch(/type SupportedLanguage\s*=\s*"en"/);
    expect(src).not.toMatch(/\["en",\s*"es",\s*"it"\]/);
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
