import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import enTrips from "@/messages/en/trips.json";
import esTrips from "@/messages/es/trips.json";
import itTrips from "@/messages/it/trips.json";
import ptTrips from "@/messages/pt/trips.json";
import { usePaceLabel } from "./pace";

/**
 * The planner's result showed the stored pace word ("Moderate") under "Ritmo"
 * in every language. It now uses the labels of the wizard's pace buttons.
 */
const TRIPS = { en: enTrips, es: esTrips, it: itTrips, pt: ptTrips } as const;

function paceLabel(locale: keyof typeof TRIPS) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={{ trips: TRIPS[locale] }}>
      {children}
    </NextIntlClientProvider>
  );
  return renderHook(() => usePaceLabel(), { wrapper }).result.current;
}

describe("usePaceLabel", () => {
  it("reads in Italian", () => {
    const label = paceLabel("it");
    expect(label("relaxed")).toBe("Rilassato");
    expect(label("moderate")).toBe("Moderato");
    expect(label("active")).toBe("Attivo");
  });

  it("uses the pace buttons' own labels in every locale", () => {
    for (const locale of ["en", "es", "it", "pt"] as const) {
      const label = paceLabel(locale);
      for (const pace of ["relaxed", "moderate", "active"] as const) {
        expect(label(pace)).toBe(TRIPS[locale].pace[pace].label);
      }
    }
  });

  it("labels a legacy or missing pace as the pace it is treated as", () => {
    const label = paceLabel("pt");
    expect(label("packed")).toBe(ptTrips.pace.active.label);
    expect(label(null)).toBe(ptTrips.pace.moderate.label);
    expect(label(undefined)).toBe(ptTrips.pace.moderate.label);
  });

  it("keeps English for English visitors", () => {
    expect(paceLabel("en")("moderate")).toBe("Moderate");
  });
});
