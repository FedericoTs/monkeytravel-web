import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en/trips.json";
import es from "@/messages/es/trips.json";
import it_ from "@/messages/it/trips.json";
import pt from "@/messages/pt/trips.json";

const LOCALES = { en, es, it: it_, pt } as const;

describe("the shared plan's message in every language", () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    const t = createTranslator({ locale, messages: { trips: messages }, namespace: "trips.wizard.result" });

    it(`${locale}: days, cities and the rest counted, the link last`, () => {
      const values = { destination: "Lisboa", days: "<days>", url: "https://monkeytravel.app/shared/x" };
      for (const key of ["shareCrewMessageDays", "shareAnonMessageDays"] as const) {
        const message = t(key, values).split("\n");
        expect(message).toHaveLength(3);
        expect(message[0]).toContain("Lisboa");
        expect(message[1]).toBe("<days>");
        expect(message[2].endsWith(values.url)).toBe(true);
      }
      expect(t("shareDay", { n: 2, places: "A, B" })).toMatch(/^\S+ 2: A, B$/);
      expect(t("shareDayInCity", { n: 2, city: "Sintra", places: "A" })).toMatch(/^\S+ 2, Sintra: A$/);
      const one = t("shareMoreDays", { count: 1 });
      const two = t("shareMoreDays", { count: 2 });
      expect(one).toMatch(/\b1\b/);
      expect(two).toMatch(/\b2\b/);
      expect(one).not.toBe(two.replace("2", "1"));
    });
  }
});
