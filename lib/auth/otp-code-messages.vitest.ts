import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en/common.json";
import esMessages from "@/messages/es/common.json";
import itMessages from "@/messages/it/common.json";
import ptMessages from "@/messages/pt/common.json";
import { otpErrorMessageKey, type OtpErrorKind } from "./otp-code";

/**
 * Every string the code path asks for must exist in every shipped locale.
 *
 * next-intl does NOT throw on a missing key — it returns the key path and
 * renders it. That is how trip reminder emails mailed `emails.reminder.body`
 * to real users for two months before anyone noticed. A component test cannot
 * catch it either, because the translator is mocked there.
 *
 * So this checks the actual message files, which is the only place the answer
 * lives.
 */

const LOCALES = {
  en: enMessages,
  es: esMessages,
  it: itMessages,
  pt: ptMessages,
} as Record<string, Record<string, unknown>>;

/** The keys AuthPromptModal renders on the code path, minus the namespace. */
const UI_KEYS = [
  "magicLink.codePrompt",
  "magicLink.codeSubmit",
  "magicLink.codeVerifying",
];

const ERROR_KINDS: OtpErrorKind[] = ["invalid", "expired", "rate_limit", "network", "unknown"];

function lookup(bundle: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (node, seg) => (node && typeof node === "object" ? (node as Record<string, unknown>)[seg] : undefined),
    bundle.authPrompt
  );
}

describe("the code path's strings exist everywhere", () => {
  for (const [locale, bundle] of Object.entries(LOCALES)) {
    it(`${locale}: renders real copy, not key paths`, () => {
      for (const key of UI_KEYS) {
        const value = lookup(bundle, key);
        expect(value, `${locale} → authPrompt.${key}`).toBeTypeOf("string");
        expect((value as string).length, `${locale} → authPrompt.${key} is empty`).toBeGreaterThan(0);
        // A key path that leaked into the copy is the exact failure mode.
        expect(value, `${locale} → authPrompt.${key} looks like a key`).not.toMatch(/^magicLink\./);
      }
    });

    it(`${locale}: has a message for every error bucket`, () => {
      // otpErrorMessageKey is exhaustive over OtpErrorKind, so a new bucket
      // without a string fails here rather than reaching a user as a key path.
      for (const kind of ERROR_KINDS) {
        const key = otpErrorMessageKey(kind);
        const value = lookup(bundle, key);
        expect(value, `${locale} → authPrompt.${key} (${kind})`).toBeTypeOf("string");
        expect((value as string).length).toBeGreaterThan(0);
      }
    });
  }

  it("gives each locale its own wording, not a copy of English", () => {
    // A locale that silently fell back to English is a different bug with the
    // same symptom: nobody notices until a user complains.
    const prompt = (b: Record<string, unknown>) => lookup(b, "magicLink.codePrompt");
    expect(prompt(esMessages)).not.toBe(prompt(enMessages));
    expect(prompt(itMessages)).not.toBe(prompt(enMessages));
    expect(prompt(ptMessages)).not.toBe(prompt(enMessages));
  });
});
