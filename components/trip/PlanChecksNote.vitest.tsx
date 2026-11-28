import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enTrips from "@/messages/en/trips.json";
import esTrips from "@/messages/es/trips.json";
import itTrips from "@/messages/it/trips.json";
import ptTrips from "@/messages/pt/trips.json";
import PlanChecksNote from "./PlanChecksNote";

/**
 * A reader of the plan was told nothing of what had been checked for their dates: the plan's best work was silent.
 * The line says it in the plan's own counts, and says nothing when there are none.
 */

const ALL = { en: enTrips, es: esTrips, it: itTrips, pt: ptTrips } as const;
const say = (checked: unknown, locale: keyof typeof ALL = "en") => {
  render(
    <NextIntlClientProvider locale={locale} messages={{ trips: ALL[locale] }}>
      <PlanChecksNote checked={checked} />
    </NextIntlClientProvider>,
  );
  return screen.queryByTestId("plan-checks")?.textContent ?? null;
};

afterEach(cleanup);

describe("what the plan says was checked", () => {
  it("says how many sights' closing days were looked at, and that none was on one", () => {
    expect(say({ sights: 9, shut: 0, fixed: 0, left: 0 })).toBe("Closing days checked for your dates: 9 sights. We found none planned on a closing day.");
  });

  it("says what was put right", () => {
    expect(say({ sights: 9, shut: 2, fixed: 2, left: 0 })).toBe("Closing days checked for your dates: 9 sights. 2 were planned on a closing day and have been fixed.");
    cleanup();
    expect(say({ sights: 1, shut: 1, fixed: 1, left: 0 })).toBe("Closing days checked for your dates: 1 sight. 1 was planned on a closing day and has been fixed.");
  });

  it("says what is still on a day it's shut, and where to read why", () => {
    expect(say({ sights: 5, shut: 1, fixed: 0, left: 1 })).toBe("Closing days checked for your dates: 5 sights. 1 is still on a closing day: see its note.");
    cleanup();
    expect(say({ sights: 5, shut: 2, fixed: 0, left: 2 })).toBe("Closing days checked for your dates: 5 sights. 2 are still on a closing day: see their notes.");
  });

  it("says both when some were put right and some weren't", () => {
    expect(say({ sights: 9, shut: 3, fixed: 2, left: 1 })).toBe(
      "Closing days checked for your dates: 9 sights. 2 were planned on a closing day and have been fixed; 1 still is: see its note.",
    );
  });

  it("says nothing for a plan that carries no count", () => {
    for (const none of [undefined, null, {}, { sights: 0, shut: 0, fixed: 0, left: 0 }, "checked"]) {
      expect(say(none)).toBeNull();
      cleanup();
    }
  });

  it("says it in the reader's language", () => {
    expect(say({ sights: 9, shut: 2, fixed: 2, left: 0 }, "it")).toBe(
      "Giorni di chiusura controllati per le tue date: 9 luoghi. 2 erano in un giorno di chiusura e li abbiamo sistemati.",
    );
    cleanup();
    expect(say({ sights: 4, shut: 0, fixed: 0, left: 0 }, "es")).toBe("Días de cierre comprobados para tus fechas: 4 lugares. No encontramos ninguno en un día de cierre.");
    cleanup();
    expect(say({ sights: 4, shut: 1, fixed: 0, left: 1 }, "pt")).toBe("Dias de fechamento conferidos para as suas datas: 4 lugares. 1 continua em um dia de fechamento: veja a nota dele.");
  });

  it("has every sentence in every language, each with the counts it needs", () => {
    for (const [locale, messages] of Object.entries(ALL)) {
      const words = messages.wizard.result.checked as Record<string, string>;
      expect(Object.keys(words).sort(), locale).toEqual(["fixed", "fixedAndLeft", "lead", "left", "noneShut"]);
      for (const key of ["lead", "fixed", "left"]) expect(words[key], `${locale} ${key}`).toContain("{count, plural,");
      expect(words.fixedAndLeft, locale).toContain("{fixed, plural,");
      expect(words.fixedAndLeft, locale).toContain("{left, plural,");
      expect(words.noneShut.trim().length, locale).toBeGreaterThan(10);
    }
  });
});
