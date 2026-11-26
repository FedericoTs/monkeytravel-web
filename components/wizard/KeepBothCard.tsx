"use client";

import { useTranslations } from "next-intl";

/**
 * On the plan of a visit's second place, signed out: keep them all with a free account (lib/wizard/keep-both.ts says
 * when it shows; the sign-in saves every place, lib/wizard/visit-trips.ts). Quiet, above the plan: an ask, not a wall.
 */
export function KeepBothCard({ places, onSignIn, onDismiss }: { places: number; onSignIn: () => void; onDismiss: () => void }) {
  const t = useTranslations("trips.keepBoth");
  return (
    <section
      aria-labelledby="keep-both-title"
      className="mb-6 rounded-[var(--radius-lg)] border border-slate-200 bg-white p-4"
      data-keep-both-card
    >
      <p id="keep-both-title" className="text-base font-semibold text-slate-900">
        {places === 2 ? t("titleTwo") : t("titleMany", { count: places })}
      </p>
      <p className="mt-0.5 text-sm text-slate-600">{t("body")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSignIn}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--accent)] px-6 text-sm font-semibold text-slate-900 transition-colors hover:bg-[var(--accent)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
        >
          {t("signIn")}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
        >
          {t("notNow")}
        </button>
      </div>
    </section>
  );
}
