import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import { readFileSync } from "fs";
import { join } from "path";
import { REMINDER_LOCALES } from "@/lib/email/reminder-locale";

/**
 * The in-trip day digest copy (Phase 4.1), guarded the same way the pre-trip
 * reminder copy is — because it can fail the same silent way: next-intl hands
 * back the key path on a miss, the mail sends, and the row is marked `sent`.
 *
 * next-intl's OWN resolver runs here, over the real message files, exactly as
 * the cron does (namespace `common.tripDayDigestEmail`), and the strings are
 * asserted post-substitution. See reminder-i18n.vitest.ts for the full history.
 */

const LOCALES = ["en", "es", "it", "pt"] as const;
const ROOT = join(__dirname, "..", "..", "..", "..");

function messagesFor(locale: string): Record<string, unknown> {
  const raw = readFileSync(join(ROOT, "messages", locale, "common.json"), "utf8");
  return { common: JSON.parse(raw) };
}

describe("trip day digest copy resolves for every locale the cron can reach", () => {
  it("REMINDER_LOCALES is the four we ship (digest reuses the same resolver)", () => {
    expect([...REMINDER_LOCALES].sort()).toEqual(["en", "es", "it", "pt"]);
  });

  for (const locale of LOCALES) {
    it(`${locale}: heading/intro/cta/empty/andMore render real, substituted copy`, () => {
      const messages = messagesFor(locale) as Parameters<typeof createTranslator>[0]["messages"];
      const t = createTranslator({ locale, messages, namespace: "common.tripDayDigestEmail" });

      const rendered = {
        heading: t("heading", { day: 3 }),
        intro: t("intro"),
        cta: t("cta"),
        empty: t("empty", { day: 3 }),
        andMore: t("andMore", { count: 2 }),
      };

      for (const [key, value] of Object.entries(rendered)) {
        expect(value, `${locale}/${key}`).not.toContain("tripDayDigestEmail.");
        expect(value, `${locale}/${key} left braces`).not.toMatch(/\{(day|count)\}/);
        expect((value as string).trim().length, `${locale}/${key} empty`).toBeGreaterThan(0);
      }

      // Placeholders actually substitute.
      expect(rendered.heading, `${locale} heading day`).toContain("3");
      expect(rendered.empty, `${locale} empty day`).toContain("3");
      expect(rendered.andMore, `${locale} andMore count`).toContain("2");
    });
  }

  it("the copy is NOT reachable at the un-prefixed namespace (the classic bug)", () => {
    const messages = messagesFor("en") as Parameters<typeof createTranslator>[0]["messages"];
    const t = createTranslator({
      locale: "en",
      messages,
      namespace: "tripDayDigestEmail",
      onError: () => {},
    });
    expect(t("heading", { day: 3 })).toContain("tripDayDigestEmail.heading");
  });
});

describe("the cron wires the digest namespace + guard", () => {
  const source = readFileSync(join(__dirname, "route.ts"), "utf8");

  it("asks for common.tripDayDigestEmail", () => {
    expect(source).toContain('"common.tripDayDigestEmail"');
  });

  it("assertTranslated refuses an unresolved digest key", () => {
    expect(source).toContain('value.includes("tripDayDigestEmail.")');
  });
});
