import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("puts the latest plan first, as a card with one button that opens it", () => {
    const onOpen = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ trips: TRIPS.en }} onError={() => {}}>
        <KeptPlansList plans={[entry("LATESTxxxxxxxxxxxxxxxx")]} locale="en" opening={null} onOpen={onOpen} />
      </NextIntlClientProvider>
    );
    const card = document.querySelector("[data-kept-plan-card]")!;
    expect(card.textContent).toContain("Your Tokyo plan");
    expect(card.textContent).toContain("Apr 2 – Apr 11 · 10 days");
    fireEvent.click(screen.getByRole("button", { name: "Open my plan" }));
    expect(onOpen).toHaveBeenCalledWith("LATESTxxxxxxxxxxxxxxxx", "card");
    expect(screen.queryByText("Your other plans")).toBeNull();
  });

  it("lists up to two older plans under it, each opened from the list", () => {
    const onOpen = vi.fn();
    const plans = [entry("Axxxxxxxxxxxxxxxxxxxxx"), entry("Bxxxxxxxxxxxxxxxxxxxxx", { destination: "Kyoto, Japan" }), entry("Cxxxxxxxxxxxxxxxxxxxxx", { destination: "Osaka, Japan" }), entry("Dxxxxxxxxxxxxxxxxxxxxx", { destination: "Nara, Japan" })];
    render(
      <NextIntlClientProvider locale="en" messages={{ trips: TRIPS.en }} onError={() => {}}>
        <KeptPlansList plans={plans} locale="en" opening={null} onOpen={onOpen} />
      </NextIntlClientProvider>
    );
    expect(screen.getByText("Your other plans")).toBeTruthy();
    const older = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(older).toHaveLength(2);
    expect(older[0]).toContain("Kyoto");
    expect(older[1]).toContain("Osaka");
    fireEvent.click(screen.getAllByRole("listitem")[0].querySelector("button")!);
    expect(onOpen).toHaveBeenCalledWith("Bxxxxxxxxxxxxxxxxxxxxx", "list");
  });

  it("tells the plan they changed from a newer one for the same trip", () => {
    list("en", [entry("NEWxxxxxxxxxxxxxxxxxxx"), entry("EDITEDxxxxxxxxxxxxxxxx", { changed: true })]);
    expect(document.querySelector("[data-kept-plan-card]")!.textContent).not.toContain("With your changes");
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("With your changes");
  });

  it.each([
    ["es", "Tu plan para Tokyo", "Abrir mi plan", "Con tus cambios"],
    ["it", "Il tuo piano per Tokyo", "Apri il mio piano", "Con le tue modifiche"],
    ["pt", "Seu plano para Tokyo", "Abrir meu plano", "Com suas alterações"],
  ] as const)("says it in %s", (locale, title, open, changed) => {
    list(locale, [entry("EDITEDxxxxxxxxxxxxxxxx", { changed: true })]);
    const card = document.querySelector("[data-kept-plan-card]")!.textContent;
    expect(card).toContain(title);
    expect(card).toContain(changed);
    expect(screen.getByRole("button").textContent).toBe(open);
  });
});
