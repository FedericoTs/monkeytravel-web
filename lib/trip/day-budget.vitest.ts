import { describe, it, expect } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { dayBudgetLabel, showsDayBudget } from "./day-budget";

const act = (amount?: number, currency?: string): Activity =>
  ({
    name: "x",
    estimated_cost: amount === undefined ? undefined : { amount, currency, tier: "moderate" },
  }) as unknown as Activity;

const day = (...activities: Activity[]): ItineraryDay =>
  ({ day_number: 1, date: "2027-05-10", activities }) as ItineraryDay;

const format = (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`;

// Rates into EUR, as useCurrency() converts once exchange rates have loaded.
const RATES: Record<string, number> = { EUR: 1, JPY: 0.006, USD: 0.9 };
const loaded = {
  convert: (amount: number, from: string) => ({ value: amount * RATES[from], currency: "EUR" }),
  format,
};
// Before rates load, the converter hands back the source amount in its own currency.
const unloaded = {
  convert: (amount: number, from: string) => ({ value: amount, currency: from }),
  format,
};

describe("dayBudgetLabel", () => {
  it("sums the activities' converted costs in the currency the converter returns", () => {
    expect(dayBudgetLabel(day(act(10000, "JPY"), act(20, "USD")), loaded, "Free")).toBe("EUR 78.00");
  });

  it("keeps an unconverted total in its own currency until rates load", () => {
    expect(dayBudgetLabel(day(act(10000, "JPY"), act(17600, "JPY")), unloaded, "Free")).toBe("JPY 27600.00");
  });

  it("formats a mixed day in the first costed activity's currency", () => {
    const mixed = {
      convert: (amount: number, from: string) =>
        from === "JPY" ? { value: amount, currency: "JPY" } : { value: amount * RATES[from], currency: "EUR" },
      format,
    };
    expect(dayBudgetLabel(day(act(), act(1000, "JPY"), act(10, "USD")), mixed, "Free")).toBe("JPY 1009.00");
  });

  it("skips activities with no cost, a zero amount or no currency", () => {
    expect(dayBudgetLabel(day(act(), act(0, "EUR"), act(15, undefined), act(12, "EUR")), loaded, "Free")).toBe(
      "EUR 12.00"
    );
  });

  it("says free when nothing on the day costs anything", () => {
    expect(dayBudgetLabel(day(), loaded, "Free")).toBe("Free");
    expect(dayBudgetLabel(day(act(), act(0, "EUR")), loaded, "Gratis")).toBe("Gratis");
  });

  it("ignores the stored daily_budget, which is in the activities' source currency", () => {
    const withStored = {
      ...day(act(40, "EUR")),
      daily_budget: { total: 27600, breakdown: { activities: 27600, food: 0, transport: 0 } },
    } as ItineraryDay;
    expect(dayBudgetLabel(withStored, loaded, "Free")).toBe("EUR 40.00");
  });
});

describe("showsDayBudget", () => {
  it("shows the budget only for days that carry a stored daily_budget", () => {
    expect(showsDayBudget(day(act(40, "EUR")))).toBe(false);
    const stored = { ...day(), daily_budget: { total: 0, breakdown: { activities: 0, food: 0, transport: 0 } } } as ItineraryDay;
    expect(showsDayBudget(stored)).toBe(true);
  });
});
