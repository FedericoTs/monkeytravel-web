import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enTrips from "@/messages/en/trips.json";
import esTrips from "@/messages/es/trips.json";
import itTrips from "@/messages/it/trips.json";
import ptTrips from "@/messages/pt/trips.json";
import type { KeptPlanEntry } from "@/lib/plans/kept-plans-client";
import { KeptPlansList } from "./KeptPlansList";

afterEach(cleanup);

const TRIPS = { en: enTrips, es: esTrips, it: itTrips, pt: ptTrips } as const;

const entry = (token: string, over: Partial<KeptPlanEntry> = {}): KeptPlanEntry => ({
  token,
  destination: "Tokyo, Japan",
  startDate: "2027-04-02",
  endDate: "2027-04-11",
  dayCount: 10,
  expiresAt: "2099-01-01T00:00:00.000Z",
  ...over,
});

function list(locale: keyof typeof TRIPS, plans: KeptPlanEntry[]) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ trips: TRIPS[locale] }} onError={() => {}}>
      <KeptPlansList plans={plans} locale={locale} opening={null} onOpen={vi.fn()} />
    </NextIntlClientProvider>
  );
}

describe("KeptPlansList", () => {
  it("tells the plan they changed from a newer one for the same trip", () => {
    list("en", [entry("NEWxxxxxxxxxxxxxxxxxxx"), entry("EDITEDxxxxxxxxxxxxxxxx", { changed: true })]);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].textContent).not.toContain("With your changes");
    expect(buttons[1].textContent).toContain("With your changes");
  });

  it.each([
    ["es", "Con tus cambios"],
    ["it", "Con le tue modifiche"],
    ["pt", "Com suas alterações"],
  ] as const)("says it in %s", (locale, words) => {
    list(locale, [entry("EDITEDxxxxxxxxxxxxxxxx", { changed: true })]);
    expect(screen.getByRole("button").textContent).toContain(words);
  });
});
