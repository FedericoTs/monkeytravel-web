import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enTrips from "@/messages/en/trips.json";
import esTrips from "@/messages/es/trips.json";
import itTrips from "@/messages/it/trips.json";
import ptTrips from "@/messages/pt/trips.json";
import type { Step1Blocker } from "@/lib/wizard/step1-gate";
import WizardFooter from "./WizardFooter";

afterEach(cleanup);

const TRIPS = { en: enTrips, es: esTrips, it: itTrips, pt: ptTrips } as const;
type Locale = keyof typeof TRIPS;
const LOCALES = Object.keys(TRIPS) as Locale[];
const BLOCKERS: Step1Blocker[] = ["short", "long", "chars", "too_many_days", "dates", "past"];

/** The hint step 1's footer gives for `block`, as a traveller reads it. */
function hint(locale: Locale, block: Step1Blocker, readOffered = false): string {
  const { container, unmount } = render(
    <NextIntlClientProvider locale={locale} messages={{ trips: TRIPS[locale] }} onError={() => {}}>
      <WizardFooter
        footerRef={createRef()}
        step={1}
        setStep={vi.fn()}
        totalSteps={2}
        expressTrip={false}
        canProceed={() => false}
        footerStateB={false}
        step1Block={block}
        effectiveMaxTripDays={14}
        isAuthenticated={false}
        handleExpressPlan={vi.fn(async () => {})}
        expressBusy={false}
        handleFlexibleDates={vi.fn()}
        setDatesPencilled={vi.fn()}
        handleContinue={vi.fn()}
        handleGenerate={vi.fn(async () => {})}
        readOffered={readOffered}
      />
    </NextIntlClientProvider>
  );
  const text = container.querySelector('p[aria-live="polite"]')?.textContent ?? "";
  unmount();
  return text;
}

describe("step 1's footer", () => {
  it("leaves the way forward to the offer to read a whole trip typed as the destination", () => {
    expect(hint("en", "chars", true)).toBe("");
    expect(hint("en", "chars")).not.toBe("");
  });

  it("says a trip that starts before today has to move", () => {
    expect(hint("en", "past")).toBe("Your trip has to start today or later");
    expect(hint("es", "past")).toBe("El viaje tiene que empezar hoy o más adelante");
    expect(hint("it", "past")).toBe("Il viaggio deve iniziare oggi o più avanti");
    expect(hint("pt", "past")).toBe("A viagem precisa começar hoje ou depois");
  });

  it("has words for every blocker in every language", () => {
    for (const locale of LOCALES) {
      for (const block of BLOCKERS) {
        const text = hint(locale, block);
        // A missing hint or key falls back to the namespace or the key's path.
        expect(text, `${locale} ${block}`).not.toMatch(/^$|^trips(\.|$)|wizard\./);
      }
    }
  });
});

describe("the footer's main button", () => {
  /** The main button at `step`, for a traveller who can go on. */
  function mainButton(step: 1 | 2): HTMLButtonElement {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ trips: TRIPS.en }} onError={() => {}}>
        <WizardFooter
          footerRef={createRef()}
          step={step}
          setStep={vi.fn()}
          totalSteps={2}
          expressTrip={false}
          canProceed={() => true}
          footerStateB={false}
          step1Block={null}
          effectiveMaxTripDays={14}
          isAuthenticated={false}
          handleExpressPlan={vi.fn(async () => {})}
          expressBusy={false}
          handleFlexibleDates={vi.fn()}
          setDatesPencilled={vi.fn()}
          handleContinue={vi.fn()}
          handleGenerate={vi.fn(async () => {})}
        />
      </NextIntlClientProvider>
    );
    const label = step === 1 ? TRIPS.en.wizard.step1.continue : TRIPS.en.wizard.step2.generate;
    return [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;
  }

  it.each([1, 2] as const)("is coral with a white label on step %i", (step) => {
    const button = mainButton(step);
    expect(button.className).toContain("bg-[var(--primary)]");
    expect(button.className).toContain("text-white");
    expect(button.className).not.toContain("var(--accent)");
  });
});

// A whole trip typed as the destination that can't go on as typed ("… a show at 21:30") kept Continue greyed out
// with no word of why, the dates set and nothing left to do.
describe("Continue on a whole trip typed as the destination", () => {
  function continueButton(props: { canProceed: boolean; readOffered: boolean; readingRequest?: boolean }) {
    const handleContinue = vi.fn();
    const onReadRequest = vi.fn();
    const { getByTestId } = render(
      <NextIntlClientProvider locale="en" messages={{ trips: TRIPS.en }} onError={() => {}}>
        <WizardFooter
          footerRef={createRef()}
          step={1}
          setStep={vi.fn()}
          totalSteps={2}
          expressTrip={false}
          canProceed={() => props.canProceed}
          footerStateB={false}
          step1Block={props.canProceed ? null : "chars"}
          effectiveMaxTripDays={14}
          isAuthenticated={false}
          handleExpressPlan={vi.fn(async () => {})}
          expressBusy={false}
          handleFlexibleDates={vi.fn()}
          setDatesPencilled={vi.fn()}
          handleContinue={handleContinue}
          handleGenerate={vi.fn(async () => {})}
          readOffered={props.readOffered}
          onReadRequest={onReadRequest}
          readingRequest={props.readingRequest ?? false}
        />
      </NextIntlClientProvider>
    );
    return { button: getByTestId("wizard-continue") as HTMLButtonElement, handleContinue, onReadRequest };
  }

  it("reads it when pressed, instead of standing greyed out", () => {
    const { button, handleContinue, onReadRequest } = continueButton({ canProceed: false, readOffered: true });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onReadRequest).toHaveBeenCalledTimes(1);
    expect(handleContinue).not.toHaveBeenCalled();
  });

  it("waits while it is being read", () => {
    const { button } = continueButton({ canProceed: false, readOffered: true, readingRequest: true });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  // "5 days in Madrid, 4 days in Seville, 3 days in Granada", with the dates picked, could go on as typed, and would be
  // planned as one place named by the whole sentence: the cities' days mixed up, and no ride between them.
  it("reads it too when it could go on as typed", () => {
    const { button, handleContinue, onReadRequest } = continueButton({ canProceed: true, readOffered: true });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onReadRequest).toHaveBeenCalledTimes(1);
    expect(handleContinue).not.toHaveBeenCalled();
  });

  it("goes on as before when nothing is offered to be read", () => {
    const ready = continueButton({ canProceed: true, readOffered: false });
    fireEvent.click(ready.button);
    expect(ready.handleContinue).toHaveBeenCalledTimes(1);
    expect(ready.onReadRequest).not.toHaveBeenCalled();
    cleanup();
    const blocked = continueButton({ canProceed: false, readOffered: false });
    expect(blocked.button.disabled).toBe(true);
    expect(blocked.button.hasAttribute("aria-busy")).toBe(false);
  });
});
