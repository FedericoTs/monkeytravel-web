import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GeneratedItinerary } from "@/types";

const getExchangeRates = vi.fn();
vi.mock("@/lib/locale/currency", () => ({ getExchangeRates }));

const { convertAmount, inPlanCurrency, pricedOtherwise, withPricesIn } = await import("./plan-currency");

// Units per US dollar.
const RATES = { base: "USD", rates: { EUR: 0.9, JPY: 150, INR: 85 } };

const price = (amount: number, currency: string) => ({ amount, currency, tier: "moderate" as const });

function plan(prices: Array<{ amount: number; currency: string } | undefined>, total = { amount: 450, currency: "USD" }) {
  return {
    destination: { name: "Paris", country: "France", description: "", best_for: [], weather_note: "" },
    days: [
      {
        day_number: 1,
        date: "2027-03-10",
        theme: "",
        activities: prices.map((p, i) => ({ name: `Place ${i}`, ...(p ? { estimated_cost: price(p.amount, p.currency) } : {}) })),
      },
    ],
    trip_summary: { total_estimated_cost: total.amount, currency: total.currency, highlights: [], packing_suggestions: [] },
  } as unknown as GeneratedItinerary;
}

const costs = (it: GeneratedItinerary) => it.days[0].activities.map((a) => a.estimated_cost && `${a.estimated_cost.amount} ${a.estimated_cost.currency}`);

describe("convertAmount", () => {
  it("converts from and to the table's base, and across it", () => {
    expect(convertAmount(90, "EUR", "USD", RATES)).toBeCloseTo(100);
    expect(convertAmount(100, "USD", "JPY", RATES)).toBeCloseTo(15000);
    expect(convertAmount(150, "JPY", "EUR", RATES)).toBeCloseTo(0.9);
    expect(convertAmount(12, "EUR", "EUR", RATES)).toBe(12);
  });

  it("can't convert a currency the table lacks", () => {
    expect(convertAmount(300, "TWD", "USD", RATES)).toBeNull();
    expect(convertAmount(300, "USD", "TWD", RATES)).toBeNull();
  });
});

describe("pricedOtherwise", () => {
  it("finds a price, or the total, in another currency", () => {
    expect(pricedOtherwise(plan([{ amount: 20, currency: "USD" }, undefined]), "USD")).toBe(false);
    expect(pricedOtherwise(plan([{ amount: 20, currency: "USD" }, { amount: 18, currency: "EUR" }]), "USD")).toBe(true);
    expect(pricedOtherwise(plan([{ amount: 20, currency: "USD" }], { amount: 400, currency: "EUR" }), "USD")).toBe(true);
  });
});

describe("withPricesIn", () => {
  it("puts every price and the total in one currency, in whole units", () => {
    const out = withPricesIn(
      plan([{ amount: 18, currency: "EUR" }, { amount: 2000, currency: "JPY" }, { amount: 25, currency: "USD" }], { amount: 405, currency: "EUR" }),
      "USD",
      RATES
    );
    expect(costs(out)).toEqual(["20 USD", "13 USD", "25 USD"]);
    expect(out.trip_summary).toMatchObject({ total_estimated_cost: 450, currency: "USD" });
    expect(out.days[0].activities[0].estimated_cost.tier).toBe("moderate");
  });

  it("keeps free things free, and never rounds a price down to free", () => {
    const out = withPricesIn(plan([{ amount: 0, currency: "EUR" }, { amount: 30, currency: "INR" }]), "USD", RATES);
    expect(costs(out)).toEqual(["0 USD", "1 USD"]);
  });

  it("leaves a price in a currency the table lacks as it is", () => {
    const out = withPricesIn(plan([{ amount: 300, currency: "TWD" }, { amount: 18, currency: "EUR" }], { amount: 9000, currency: "TWD" }), "USD", RATES);
    expect(costs(out)).toEqual(["300 TWD", "20 USD"]);
    expect(out.trip_summary).toMatchObject({ total_estimated_cost: 9000, currency: "TWD" });
  });

  it("prices into the trip's own currency too", () => {
    expect(costs(withPricesIn(plan([{ amount: 10, currency: "USD" }]), "EUR", RATES))).toEqual(["9 EUR"]);
  });
});

describe("inPlanCurrency", () => {
  beforeEach(() => {
    getExchangeRates.mockReset();
  });

  it("fetches no rates for a plan already in dollars", async () => {
    const trip = plan([{ amount: 20, currency: "USD" }]);
    expect(await inPlanCurrency(trip)).toBe(trip);
    expect(getExchangeRates).not.toHaveBeenCalled();
  });

  it("converts a plan written partly in another currency with the day's dollar rates", async () => {
    getExchangeRates.mockResolvedValue(RATES);
    const out = await inPlanCurrency(plan([{ amount: 18, currency: "EUR" }, { amount: 25, currency: "USD" }]));
    expect(getExchangeRates).toHaveBeenCalledWith("USD");
    expect(costs(out)).toEqual(["20 USD", "25 USD"]);
  });

  it("keeps the plan as written when the rates can't be had", async () => {
    getExchangeRates.mockImplementation(async () => {
      throw new Error("API error: 503");
    });
    const out = await inPlanCurrency(plan([{ amount: 18, currency: "EUR" }]));
    expect(costs(out)).toEqual(["18 EUR"]);
  });
});
