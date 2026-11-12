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

  it("reads a request with no verb, as two planners sent it", () => {
    expect(currencyRequested("In euro, not usd. I arrive at 10 am to Malaga. Then breakfast, after a small visit.")).toBe("EUR");
    expect(currencyRequested("In Euro, not Usd")).toBe("EUR");
    expect(currencyRequested("in euros please")).toBe("EUR");
    expect(currencyRequested("euros, not dollars")).toBe("EUR");
    expect(currencyRequested("Prezzi in euro, non in dollari")).toBe("EUR");
    expect(currencyRequested("GBP")).toBe("GBP");
  });

  it("answers a question about the currency instead of switching it", () => {
    expect(currencyRequested("Los precios son en pesos mexicanos?")).toBeNull();
    expect(currencyRequested("Are the prices in euros?")).toBeNull();
    expect(currencyRequested("I prezzi sono in euro?")).toBeNull();
    expect(currencyRequested("Os preços estão em reais?")).toBeNull();
    expect(currencyRequested("Is the budget in US dollars? 🤔")).toBeNull();
  });

  it("still switches on a request asked as a question, or with no verb", () => {
    expect(currencyRequested("Can you show the prices in euros?")).toBe("EUR");
    expect(currencyRequested("¿Puedes poner los precios en pesos mexicanos?")).toBe("MXN");
    expect(currencyRequested("Potresti mettere i prezzi in euro?")).toBe("EUR");
    expect(currencyRequested("Pode mostrar os preços em reais?")).toBe("BRL");
    expect(currencyRequested("Is it possible to see the prices in euros?")).toBe("EUR");
    expect(currencyRequested("euros?")).toBe("EUR");
    expect(currencyRequested("exiba os custos em euros")).toBe("EUR");
    expect(currencyRequested("exiba em euros")).toBe("EUR");
    // Not a question: no question mark.
    expect(currencyRequested("Day 2 is great. In euros, not dollars")).toBe("EUR");
  });

  it("leaves amounts and places alone", () => {
    expect(currencyRequested("In Rome we want to see the Colosseum")).toBeNull();
    expect(currencyRequested("We land in Lisbon at 10")).toBeNull();
    expect(currencyRequested("In $100 a day, what can we do?")).toBeNull();
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
