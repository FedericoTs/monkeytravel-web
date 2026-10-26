"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { keptPlanLink } from "@/lib/plans/kept-plans-client";
import { capture } from "@/lib/posthog";

/**
 * Next to the Save button while a signed-out planner's plan is kept
 * (hooks/useKeptPlan.ts): copies the plan's private link, which puts it back
 * in the planner on any device.
 */
export function KeptLinkPill({ token, className = "" }: { token: string; className?: string }) {
  const t = useTranslations("trips");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const link = keptPlanLink(window.location.href, token);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard (an insecure context, a refused permission): show it to copy by hand.
      window.prompt(t("wizard.kept.copyLink"), link);
    }
    void capture("kept_plan_link_copied", {});
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={t("wizard.kept.linkHint")}
      aria-live="polite"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${className}`}
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        {copied ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
          />
        )}
      </svg>
      {copied ? t("wizard.kept.copied") : t("wizard.kept.copyLink")}
    </button>
  );
}
