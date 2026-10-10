import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enTrips from "@/messages/en/trips.json";
import esTrips from "@/messages/es/trips.json";
import itTrips from "@/messages/it/trips.json";
import ptTrips from "@/messages/pt/trips.json";
import ValuePropositionBanner from "./ValuePropositionBanner";

/**
 * The save banner on the wizard's result page, right before the save step. It
 * used to be hard-coded English for every visitor.
 */
const TRIPS = { en: enTrips, es: esTrips, it: itTrips, pt: ptTrips } as const;
type Locale = keyof typeof TRIPS;

const ENGLISH = [
  "Save to unlock more",
  "Full editing & AI features",
  "Trip reminders",
  "Packing and visa nudges before you go",
  "Full Editing",
  "Customize every detail",
  "Share & Export",
  "PDF, calendar sync",
  "Save & Start Editing",
  "Saving Your Trip...",
  "Save Trip & Unlock Features",
  "Your trip will be saved to your account",
  "Saving...",
  "Dismiss",
];

function renderBanner(locale: Locale, variant: "inline" | "sticky-bottom", isSaving = false) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ trips: TRIPS[locale] }}>
      <ValuePropositionBanner onSave={() => {}} isSaving={isSaving} variant={variant} />
    </NextIntlClientProvider>
  );
}

/** Visible text plus accessible labels, the way a reader or screen reader meets it. */
function textOf(container: HTMLElement): string {
  const labels = [...container.querySelectorAll("[aria-label]")].map((el) => el.getAttribute("aria-label"));
  return [container.textContent, ...labels].join(" | ");
}

beforeEach(() => localStorage.clear());

describe("ValuePropositionBanner", () => {
  it.each(["es", "it", "pt"] as const)("%s shows no English in either variant", (locale) => {
    for (const variant of ["inline", "sticky-bottom"] as const) {
      for (const isSaving of [false, true]) {
        const { container, unmount } = renderBanner(locale, variant, isSaving);
        const text = textOf(container);
        for (const english of ENGLISH) expect(text).not.toContain(english);
        unmount();
      }
    }
  });

  it.each(Object.keys(TRIPS) as Locale[])("%s renders its own copy", (locale) => {
    const copy = TRIPS[locale].wizard.result.valueBanner;
    const inline = textOf(renderBanner(locale, "inline").container);
    for (const key of ["title", "subtitle", "remindersTitle", "remindersBody", "editingTitle", "shareBody", "cta", "dismiss"] as const) {
      expect(inline).toContain(copy[key]);
    }
    const saving = textOf(renderBanner(locale, "inline", true).container);
    expect(saving).toContain(copy.saving);
    const sticky = textOf(renderBanner(locale, "sticky-bottom").container);
    for (const key of ["stickyCta", "stickyHint", "remindersTitle", "shareTitle"] as const) {
      expect(sticky).toContain(copy[key]);
    }
  });

  it("reads naturally in Italian", () => {
    renderBanner("it", "inline");
    expect(screen.getByRole("heading", { name: "Salva e sblocca di più" })).toBeTruthy();
    expect(screen.getByText("Promemoria di viaggio")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salva e inizia a modificare" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chiudi" })).toBeTruthy();
  });
});
