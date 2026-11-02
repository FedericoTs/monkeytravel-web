import type { ItineraryDay } from "@/types";
import type { CurrencyCode } from "@/lib/locale/types";

/** The parts of useCurrency() a day's budget needs. */
interface DayBudgetCurrency {
  convert: (amount: number, fromCurrency: CurrencyCode) => { value: number; currency: CurrencyCode };
  format: (amount: number, currency: CurrencyCode) => string;
}

/**
 * Whether a day header shows the day's budget: only for days that carry a
 * stored daily_budget, which only older trips and the templates have. The
 * figure itself never reads it (dayBudgetLabel).
 */
export function showsDayBudget(day: ItineraryDay): boolean {
  return Boolean(day.daily_budget);
}

/**
 * A day's "Est. Budget": its activities' costs, each converted, summed in the
 * currency the converter returned for the first costed one; `freeLabel` when
 * nothing costs anything.
 *
 * Summing the activities keeps the figure equal to the rows below it. The
 * stored `day.daily_budget.total` is in the activities' source currency (say
 * JPY), not the trip's. Exchange rates load in a client effect, so on the
 * server render the converter returns amounts unconverted: formatting in the
 * currency it returned shows ¥27,600 there and €178 once rates load, never
 * €27,600.
 */
export function dayBudgetLabel(day: ItineraryDay, currency: DayBudgetCurrency, freeLabel: string): string {
  let total = 0;
  let totalCurrency: CurrencyCode | null = null;
  for (const activity of day.activities) {
    const amount = activity.estimated_cost?.amount;
    const from = activity.estimated_cost?.currency;
    if (!amount || !from) continue;
    const converted = currency.convert(amount, from);
    total += converted.value;
    totalCurrency ??= converted.currency;
  }
  return totalCurrency === null || total === 0 ? freeLabel : currency.format(total, totalCurrency);
}
