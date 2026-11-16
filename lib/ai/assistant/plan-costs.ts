import type { ItineraryDay } from "@/types";

/**
 * What a plan's activities cost, per day and in total, so the trip assistant
 * can quote real figures instead of adding them up itself. Asked for "il gran
 * totale", it once answered "Ecco il calcolo…" three times with no number.
 *
 * Pure and import-free on purpose: the server builds the prompt with it and
 * the wizard computes the display rate with it.
 */

/** The currency the plan's own amounts are in (the first one it names). */
export function planCurrency(days: ItineraryDay[]): string {
  for (const d of days) {
    for (const a of Array.isArray(d.activities) ? d.activities : []) {
      const c = a?.estimated_cost?.currency;
      if (typeof c === "string" && c) return c;
    }
  }
  return "USD";
}

/** Exchange rates as the page loads them: units of each currency for one unit of `base`. */
export interface RateTable {
  base: string;
  rates: Record<string, number>;
}

/** How many units of `currency` one unit of the table's base buys, if the table knows it. */
function perBase(rates: RateTable, currency: string): number | undefined {
  const rate = currency === rates.base ? 1 : rates.rates?.[currency];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

/**
 * The days with every priced stop in the plan's own currency, so planCosts adds
 * like with like: a plan can price a few stops in another currency, and adding
 * the bare numbers counts rand as dollars. An estimate that names no currency
 * is in `unnamed`, as the stop rows read it. Null when a stop's currency can't
 * be converted (no rates yet, or one they don't have): no total beats a wrong one.
 */
export function inPlanCurrency(
  days: ItineraryDay[],
  rates: RateTable | null | undefined,
  unnamed: string = planCurrency(days)
): ItineraryDay[] | null {
  const to = planCurrency(days);
  let unconvertible = false;
  const converted = days.map((d) => {
    if (!Array.isArray(d.activities)) return d;
    let changed = false;
    const activities = d.activities.map((a) => {
      const cost = a?.estimated_cost;
      const n = cost?.amount;
      if (!cost || typeof n !== "number" || !Number.isFinite(n) || n <= 0) return a;
      const from = cost.currency || unnamed;
      if (from === to) return a;
      const fromRate = rates ? perBase(rates, from) : undefined;
      const toRate = rates ? perBase(rates, to) : undefined;
      if (!fromRate || !toRate) {
        unconvertible = true;
        return a;
      }
      changed = true;
      return { ...a, estimated_cost: { ...cost, amount: (n / fromRate) * toRate, currency: to } };
    });
    return changed ? { ...d, activities } : d;
  });
  return unconvertible ? null : converted;
}

/** The currency the traveller sees prices in, and one unit of the plan's currency in it. */
export interface DisplayCurrency {
  currency: string;
  rate: number;
}

export interface DayCost {
  day: number;
  amount: number;
}

export interface PlanCosts {
  /** In the plan's own currency. */
  currency: string;
  perDay: DayCost[];
  total: number;
  /** The same figures as the traveller sees them, when that is another currency. */
  shown?: { currency: string; perDay: DayCost[]; total: number };
}

/** Activity costs per day and in total, or null when the plan prices nothing. */
export function planCosts(days: ItineraryDay[], display?: DisplayCurrency): PlanCosts | null {
  const currency = planCurrency(days);
  const raw = days.map((d) => ({
    day: d.day_number,
    amount: (Array.isArray(d.activities) ? d.activities : []).reduce((sum, a) => {
      const n = a?.estimated_cost?.amount;
      return sum + (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
    }, 0),
  }));
  const total = raw.reduce((sum, d) => sum + d.amount, 0);
  if (total <= 0) return null;

  const at = (rate: number) => raw.map((d) => ({ day: d.day, amount: Math.round(d.amount * rate) }));
  const costs: PlanCosts = { currency, perDay: at(1), total: Math.round(total) };
  if (display && display.currency !== currency && Number.isFinite(display.rate) && display.rate > 0) {
    costs.shown = { currency: display.currency, perDay: at(display.rate), total: Math.round(total * display.rate) };
  }
  return costs;
}

/**
 * The display currency for a plan, given the page's exchange rates. Undefined
 * when the rates can't convert between the two: the page then shows the plan's
 * own amounts, and so must the assistant.
 */
export function displayCurrencyFor(
  days: ItineraryDay[],
  preferred: string | undefined,
  rates: RateTable | null | undefined
): DisplayCurrency | undefined {
  if (!preferred) return undefined;
  const from = planCurrency(days);
  if (preferred === from) return { currency: preferred, rate: 1 };
  if (!rates) return undefined;
  const fromRate = perBase(rates, from);
  const toRate = perBase(rates, preferred);
  if (!fromRate || !toRate) return undefined;
  return { currency: preferred, rate: toRate / fromRate };
}
