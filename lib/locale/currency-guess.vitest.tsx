import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { currencyForLocale } from "./currency-guess";
import { LocaleProvider, useLocale } from "./context";

describe("the currency a browser's language points to", () => {
  it("is the region's own: English (India) is rupees, German (Switzerland) francs", () => {
    expect(currencyForLocale("en-IN")).toBe("INR");
    expect(currencyForLocale("de-CH")).toBe("CHF");
    expect(currencyForLocale("fr-BE")).toBe("EUR");
    expect(currencyForLocale("ca-ES")).toBe("EUR");
    expect(currencyForLocale("en-SG")).toBe("SGD");
    expect(currencyForLocale("zh-SG")).toBe("SGD");
    expect(currencyForLocale("en-ZA")).toBe("ZAR");
    expect(currencyForLocale("en-MY")).toBe("MYR");
    expect(currencyForLocale("en-PH")).toBe("PHP");
    expect(currencyForLocale("zh-Hant-HK")).toBe("HKD");
    expect(currencyForLocale("en-in")).toBe("INR");
    expect(currencyForLocale("en_IN")).toBe("INR");
  });

  it("keeps the list's own answer for a whole locale it names", () => {
    expect(currencyForLocale("en-US")).toBe("USD");
    expect(currencyForLocale("en-GB")).toBe("GBP");
    expect(currencyForLocale("es-AR")).toBe("ARS");
    expect(currencyForLocale("es-MX")).toBe("MXN");
  });

  it("is euros in Bulgaria, which pays in euros", () => {
    expect(currencyForLocale("bg-BG")).toBe("EUR");
  });

  it("follows a language with no region where it names one country's currency, and is dollars otherwise", () => {
    expect(currencyForLocale("it")).toBe("EUR");
    expect(currencyForLocale("de")).toBe("EUR");
    expect(currencyForLocale("pt")).toBe("BRL");
    expect(currencyForLocale("pl")).toBe("PLN");
    expect(currencyForLocale("ko")).toBe("KRW");
    expect(currencyForLocale("es")).toBe("USD");
    expect(currencyForLocale("en")).toBe("USD");
    expect(currencyForLocale("es-419")).toBe("USD");
    expect(currencyForLocale("")).toBe("USD");
  });

  it("is dollars for a region whose currency the rates don't convert, not the language's", () => {
    expect(currencyForLocale("es-CO")).toBe("USD");
    expect(currencyForLocale("fr-SN")).toBe("USD");
    expect(currencyForLocale("en-NG")).toBe("USD");
  });
});

function Shown() {
  const { preferences } = useLocale();
  return <p>{preferences.preferredCurrency}</p>;
}

describe("a visitor's prices", () => {
  const languages = Object.getOwnPropertyDescriptor(window.navigator, "languages");
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ base: "EUR", date: "2026-11-18", rates: { USD: 1.1, INR: 95 } }) })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (languages) Object.defineProperty(window.navigator, "languages", languages);
    else delete (window.navigator as { languages?: unknown }).languages;
  });

  it("are in rupees for a browser set to English (India)", async () => {
    Object.defineProperty(window.navigator, "languages", { value: ["en-IN"], configurable: true });
    render(
      <LocaleProvider>
        <Shown />
      </LocaleProvider>
    );
    await waitFor(() => expect(screen.getByText("INR")).toBeTruthy());
  });
});
