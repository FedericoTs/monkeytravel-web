"use client";

import { useTranslations } from "next-intl";
import type { MastheadVariant } from "@/lib/wizard/entry-state";

interface WizardMastheadProps {
  variant: MastheadVariant;
  /** Read only by the prefill variant — the destination a link carried in. */
  destination?: string | null;
  /** Real aggregate from /api/wizard/planning-stats; null until it resolves. */
  plannedStat: number | null;
  locale: string;
}

/**
 * Step-1 masthead — the sentence a cold visitor needs in the first three
 * seconds. It names the output rather than the form: a day-by-day itinerary
 * in about 30 seconds, free, with no account needed to see it.
 *
 * Three variants, chosen ONCE at mount from latched values (see
 * lib/wizard/entry-state.ts) so the h1 is SSR-stable and never swaps after
 * hydration:
 *   cold      — anonymous or returning arrivals
 *   firstRun  — a brand-new account (?auth_event=signup_email|signup_google)
 *   prefill   — a link carried a destination in (a blog CTA, a trip page)
 *
 * The proof line keeps a reserved 20px slot so the count arriving from the
 * network shifts nothing. Coral is decoration only, never text:
 * --primary-ink is the brand coral at 2.68:1.
 */
export default function WizardMasthead({
  variant,
  destination,
  plannedStat,
  locale,
}: WizardMastheadProps) {
  const t = useTranslations("trips");

  const title =
    variant === "firstRun"
      ? t("wizard.step1.firstRun.title")
      : variant === "prefill"
        ? t("wizard.step1.prefill.title", { destination: destination ?? "" })
        : t("wizard.step1.editorial.title");
  const deck =
    variant === "firstRun"
      ? t("wizard.step1.firstRun.deck")
      : variant === "prefill"
        ? t("wizard.step1.prefill.deck")
        : t("wizard.step1.editorial.deck");

  return (
    <div className="flex flex-col gap-3" data-wizard-masthead={variant}>
      <span aria-hidden="true" className="block h-0.5 w-10 rounded-full bg-[var(--primary)]" />
      <h1 className="text-2xl font-semibold leading-tight text-[var(--foreground)] text-balance sm:text-3xl">
        {title}
      </h1>
      <p className="max-w-prose text-base text-[var(--foreground-muted)]">{deck}</p>
      {/* Reserved slot: renders empty until the honest count resolves, so the
          line appearing later never pushes the destination input down. */}
      <p className="flex min-h-[20px] items-center gap-1.5 text-xs text-slate-500">
        {plannedStat !== null && (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            {t("wizard.step1.planningStat", { count: plannedStat.toLocaleString(locale) })}
          </>
        )}
      </p>
    </div>
  );
}
