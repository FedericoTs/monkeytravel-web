import type { ItineraryDay } from "@/types";
import type { CurrencyCode } from "@/lib/locale/types";

/** The parts of useCurrency() a day's budget needs. */
interface DayBudgetCurrency {
  convert: (amount: number, fromCurrency: CurrencyCode) => { value: number; currency: CurrencyCode };
  format: (amount: number, currency: CurrencyCode) => string;
}

/**
 * Whether a day header shows the day's budget: when at least one of its
 * activities has a cost estimate. A day without any has nothing to add up, and
 * showing "Free" there would claim what nobody estimated.
 */
export function showsDayBudget(day: ItineraryDay): boolean {
  return day.activities.some((activity) => activity.estimated_cost?.amount != null);
}

/**
 * A day's "Est. Budget": its activities' costs, each converted, summed in the
 * currency the converter returned for the first costed one; `freeLabel` when
 * nothing costs anything. An estimate that names no currency is in
 * `tripCurrency`, as on the activity rows (lib/i18n/activity-price.ts).
 *
 * Summing the activities keeps the figure equal to the rows below it. The
 * stored `day.daily_budget.total` is in the activities' source currency (say
 * JPY), not the trip's. Exchange rates load in a client effect, so on the
 * server render the converter returns amounts unconverted: formatting in the
 * currency it returned shows ¥27,600 there and €178 once rates load, never
 * €27,600.
 */
export function dayBudgetLabel(
  day: ItineraryDay,
  currency: DayBudgetCurrency,
  freeLabel: string,
  tripCurrency: CurrencyCode
): string {
  let total = 0;
  let totalCurrency: CurrencyCode | null = null;
  for (const activity of day.activities) {
    const amount = activity.estimated_cost?.amount;
    const from = activity.estimated_cost?.currency || tripCurrency;
    if (!amount) continue;
    const converted = currency.convert(amount, from);
    total += converted.value;
    totalCurrency ??= converted.currency;
  }
  return totalCurrency === null || total === 0 ? freeLabel : currency.format(total, totalCurrency);
}
