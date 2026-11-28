"use client";

import { useTranslations } from "next-intl";
import type { KeptPlanEntry } from "@/lib/plans/kept-plans-client";

function dateRange(start: string, end: string, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt.format(new Date(`${start}T00:00:00Z`))} – ${fmt.format(new Date(`${end}T00:00:00Z`))}`;
}

/**
 * Step 1, for a signed-out planner who has kept plans in this browser
 * (lib/plans/kept-plans-client.ts): the latest one first, as a card that says
 * whose plan it is with one button to put it back on screen, and up to two
 * older ones under it. A small list of chips alone was read past: few who
 * came back a day later opened the plan they had made.
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
  /** `from`: the card (the latest plan) or the list of older ones. */
  onOpen: (token: string, from: "card" | "list") => void;
}) {
  const t = useTranslations("trips");
  if (plans.length === 0) return null;
  const [latest, ...older] = plans.slice(0, 3);
  return (
    <section aria-labelledby="kept-plan-title" className="space-y-3">
      <div className="rounded-[var(--radius-lg)] border border-slate-200 bg-white p-4" data-kept-plan-card>
        <p id="kept-plan-title" className="text-base font-semibold text-slate-900">
          {t("wizard.kept.planFor", { place: latest.destination.split(",")[0] })}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">
          {dateRange(latest.startDate, latest.endDate, locale)} · {t("wizard.kept.days", { count: latest.dayCount })}
          {latest.changed && <> · {t("wizard.kept.changed")}</>}
        </p>
        <button
          type="button"
          onClick={() => onOpen(latest.token, "card")}
          disabled={opening !== null}
          aria-busy={opening === latest.token}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-sm sm:w-auto sm:px-8 font-semibold text-slate-900 transition-colors hover:bg-[var(--accent)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 disabled:opacity-60"
        >
          {t("wizard.kept.open")}
        </button>
      </div>
      {older.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-600">{t("wizard.kept.otherPlans")}</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {older.map((plan) => (
              <li key={plan.token}>
                <button
                  type="button"
                  onClick={() => onOpen(plan.token, "list")}
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
                  {/* Tells a plan they changed from a newer one for the same trip. */}
                  {plan.changed && <span className="text-xs font-medium text-slate-700">{t("wizard.kept.changed")}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
