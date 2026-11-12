/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import type { ItineraryDay } from "@/types";
import { displayCurrencyFor, inPlanCurrency, planCosts, planCurrency } from "./plan-costs";

/**
 * The trip assistant quotes these figures instead of adding the plan up
 * itself, so they must match what the page shows.
 */

const act = (amount: number | undefined, currency = "USD") => ({
  name: "Place",
  estimated_cost: amount === undefined ? undefined : { amount, currency, tier: "moderate" },
});
const day = (n: number, amounts: Array<number | undefined>, currency = "USD") =>
  ({ day_number: n, activities: amounts.map((a) => act(a, currency)) }) as unknown as ItineraryDay;

describe("planCosts", () => {
  it("adds up each day and the whole plan", () => {
    const costs = planCosts([day(1, [20, 35.4]), day(2, [0, 12]), day(3, [undefined])]);
    expect(costs).toEqual({
      currency: "USD",
      perDay: [
        { day: 1, amount: 55 },
        { day: 2, amount: 12 },
        { day: 3, amount: 0 },
      ],
      total: 67,
    });
  });

  it("also gives the figures in the currency the traveller sees", () => {
    const costs = planCosts([day(1, [100]), day(2, [50])], { currency: "EUR", rate: 0.9 });
    expect(costs?.shown).toEqual({
      currency: "EUR",
      perDay: [
        { day: 1, amount: 90 },
        { day: 2, amount: 45 },
      ],
      total: 135,
    });
  });

  it("needs no second view when the page shows the plan's own currency", () => {
    expect(planCosts([day(1, [100])], { currency: "USD", rate: 1 })?.shown).toBeUndefined();
  });

  it("is null for a plan that prices nothing", () => {
    expect(planCosts([day(1, [undefined, 0])])).toBeNull();
  });

  it("takes the plan's currency from its first priced activity", () => {
    expect(planCurrency([day(1, [10], "JPY")])).toBe("JPY");
    expect(planCurrency([day(1, [undefined])])).toBe("USD");
  });
});

describe("inPlanCurrency", () => {
  // One euro buys 1.25 dollars or 20 rand.
  const rates = { base: "EUR", rates: { USD: 1.25, ZAR: 20 } };
  const mixed = (): ItineraryDay[] =>
    [{ day_number: 1, activities: [act(100, "USD"), act(200, "ZAR"), act(undefined)] }] as unknown as ItineraryDay[];

  it("leaves a plan priced in one currency as it is, with or without rates", () => {
    const days = [day(1, [10, 20], "JPY")];
    expect(inPlanCurrency(days, null)).toEqual(days);
    expect(inPlanCurrency(days, rates)).toEqual(days);
  });

  it("puts every stop in the plan's currency, so the stops add up like with like", () => {
    const days = inPlanCurrency(mixed(), rates);
    // 200 rand is 10 euros, and 10 euros are 12.5 dollars.
    expect(days?.[0].activities.map((a) => a.estimated_cost)).toEqual([
      { amount: 100, currency: "USD", tier: "moderate" },
      { amount: 12.5, currency: "USD", tier: "moderate" },
      undefined,
    ]);
    expect(planCosts(days ?? [])?.total).toBe(113);
  });

  it("converts through the rates' base whichever currency it is", () => {
    const days = [{ day_number: 1, activities: [act(100, "USD"), act(100, "EUR")] }] as unknown as ItineraryDay[];
    expect(planCosts(inPlanCurrency(days, rates) ?? [])?.total).toBe(225);
  });

  it("is null when a stop's currency can't be converted: no rates yet, or one they lack", () => {
    expect(inPlanCurrency(mixed(), null)).toBeNull();
    expect(inPlanCurrency(mixed(), undefined)).toBeNull();
    expect(inPlanCurrency(mixed(), { base: "EUR", rates: { USD: 1.25 } })).toBeNull();
  });

  it("leaves a free stop alone, whatever currency it names", () => {
    const days = [{ day_number: 1, activities: [act(100, "USD"), act(0, "XYZ")] }] as unknown as ItineraryDay[];
    expect(planCosts(inPlanCurrency(days, rates) ?? [])?.total).toBe(100);
  });

  it("reads an estimate that names no currency in the trip's own", () => {
    const days = [
      { day_number: 1, activities: [act(100, "USD"), { name: "Place", estimated_cost: { amount: 40, tier: "budget" } }] },
    ] as unknown as ItineraryDay[];
    expect(planCosts(inPlanCurrency(days, rates, "ZAR") ?? [])?.total).toBe(103);
    expect(planCosts(inPlanCurrency(days, rates) ?? [])?.total).toBe(140);
  });
});

describe("displayCurrencyFor", () => {
  const usdPlan = [day(1, [100])];

  it("converts through the rates' base, either way round", () => {
    expect(displayCurrencyFor(usdPlan, "EUR", { base: "USD", rates: { EUR: 0.9 } })).toEqual({ currency: "EUR", rate: 0.9 });
    expect(displayCurrencyFor(usdPlan, "EUR", { base: "EUR", rates: { USD: 1.25 } })).toEqual({ currency: "EUR", rate: 0.8 });
    expect(displayCurrencyFor(usdPlan, "GBP", { base: "EUR", rates: { USD: 1.25, GBP: 0.85 } })?.rate).toBeCloseTo(0.68);
  });

  it("is the plan's own currency at 1 when nothing needs converting", () => {
    expect(displayCurrencyFor(usdPlan, "USD", null)).toEqual({ currency: "USD", rate: 1 });
  });

  it("gives nothing when the rates can't convert, as the page then shows the plan's amounts", () => {
    expect(displayCurrencyFor(usdPlan, "EUR", null)).toBeUndefined();
    expect(displayCurrencyFor(usdPlan, "BRL", { base: "USD", rates: { EUR: 0.9 } })).toBeUndefined();
    expect(displayCurrencyFor(usdPlan, undefined, { base: "USD", rates: { EUR: 0.9 } })).toBeUndefined();
  });
});
