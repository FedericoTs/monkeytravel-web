"use client";

import { useTranslations } from "next-intl";
import type { RecentTwin } from "@/lib/trips/recent-twin";

/**
 * The same place and dates are already saved: update that trip with this plan,
 * or save it as a separate trip. `data-twin-trip-prompt` lets the wizard's
 * Save take the planner here while the question is open.
 */
export default function SameTripPrompt({
  twin,
  onChoose,
}: {
  twin: RecentTwin;
  onChoose: (replaceTripId: string | null) => void;
}) {
  const t = useTranslations("trips");
  return (
    <div className="max-w-6xl mx-auto px-4 pt-4">
      <div role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700" data-twin-trip-prompt>
        <p className="font-semibold text-slate-900">{t("wizard.result.twinTitle", { title: twin.title })}</p>
        <p className="mt-1">{t("wizard.result.twinBody")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChoose(twin.id)}
            className="min-h-[44px] rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
          >
            {t("wizard.result.twinReplace")}
          </button>
          <button
            type="button"
            onClick={() => onChoose(null)}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            {t("wizard.result.twinKeepBoth")}
          </button>
        </div>
      </div>
    </div>
  );
}
