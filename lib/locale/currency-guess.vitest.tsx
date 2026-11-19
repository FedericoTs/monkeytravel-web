import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { currencyForCountry, currencyForLocale, followsCountry } from "./currency-guess";
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

describe("the currency of the country a visitor is in", () => {
  it("is that country's, when the rates convert it", () => {
    expect(currencyForCountry("IN")).toBe("INR");
    expect(currencyForCountry("MY")).toBe("MYR");
    expect(currencyForCountry("IT")).toBe("EUR");
    expect(currencyForCountry("in")).toBe("INR");
  });

  it("is none for a currency the rates don't convert, or no country", () => {
    expect(currencyForCountry("AE")).toBeNull();
    expect(currencyForCountry("PK")).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
    expect(currencyForCountry("")).toBeNull();
  });
});

describe("a browser language that says little about where its user is", () => {
  it("is English set to the United States or Britain, or English alone", () => {
    for (const locale of ["en-US", "en-GB", "en", "EN-us", "en_GB"]) expect(followsCountry(locale), locale).toBe(true);
  });

  it("isn't any language that names its place, or another language", () => {
    for (const locale of ["en-IN", "en-AU", "de-DE", "es", "en-US-x-test", "fr-FR", ""]) expect(followsCountry(locale), locale).toBe(false);
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

  /** The rates, and the country the server places the visitor in; every country question is counted. */
  const askedCountry = vi.fn();
  function serverSays(country: string | null) {
    askedCountry.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/locale/country")) {
          askedCountry();
          return { ok: true, json: async () => ({ country }) };
        }
        return { ok: true, json: async () => ({ base: "EUR", date: "2026-11-18", rates: { USD: 1.1, INR: 95, GBP: 0.85 } }) };
      })
    );
  }
  const browser = (language: string) => Object.defineProperty(window.navigator, "languages", { value: [language], configurable: true });
  const show = () =>
    render(
      <LocaleProvider>
        <Shown />
      </LocaleProvider>
    );

  it("are in rupees for English (United States) or English (Britain) in India", async () => {
    for (const language of ["en-US", "en-GB"]) {
      localStorage.clear();
      serverSays("IN");
      browser(language);
      const { unmount } = show();
      await waitFor(() => expect(screen.getByText("INR")).toBeTruthy());
      unmount();
    }
  });

  it("stay the browser's in its own country, or where the rates don't convert the country's currency", async () => {
    serverSays("US");
    browser("en-US");
    const us = show();
    await waitFor(() => expect(askedCountry).toHaveBeenCalledTimes(1));
    expect(screen.getByText("USD")).toBeTruthy();
    us.unmount();
    localStorage.clear();
    serverSays("AE");
    browser("en-GB");
    show();
    await waitFor(() => expect(askedCountry).toHaveBeenCalledTimes(1));
    expect(screen.getByText("GBP")).toBeTruthy();
  });

  it("follow a language that names its place, and ask nothing", async () => {
    serverSays("IN");
    browser("de-DE");
    show();
    await waitFor(() => expect(screen.getByText("EUR")).toBeTruthy());
    expect(askedCountry).not.toHaveBeenCalled();
  });

  it("keep a currency the visitor chose", async () => {
    localStorage.setItem(
      "monkeytravel-locale-prefs",
      JSON.stringify({ locale: "en-US", unitSystem: "metric", temperatureUnit: "celsius", distanceUnit: "metric", preferredCurrency: "GBP", detectedAt: 1, isManualOverride: true })
    );
    serverSays("IN");
    browser("en-US");
    show();
    await waitFor(() => expect(screen.getByText("GBP")).toBeTruthy());
    expect(askedCountry).not.toHaveBeenCalled();
  });

  it("keep a currency chosen while the country is asked", async () => {
    let answer: (country: string) => void = () => {};
    askedCountry.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/locale/country")) {
          askedCountry();
          const country = await new Promise<string>((resolve) => {
            answer = resolve;
          });
          return { ok: true, json: async () => ({ country }) };
        }
        return { ok: true, json: async () => ({ base: "EUR", date: "2026-11-18", rates: { USD: 1.1, INR: 95, GBP: 0.85 } }) };
      })
    );
    browser("en-US");
    function Chooser() {
      const { preferences, setPreferredCurrency } = useLocale();
      return <button onClick={() => setPreferredCurrency("GBP")}>{preferences.preferredCurrency}</button>;
    }
    render(
      <LocaleProvider>
        <Chooser />
      </LocaleProvider>
    );
    await waitFor(() => expect(askedCountry).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button"));
    await act(async () => {
      answer("IN");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByRole("button").textContent).toBe("GBP");
  });

  it("ask the country once a day, and use the answer kept meanwhile", async () => {
    serverSays("IN");
    browser("en-US");
    const first = show();
    await waitFor(() => expect(screen.getByText("INR")).toBeTruthy());
    first.unmount();
    show();
    expect(screen.getByText("INR")).toBeTruthy();
    expect(askedCountry).toHaveBeenCalledTimes(1);
    cleanup();
    const kept = JSON.parse(localStorage.getItem("monkeytravel-visitor-country") ?? "{}");
    localStorage.setItem("monkeytravel-visitor-country", JSON.stringify({ ...kept, at: Date.now() - 25 * 60 * 60 * 1000 }));
    show();
    await waitFor(() => expect(askedCountry).toHaveBeenCalledTimes(2));
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
