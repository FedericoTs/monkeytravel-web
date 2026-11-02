import { useTranslations } from "next-intl";
import { useCurrency } from "@/lib/locale";
import type { Activity } from "@/types";

type Convert = (amount: number, fromCurrency: string) => { formatted: string };

/**
 * An activity's estimated price in the viewer's currency: `free` when the
 * estimate is 0, null when there is none (a missing estimate is unknown, not
 * free). `currency` is the trip's, for an estimate that names no currency.
 */
export function activityPrice(
  cost: Activity["estimated_cost"],
  currency: string,
  convert: Convert,
  free: string
): string | null {
  if (cost?.amount == null) return null;
  if (cost.amount === 0) return free;
  return convert(cost.amount, cost.currency || currency).formatted;
}

/** activityPrice() in the viewer's currency and language. */
export function useActivityPrice(): (activity: Pick<Activity, "estimated_cost">, currency: string) => string | null {
  const t = useTranslations("common");
  const { convert } = useCurrency();
  return (activity, currency) => activityPrice(activity.estimated_cost, currency, convert, t("activity.free"));
}
