"use client";

import { useTranslations } from "next-intl";
import type { PendingClaim } from "@/lib/trips/anonymous-claim-client";

interface PendingClaimBannerProps {
  pending: PendingClaim;
  onKeep: () => void;
  onOpenLink: () => void;
  onDismiss: () => void;
}

/**
 * Return-visit reminder for a browser still holding an unclaimed shared trip.
 *
 * Before 2026-09-02 nothing in the product ever told a signed-out sharer that
 * a trip was waiting: `hasPendingClaim` had no callers. Of 56 signed-out
 * shares in 30 days, 23 were never even opened by anyone and none were
 * claimed. This sits above the step-1 masthead, mirrors ClaimedTripBanner,
 * and offers the same sign-up path the Save button uses (which converts 46%
 * of signed-out planners who hit it).
 */
export default function PendingClaimBanner({ pending, onKeep, onOpenLink, onDismiss }: PendingClaimBannerProps) {
  const t = useTranslations("trips");
  const title = pending.destination
    ? t("wizard.pendingClaim.title", { destination: pending.destination })
    : t("wizard.pendingClaim.titleGeneric");
  return (
    <div
      role="status"
      className="mb-2 rounded-[var(--radius-xl)] border border-[var(--primary)]/20 bg-[var(--background-warm)] p-5"
      data-pending-claim-banner
    >
      <div className="flex items-start gap-4">
        <div
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]/10"
          aria-hidden="true"
        >
          <svg className="h-5 w-5 text-[var(--foreground)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-[var(--foreground)]">{title}</h3>
          <p className="mt-1 text-sm text-slate-600">{t("wizard.pendingClaim.body")}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onKeep}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] bg-[var(--primary)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--primary)]/90"
            >
              {t("wizard.pendingClaim.keep")}
            </button>
            <a
              href={pending.shareUrl}
              target="_blank"
              rel="noreferrer"
              onClick={onOpenLink}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-[var(--primary)]/5 hover:text-slate-900"
            >
              {t("wizard.pendingClaim.openLink")}
            </a>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("wizard.pendingClaim.dismiss")}
          className="-mr-1 -mt-1 inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
