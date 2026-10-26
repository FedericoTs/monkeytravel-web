"use client";

import { useTranslations } from "next-intl";
import type { KeptPlanEntry } from "@/lib/plans/kept-plans-client";

function dateRange(start: string, end: string, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt.format(new Date(`${start}T00:00:00Z`))} – ${fmt.format(new Date(`${end}T00:00:00Z`))}`;
}

/**
 * Step 1, for a signed-out planner who has kept plans in this browser
 * (lib/plans/kept-plans-client.ts): one tap puts a plan back on screen.
 */
export function KeptPlansList({
  plans,
  locale,
  opening,
  onOpen,
}: {
  plans: KeptPlanEntry[];
  locale: string;
  opening: string | null;
  onOpen: (token: string) => void;
}) {
  const t = useTranslations("trips");
  if (plans.length === 0) return null;
  return (
    <section aria-labelledby="kept-plans-title">
      <p id="kept-plans-title" className="mb-2 text-xs font-medium text-slate-500">
        {t("wizard.kept.yourPlans")}
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {plans.slice(0, 3).map((plan) => (
          <li key={plan.token}>
            <button
              type="button"
              onClick={() => onOpen(plan.token)}
              disabled={opening !== null}
              aria-busy={opening === plan.token}
              className="inline-flex min-h-[44px] w-full flex-col items-start justify-center rounded-[var(--radius-md)] border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary)]/5 active:bg-[var(--primary)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:opacity-60"
            >
              <span className="w-full truncate text-sm font-semibold text-slate-900">
                {plan.destination.split(",")[0]}
              </span>
              <span className="text-xs text-slate-500">
                {dateRange(plan.startDate, plan.endDate, locale)} · {t("wizard.kept.days", { count: plan.dayCount })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
