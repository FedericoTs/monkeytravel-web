"use client";

import { useTranslations } from "next-intl";
import type { MastheadVariant } from "@/lib/wizard/entry-state";

interface WizardMastheadProps {
  variant: MastheadVariant;
  /** Read only by the prefill variant — the article's destination. */
  destination?: string | null;
  /** Real aggregate from /api/wizard/planning-stats; null until it resolves. */
  plannedStat: number | null;
  locale: string;
}

/**
 * Step-1 masthead — the sentence a cold visitor needs in the first three
 * seconds. The old heading ("Where and when?") named the form; this names the
 * output: a day-by-day itinerary, about 30 seconds (p50 27.9s measured
 * 2026-09-02), free, no account needed to see it.
 *
 * Three variants, chosen ONCE at mount from latched values (see
 * lib/wizard/entry-state.ts) so the h1 is SSR-stable and never swaps after
 * hydration:
 *   cold      — anonymous or returning arrivals
 *   firstRun  — a brand-new account (?auth_event=signup_email|signup_google)
 *   prefill   — a blog CTA carried a destination in
 *
 * The proof line keeps a reserved 20px slot so the count arriving from the
 * network shifts nothing (this page has a CLS history). Coral is decoration
 * only — the rule — never text: --primary-ink is the brand coral at 2.68:1.
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
