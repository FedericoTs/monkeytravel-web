import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import enTrips from "@/messages/en/trips.json";
import esTrips from "@/messages/es/trips.json";
import itTrips from "@/messages/it/trips.json";
import ptTrips from "@/messages/pt/trips.json";
import type { ValidationFix } from "@/lib/wizard/generation-failure";
import { MODEL_OUTAGE_MESSAGE } from "@/lib/ai/model-outage";
import GenerationErrorNotice from "./GenerationErrorNotice";

vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const TRIPS = { en: enTrips, es: esTrips, it: itTrips, pt: ptTrips } as const;
type Locale = keyof typeof TRIPS;
// Every fix: one added to ValidationFix fails the typecheck here until it is listed.
const FIXES = Object.keys({
  dates: 1, duration: 1, destination: 1, fixed_plans: 1, notes: 1, style: 1, other: 1,
} satisfies Record<ValidationFix, 1>) as ValidationFix[];

/** What the notice says for a refusal the traveller fixes with `fix`. */
function said(locale: Locale, fix: ValidationFix): string {
  const { container, unmount } = render(
    <NextIntlClientProvider locale={locale} messages={{ trips: TRIPS[locale] }} onError={() => {}}>
      <GenerationErrorNotice error="Refused" errorFix={fix} effectiveMaxTripDays={14} onAction={vi.fn()} />
    </NextIntlClientProvider>
  );
  const text = container.querySelector("p")?.textContent ?? "";
  unmount();
  return text;
}

describe("the planner out of service", () => {
  it.each(Object.keys(TRIPS) as Locale[])("is said in %s, with no English from the server", (locale) => {
    // With templates on, its way to them is in the page's language too.
    vi.stubEnv("NEXT_PUBLIC_TEMPLATES_ENABLED", "true");
    const { container, unmount } = render(
      <NextIntlClientProvider locale={locale} messages={{ trips: TRIPS[locale] }} onError={() => {}}>
        <GenerationErrorNotice error={MODEL_OUTAGE_MESSAGE} errorFix={null} effectiveMaxTripDays={14} onAction={vi.fn()} />
      </NextIntlClientProvider>
    );
    expect(container.querySelector("p")?.textContent).toBe(TRIPS[locale].generation.errorUnavailable);
    expect(container.querySelector("a")?.textContent).toBe(TRIPS[locale].generation.browseTemplates);
    expect(container.textContent).not.toContain(MODEL_OUTAGE_MESSAGE);
    unmount();
  });
});

describe("a refused generation's notice", () => {
  it("says what to change, for every fix in every language", () => {
    for (const locale of Object.keys(TRIPS) as Locale[]) {
      for (const fix of FIXES) {
        // A missing key falls back to its path.
        expect(said(locale, fix), `${locale} ${fix}`).not.toMatch(/^$|generation\.fix/);
      }
    }
  });

  it("asks for the travel style by the words step 2 uses", () => {
    expect(said("en", "style")).toBe("Check your travel style: choose one to three vibes and a budget, then try again.");
    expect(said("pt", "style")).toContain("climas");
  });
});
