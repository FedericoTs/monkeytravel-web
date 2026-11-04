"use client";

import type { RefObject } from "react";
import { useTranslations } from "next-intl";
import { STEP1_HINT, type Step1Blocker } from "@/lib/wizard/step1-gate";

/**
 * The wizard form's navigation bar: sticky at the foot of the screen on
 * phones, under the form on wider screens. On step 1 it names what still
 * keeps the planner from going on, or says the plan is free once nothing
 * does; then Back, and the step's way forward: plan a one-sentence trip,
 * pencil in flexible dates, Continue, or Generate on the last step.
 */
export default function WizardFooter({
  footerRef,
  step,
  setStep,
  totalSteps,
  expressTrip,
  canProceed,
  footerStateB,
  step1Block,
  effectiveMaxTripDays,
  isAuthenticated,
  handleExpressPlan,
  expressBusy,
  handleFlexibleDates,
  setDatesPencilled,
  handleContinue,
  handleGenerate,
}: {
  footerRef: RefObject<HTMLDivElement | null>;
  step: number;
  setStep: (step: number) => void;
  totalSteps: number;
  /** Step 1's text reads as a whole trip, planned as read. */
  expressTrip: boolean;
  canProceed: () => boolean;
  /** A valid place with no dates: the way forward pencils some in. */
  footerStateB: boolean;
  /** What still keeps step 1 from going on (lib/wizard/step1-gate.ts). */
  step1Block: Step1Blocker | null;
  effectiveMaxTripDays: number;
  isAuthenticated: boolean | null;
  handleExpressPlan: () => Promise<void>;
  expressBusy: boolean;
  handleFlexibleDates: () => void;
  setDatesPencilled: (pencilled: boolean) => void;
  handleContinue: () => void;
  handleGenerate: () => Promise<void>;
}) {
  const t = useTranslations("trips");
  return (
  <div
    ref={footerRef}
    className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 px-4 py-3 sm:relative sm:bg-transparent sm:border-t-slate-200 sm:px-0 sm:py-0 sm:mt-8 sm:pt-6 sm:z-auto"
  >
    {/* Missing-field hint — directly attacks the step-1 cliff: the
        Continue button is disabled with no visible reason, so users
        who don't realize what unlocks it just leave. Name the first
        blocker so the path forward is always obvious. */}
    {step === 1 && !expressTrip && !canProceed() && (
      <p aria-live="polite" className="mb-2 text-center text-xs font-medium text-slate-500 sm:text-left">
        {footerStateB
          ? t("wizard.step1.hintFlexibleDefault", { days: 5 })
          : t(STEP1_HINT[step1Block ?? "dates"], { days: effectiveMaxTripDays })}
      </p>
    )}
    {/* Once step 1 is complete, the hint slot frees up — reinforce the
        free/no-signup value right at the Continue commitment point. The
        auth wall sits at Save (not Generate), so many users don't realize
        they'll see the whole trip for free first; saying so here lowers
        the "is this going to make me sign up?" hesitation. */}
    {step === 1 && (expressTrip || canProceed()) && (
      <p className="mb-2 flex items-center justify-center gap-1.5 text-center text-xs font-medium text-emerald-600 sm:justify-start sm:text-left">
        <svg className="h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        {isAuthenticated
          ? t("wizard.step1.freeReassuranceSignedIn")
          : t("wizard.step1.freeReassurance")}
      </p>
    )}
    <div className="flex items-center justify-between">
    {step > 1 ? (
      <button
        onClick={() => setStep(step - 1)}
        className="flex items-center gap-2 px-4 py-3 sm:py-2.5 text-slate-600 hover:text-slate-900 font-medium rounded-lg hover:bg-slate-100 active:bg-slate-200 transition-colors min-h-[44px]"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span className="hidden sm:inline">{t("wizard.back")}</span>
      </button>
    ) : (
      <div />
    )}

    {step < totalSteps ? (
      expressTrip ? (
        // A one-sentence trip: plan it as read, skipping the vibes step.
        <button
          type="button"
          onClick={() => void handleExpressPlan()}
          disabled={expressBusy}
          aria-busy={expressBusy}
          className="bg-[var(--primary)] text-white px-8 py-3.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 active:bg-[var(--primary)]/80 disabled:opacity-70 transition-colors min-h-[48px] sm:min-h-0"
        >
          {t("wizard.express.cta")} →
        </button>
      ) : footerStateB ? (
        // State B: a valid destination, no dates. The same slot, the
        // same coral, an ENABLED button — one tap pencils in the
        // flexible default and the slot re-renders as Continue.
        <button
          type="button"
          onClick={() => {
            handleFlexibleDates();
            setDatesPencilled(true);
          }}
          className="bg-[var(--primary)] text-white px-8 py-3.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 active:bg-[var(--primary)]/80 transition-colors min-h-[48px] sm:min-h-0"
        >
          {t("wizard.step1.useFlexibleDates")}
        </button>
      ) : (
      <button
        data-testid="wizard-continue"
        onClick={handleContinue}
        disabled={!canProceed()}
        className="bg-[var(--primary)] text-white px-8 py-3.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--primary)]/90 active:bg-[var(--primary)]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] sm:min-h-0"
      >
        {t("wizard.step1.continue")} →
      </button>
      )
    ) : (
      <button
        onClick={() => void handleGenerate()}
        disabled={!canProceed()}
        className="bg-[var(--accent)] text-slate-900 px-8 py-3.5 sm:py-3 rounded-xl font-medium hover:bg-[var(--accent)]/90 active:bg-[var(--accent)]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-h-[48px] sm:min-h-0"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        {t("wizard.step2.generate")}
      </button>
    )}
    </div>
  </div>
  );
}
