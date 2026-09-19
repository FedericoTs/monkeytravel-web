/**
 * The domestic bodies rendered the way the cron renders them — through
 * next-intl's createTranslator with the file mounted under `common`, the
 * slot namespace the route asks for, and {destination} supplied — so a typo
 * in a placeholder or a missing key fails here and not in someone's inbox.
 */
import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import { readFileSync } from "fs";
import { join } from "path";

const LOCALES = ["en", "es", "it", "pt"] as const;
const ROOT = join(__dirname, "..", "..", "..", "..");

function messagesFor(locale: string) {
  return { common: JSON.parse(readFileSync(join(ROOT, "messages", locale, "common.json"), "utf8")) };
}

describe("domestic reminder copy renders through next-intl", () => {
  for (const locale of LOCALES) {
    for (const slot of ["pack_early_14d", "confirm_1d"] as const) {
      it(`${locale}/${slot}: bodyDomestic renders with the destination and without the passport`, () => {
        const t = createTranslator({
          locale,
          messages: messagesFor(locale),
          namespace: `common.tripReminderEmail.${slot}`,
          onError: (e) => {
            throw e;
          },
        });
        expect(t.has("bodyDomestic")).toBe(true);
        const rendered = t("bodyDomestic", { destination: "Stillwater" });
        expect(rendered).toContain("Stillwater");
        expect(rendered).not.toContain("{destination}");
        expect(rendered).not.toMatch(/passport|pasaporte|passaporto|passaporte/i);
        expect(rendered).not.toContain("tripReminderEmail.");
        // The international body is untouched and still carries the line.
        expect(t("body", { destination: "Lisbon" })).toMatch(/passport|pasaporte|passaporto|passaporte/i);
      });
    }

    it(`${locale}: slots without a domestic body report has() false`, () => {
      // The route falls back to body when has("bodyDomestic") is false; pin
      // that the visa/weather/morning slots are in that state, so a stray
      // key added later is a deliberate change, not an accident.
      for (const slot of ["visa_check_7d", "weather_3d", "morning_of"]) {
        const t = createTranslator({ locale, messages: messagesFor(locale), namespace: `common.tripReminderEmail.${slot}` });
        expect(t.has("bodyDomestic")).toBe(false);
      }
    });
  }
});
