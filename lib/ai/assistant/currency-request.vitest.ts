/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { currencyRequested, currencySwitchedNote } from "./currency-request";

describe("currencyRequested", () => {
  it("reads the requests a planner actually sent", () => {
    expect(currencyRequested("Include a day trip to colmar and add colmar's sites. convert budget currency to Euros.")).toBe("EUR");
    expect(currencyRequested("Convert budget estimates from USD to Euros")).toBe("EUR");
    expect(currencyRequested("Remove dollar sign and add euro sign everywhere")).toBe("EUR");
  });

  it("understands the four languages and ISO codes", () => {
    expect(currencyRequested("Show prices in GBP")).toBe("GBP");
    expect(currencyRequested("convert everything to usd")).toBe("USD");
    expect(currencyRequested("Pon los precios en euros")).toBe("EUR");
    expect(currencyRequested("Cambia la moneda a dólares")).toBe("USD");
    expect(currencyRequested("Metti i prezzi in euro")).toBe("EUR");
    expect(currencyRequested("Converti il budget in sterline")).toBe("GBP");
    expect(currencyRequested("Mostre os preços em reais")).toBe("BRL");
    expect(currencyRequested("Converta para euros")).toBe("EUR");
    expect(currencyRequested("usa il simbolo dell'euro")).toBe("EUR");
    expect(currencyRequested("Show the budget in canadian dollars")).toBe("CAD");
  });

  it("leaves amounts and places alone", () => {
    expect(currencyRequested("Add a restaurant under 30 euros on day 2")).toBeNull();
    expect(currencyRequested("Make day 3 cheaper, max 50 dollars a day")).toBeNull();
    expect(currencyRequested("Is 100 euros a day enough?")).toBeNull();
    expect(currencyRequested("Add a day trip to Colmar")).toBeNull();
    expect(currencyRequested("Add a stop in Europe on day 4")).toBeNull();
    expect(currencyRequested("I want to try local food on day 2")).toBeNull();
    expect(currencyRequested("I want to try local food, and show prices in TRY")).toBe("TRY");
    expect(currencyRequested("")).toBeNull();
  });
});

describe("currencySwitchedNote", () => {
  it("says what changed, in the planner's language", () => {
    expect(currencySwitchedNote("en", "EUR")).toBe("Done: prices now show in EUR.");
    expect(currencySwitchedNote("it", "EUR")).toBe("Fatto: ora i prezzi sono mostrati in EUR.");
  });
});
