"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { SAVE_BENEFITS } from "@/lib/auth/save-benefits";
import { capture } from "@/lib/posthog";

/**
 * What keeping the plan gives, where a reader finishes it: after the last day, with the way to keep it. The same three
 * things the save box lists (lib/auth/save-benefits.ts), and the same save (`onSave` opens the box). Shown to a
 * signed-out planner in the save_box_benefits experiment's "benefits" arm.
 */
export function SaveBenefitsCard({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  const t = useTranslations("trips.wizard.result");
  const tBenefits = useTranslations("common.authPrompt.saveBenefits");
  const id = useId();

  const save = () => {
    void capture("save_benefits_card_pressed", {});
    onSave();
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold text-slate-900">
        {t("benefitsTitle")}
      </h2>
      <ul className="mt-3 flex flex-col gap-2.5">
        {SAVE_BENEFITS.map((benefit) => (
          <li key={benefit.key} className="flex items-start gap-2.5 text-sm text-slate-700">
            <svg className="mt-0.5 h-5 w-5 shrink-0 text-[var(--secondary-ink)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={benefit.icon} />
            </svg>
            <span>{tBenefits(benefit.key)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="min-h-[44px] rounded-xl bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[var(--primary)]/25 transition-colors hover:bg-[var(--primary)]/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("benefitsCta")}
        </button>
        <p className="text-center text-xs text-slate-500 sm:text-left">{tBenefits("free")}</p>
      </div>
    </section>
  );
}
