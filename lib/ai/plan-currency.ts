/**
 * One currency for a plan's prices. The model chose one per answer, so a trip
 * written in parts, per city or per segment came back part in euros and part
 * in dollars, and its total added both up as one currency. Plans are priced in
 * US dollars: the prompt asks for it, and this converts what still isn't. The
 * app shows every price in the traveller's own currency.
 */
import { getExchangeRates } from "@/lib/locale/currency";
import type { GeneratedItinerary } from "@/types";

export const PLAN_CURRENCY = "USD";

/** Units of each currency per one unit of `base`. */
export interface RateTable {
  base: string;
  rates: Record<string, number>;
}

function perBase(table: RateTable, currency: string): number | undefined {
  if (currency === table.base) return 1;
  const rate = table.rates[currency];
  return typeof rate === "number" && rate > 0 ? rate : undefined;
}

/** `amount` of `from` in `to`, or null when the table has no rate for one of them. */
export function convertAmount(amount: number, from: string, to: string, table: RateTable): number | null {
  if (from === to) return amount;
  const fromRate = perBase(table, from);
  const toRate = perBase(table, to);
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}

// Whole units, as the model writes them; a price never rounds down to free.
const whole = (amount: number) => (amount > 0 ? Math.max(1, Math.round(amount)) : 0);

/** Whether a price in the plan, or its total, is in a currency other than `currency`. */
export function pricedOtherwise(itinerary: GeneratedItinerary, currency: string): boolean {
  const summary = itinerary.trip_summary?.currency;
  if (typeof summary === "string" && summary !== currency) return true;
  return (itinerary.days ?? []).some((day) =>
    (day.activities ?? []).some((a) => {
      const c = a?.estimated_cost?.currency;
      return typeof c === "string" && c !== currency;
    })
  );
}

/**
 * The plan with its prices and total in `currency`, wherever the table can
 * convert them; one in a currency the table lacks keeps its own. Mutates and
 * returns the plan.
 */
export function withPricesIn(itinerary: GeneratedItinerary, currency: string, table: RateTable): GeneratedItinerary {
  for (const day of itinerary.days ?? []) {
    for (const activity of day.activities ?? []) {
      const cost = activity?.estimated_cost;
      if (!cost || typeof cost.currency !== "string" || cost.currency === currency) continue;
      if (typeof cost.amount !== "number" || !Number.isFinite(cost.amount)) continue;
      const amount = convertAmount(cost.amount, cost.currency, currency, table);
      if (amount !== null) activity.estimated_cost = { ...cost, amount: whole(amount), currency };
    }
  }
  const summary = itinerary.trip_summary;
  if (summary && typeof summary.currency === "string" && summary.currency !== currency) {
    const total =
      typeof summary.total_estimated_cost === "number" && Number.isFinite(summary.total_estimated_cost)
        ? convertAmount(summary.total_estimated_cost, summary.currency, currency, table)
        : null;
    if (total !== null) itinerary.trip_summary = { ...summary, total_estimated_cost: whole(total), currency };
  }
  return itinerary;
}

/**
 * The plan priced in US dollars. The day's rates are fetched only when a
 * price is in another currency, and without them the plan stays as it is.
 */
export async function inPlanCurrency(itinerary: GeneratedItinerary): Promise<GeneratedItinerary> {
  if (!pricedOtherwise(itinerary, PLAN_CURRENCY)) return itinerary;
  try {
    return withPricesIn(itinerary, PLAN_CURRENCY, await getExchangeRates(PLAN_CURRENCY));
  } catch (err) {
    console.warn("[plan-currency] no exchange rates, prices kept as written:", err instanceof Error ? err.message : err);
    return itinerary;
  }
}
