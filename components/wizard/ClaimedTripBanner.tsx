"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

interface ClaimedTripBannerProps {
  tripId: string;
  onOpen: () => void;
  onPlanAnother: () => void;
  onDismiss: () => void;
}

/**
 * "Your trip came with you."
 *
 * A person who generated a trip anonymously, then signed up, had that trip
 * claimed into their account by AuthProvider — and until 2026-09-02 the id it
 * came back with was thrown away. They landed on an empty wizard while the
 * trip they had just built moved silently into My Trips. This is the missing
 * sentence, with the one action that matters.
 *
 * A banner, not a redirect: the claim resolves seconds after landing, and a
 * silent navigation away from a form is the class of bug the share loop
 * already fought. The week-one "opened" rate decides whether a redirect is
 * ever warranted. No entrance animation — it may appear after first paint.
 *
 * Coral carries the primary fill only (the accepted white-label exception);
 * all text is --foreground / slate.
 */
export default function ClaimedTripBanner({ tripId, onOpen, onPlanAnother, onDismiss }: ClaimedTripBannerProps) {
  const t = useTranslations("trips");
  return (
    <div
      role="status"
      className="mb-2 rounded-[var(--radius-xl)] border border-[var(--primary)]/20 bg-[var(--background-warm)] p-5"
      data-claimed-trip-banner
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
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-[var(--foreground)]">{t("wizard.claimedTrip.title")}</h3>
          <p className="mt-1 text-sm text-slate-600">{t("wizard.claimedTrip.body")}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              href={`/trips/${tripId}`}
              onClick={onOpen}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] bg-[var(--primary)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--primary)]/90"
            >
              {t("wizard.claimedTrip.open")}
            </Link>
            <button
              type="button"
              onClick={onPlanAnother}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-[var(--primary)]/5 hover:text-slate-900"
            >
              {t("wizard.claimedTrip.planAnother")}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("wizard.claimedTrip.dismiss")}
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
