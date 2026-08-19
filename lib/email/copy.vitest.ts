/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  normalizeEmailLocale,
  layoutCopy,
  confirmSignupCopy,
  authSharedCopy,
  blogEmailCopy,
  authActionCopy,
  inviteCopy,
  feedbackOutreachCopy,
  voteCastCopy,
  type EmailLocale,
} from "./copy";

/**
 * Portuguese was added to the app — routing, 84 translated blog posts,
 * localized landing pages — but EmailLocale stayed "en" | "es" | "it", so every
 * transactional email fell back to English for pt users. The reminder emails
 * were the visible symptom; the cause was here.
 *
 * TypeScript enforces that each Record<EmailLocale, …> has an entry per locale,
 * so the structural half is covered by the compiler. What it cannot catch is an
 * entry that exists but was stubbed by pasting the English strings in — which
 * would read as "translated" to every check except a human. That is what these
 * tests are for.
 */

const LOCALES: EmailLocale[] = ["en", "es", "it", "pt"];

/** Every leaf string in a copy object, with functions invoked on sample args. */
function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    try {
      // Every copy function here takes a name/title/count-ish single argument.
      return leaves((value as (...a: unknown[]) => unknown)("Sam", "Lisbon"));
    } catch {
      return [];
    }
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(leaves);
  }
  return [];
}

const BLOCKS: Array<[string, Record<EmailLocale, unknown>]> = [
  ["layoutCopy", layoutCopy],
  ["confirmSignupCopy", confirmSignupCopy],
  ["authSharedCopy", authSharedCopy],
  ["blogEmailCopy", blogEmailCopy],
  ["authActionCopy", authActionCopy],
  ["inviteCopy", inviteCopy],
  ["feedbackOutreachCopy", feedbackOutreachCopy],
  ["voteCastCopy", voteCastCopy],
];

describe("email copy covers every locale", () => {
  it("EmailLocale matches routing.locales", () => {
    // Read from source text: lib/i18n/routing.ts builds next-intl navigation
    // helpers, which pull next/navigation and cannot be imported under vitest.
    const src = readFileSync(join(process.cwd(), "lib", "i18n", "routing.ts"), "utf8");
    const literal = src.match(/locales:\s*\[([^\]]+)\]/)?.[1];
    expect(literal, "could not find routing.locales — has the file moved?").toBeTruthy();
    const routingLocales = [...literal!.matchAll(/["']([a-z-]+)["']/g)].map((m) => m[1]);
    expect([...LOCALES].sort()).toEqual([...routingLocales].sort());
  });

  it.each(BLOCKS)("%s has non-empty copy for all four locales", (_name, block) => {
    for (const locale of LOCALES) {
      const strings = leaves(block[locale]);
      expect(strings.length, locale).toBeGreaterThan(0);
      for (const s of strings) expect(s.trim(), locale).not.toBe("");
    }
  });

  it.each(BLOCKS)("%s: pt is actually translated, not the English strings", (_name, block) => {
    // A stubbed locale would pass every structural check. Emoji-only and
    // brand-only values (🐵, "MonkeyTravel", "Confirmar") legitimately match
    // across languages, so compare the block as a whole rather than per string.
    const en = leaves(block.en).join("|");
    const pt = leaves(block.pt).join("|");
    expect(pt).not.toBe(en);
  });

  it("does not leave a locale reading as English by accident", () => {
    // Same guard for es/it, so this suite protects all three translations.
    for (const [name, block] of BLOCKS) {
      const en = leaves(block.en).join("|");
      for (const locale of ["es", "it", "pt"] as const) {
        expect(leaves(block[locale]).join("|"), `${name}.${locale}`).not.toBe(en);
      }
    }
  });
});

describe("normalizeEmailLocale", () => {
  it.each(LOCALES)("passes %s through", (locale) => {
    expect(normalizeEmailLocale(locale)).toBe(locale);
  });

  it("falls back to English for anything else", () => {
    // The email must still send — silence is worse than the wrong language.
    for (const raw of [null, undefined, "", "de", "pt-BR", 42, {}]) {
      expect(normalizeEmailLocale(raw), String(raw)).toBe("en");
    }
  });
});
