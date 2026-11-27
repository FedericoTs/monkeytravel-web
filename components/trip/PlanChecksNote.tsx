"use client";

import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { readPlanChecks } from "@/lib/ai/plan-checks";

/**
 * Says what was checked for the trip's own dates, in the plan's own counts: how many sights' closing days were
 * looked at, and what became of the ones planned on a day they're shut. A plan that carries no count says
 * nothing: the line is never a slogan.
 */
export default function PlanChecksNote({ checked, className = "" }: { checked: unknown; className?: string }) {
  const t = useTranslations("trips.wizard.result.checked");
  const found = readPlanChecks(checked);
  if (!found) return null;
  const outcome =
    found.shut === 0
      ? t("noneShut")
      : found.left === 0
        ? t("fixed", { count: found.fixed })
        : found.fixed === 0
          ? t("left", { count: found.left })
          : t("fixedAndLeft", { fixed: found.fixed, left: found.left });
  return (
    <p data-testid="plan-checks" className={`flex items-start gap-2 text-sm text-[var(--foreground)] ${className}`}>
      <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--secondary-ink)]" aria-hidden="true" />
      <span>
        <span className="font-semibold">{t("lead", { count: found.sights })}</span> {outcome}
      </span>
    </p>
  );
}
