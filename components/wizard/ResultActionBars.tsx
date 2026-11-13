"use client";

import { useCallback, useEffect, useState, type ComponentProps, type ComponentType } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type AnonymousShareButton from "@/components/trip/AnonymousShareButton";
import type RegenerateButton from "@/components/trip/RegenerateButton";
import { EmailPlanCard } from "@/components/wizard/EmailPlanCard";
import { KeptLinkPill } from "@/components/wizard/KeptLinkPill";
import WizardSaveButton from "@/components/wizard/WizardSaveButton";
import type { AutoSaveStatus } from "@/hooks/useAutoSaveTrip";
import type { KeptState } from "@/hooks/useKeptPlan";
import { useRouter } from "@/lib/i18n/routing";
import type { GeneratedItinerary } from "@/types";

// Export (PDF / iCal) on the result view, rendered only once the trip is saved.
// Client-only, no auth: it works on the in-memory generatedItinerary.
const ExportMenu = dynamic(() => import("@/components/trip/ExportMenu"), { ssr: false });

type ShareButtonProps = ComponentProps<typeof AnonymousShareButton>;
type RegenerateButtonProps = ComponentProps<typeof RegenerateButton>;

// Small amber "● Not saved" pill rendered next to the Save button (desktop
// sticky header + phone bottom bar) while the displayed itinerary is unsaved,
// in both the manual and the auto-save arm. Subtle pulse on the dot only.
function NotSavedPill({ className = "" }: { className?: string }) {
  const t = useTranslations("trips");
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
      {t("wizard.result.notSavedPill")}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}

function MailIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function CrewIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}

/**
 * The result view's actions: the sticky header on wider screens, the bottom
 * bar on phones. Both carry Start Over, Regenerate, the save state and Save,
 * and the way to share the plan before or after saving it. The phone bar is one
 * row, so the plan keeps the screen: the state and Save, with the rest behind More.
 */
export default function ResultActionBars({
  generatedItinerary,
  totalCost,
  tripTitle,
  startDate,
  endDate,
  isAuthenticated,
  savedTripId,
  autoSave,
  autoSaving,
  isUnsaved,
  keptPlan,
  offerPlanEmail = false,
  saving,
  onSave,
  onStartOver,
  requestRegenerate,
  regenerating,
  share,
  ShareButton,
  RegenerateButton,
}: {
  generatedItinerary: GeneratedItinerary;
  /** The trip's estimated total, in the planner's currency. */
  totalCost: string;
  tripTitle: string;
  startDate: string;
  endDate: string;
  isAuthenticated: boolean | null;
  /** The trip the manual save stored. */
  savedTripId: string | null;
  /** The auto-save arm's state; null when that arm is off. */
  autoSave: { savedTripId: string | null; status: AutoSaveStatus; retry: () => void } | null;
  /** Signed in with auto-save on: the save is under way. */
  autoSaving: boolean;
  isUnsaved: boolean;
  /** A signed-out planner's kept plan: its link takes the not-saved pill's place. */
  keptPlan: KeptState | null;
  /** The save box closed with no sign-in: the plan's link by email is offered, once. */
  offerPlanEmail?: boolean;
  /** A save is under way (the manual one, or a shared plan's claim). */
  saving: boolean;
  onSave: () => void;
  onStartOver: () => void;
  requestRegenerate: () => void;
  regenerating: boolean;
  /** The no-account share, as the page builds it for every place that offers it. */
  share: Omit<ShareButtonProps, "className">;
  /** The share and regenerate buttons, as the page loaded them. */
  ShareButton: ComponentType<ShareButtonProps>;
  RegenerateButton: ComponentType<RegenerateButtonProps>;
}) {
  const t = useTranslations("trips");
  const tButtons = useTranslations("common.buttons");
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);
  // Unsaved-state pill (both save arms); a kept plan's link instead.
  const unsavedPill =
    isUnsaved && !autoSaving && (keptPlan ? <KeptLinkPill token={keptPlan.token} /> : <NotSavedPill />);
  const canEmailPlan = Boolean(keptPlan) && isUnsaved && !savedTripId && !autoSaving;
  const [planEmail, setPlanEmail] = useState<"asked" | "closed" | null>(null);
  const showPlanEmail = canEmailPlan && (planEmail === "asked" || (offerPlanEmail && planEmail !== "closed"));
  const closePlanEmail = useCallback(() => setPlanEmail("closed"), []);

  return (
    <>
      {/* Enhanced Sticky Header - Desktop */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200 hidden sm:block">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          {/* Start Over Button */}
          <button
            onClick={onStartOver}
            className="flex items-center gap-2 text-slate-600 hover:text-amber-600 transition-colors px-3 py-2 rounded-lg hover:bg-amber-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t("wizard.result.startOver")}
          </button>

          {/* Trip Summary */}
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="px-2 py-1 bg-slate-100 rounded-lg">
              {t("wizard.result.days", { count: generatedItinerary.days.length })}
            </span>
            <span className="px-2 py-1 bg-slate-100 rounded-lg">{totalCost}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {/* Export (PDF / iCal) — desktop sticky header only, and only
                AFTER save: a pre-save export is a "take the plan and leave"
                escape hatch at the exact moment the user should save. */}
            {savedTripId && (
              <ExportMenu
                trip={{
                  title: tripTitle,
                  description: generatedItinerary.destination.description,
                  startDate,
                  endDate,
                  budget: {
                    total: generatedItinerary.trip_summary.total_estimated_cost,
                    currency: generatedItinerary.trip_summary.currency,
                  },
                  itinerary: generatedItinerary.days,
                }}
                surface="anon_result"
              />
            )}
            <RegenerateButton onRegenerate={requestRegenerate} isRegenerating={regenerating} variant="compact" />
            {/* Ask your crew to vote — surfaces the crew-input intent at the
                peak moment. Saved trip → deep-link to the vote/invite tab;
                unsaved → onSave, which saves and opens the trip page.

                Hidden for a signed-out planner with nothing saved yet: in that
                state this button's else-branch calls onSave(), i.e. the auth
                wall — and the share button, rendered a few lines below, offers
                the no-signup path. Showing both would put the walled door next
                to the open one (the phone bar follows the same rule).
                Authenticated users (and anyone who has saved) keep it.
                Signed-out planners keep the vote ask: on a group-intent trip
                the share button below runs in "crew" mode and IS the vote ask,
                minus the account. */}
            {!(isAuthenticated === false && !savedTripId) && (
              <button
                type="button"
                onClick={() => {
                  const existingId = savedTripId || (autoSave ? autoSave.savedTripId : null);
                  if (existingId) {
                    router.push(`/trips/${existingId}?share=invite`);
                  } else {
                    onSave();
                  }
                }}
                className="hidden md:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[var(--secondary)] text-[var(--secondary-ink)] hover:bg-[var(--secondary)]/5 transition-colors"
              >
                <CrewIcon />
                {t("wizard.result.shareForVotes")}
              </button>
            )}
            {/* Save motivation at the PERSISTENT save point. The desktop
                ValuePropositionBanner sits once above the schedule and
                scrolls away, leaving this sticky-header Save button with no
                "why" as the user reads a long itinerary; this concise
                free/benefit line is the desktop twin of the phone nudge.
                Hidden once saved; lg+ only so it doesn't crowd the header on
                narrow desktops. */}
            {!savedTripId && !autoSaving && (
              <span className="hidden lg:flex items-center gap-1.5 text-xs font-medium text-emerald-600 whitespace-nowrap">
                <CheckIcon />
                {t(keptPlan ? "wizard.kept.headerNudge" : "wizard.result.saveHeaderNudge", {
                  count: generatedItinerary.days.length,
                })}
              </span>
            )}
            {unsavedPill}
            {canEmailPlan && (
              <button
                type="button"
                onClick={() => setPlanEmail("asked")}
                className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] xl:inline-flex"
              >
                <MailIcon className="h-3.5 w-3.5" />
                {t("wizard.kept.emailPill")}
              </button>
            )}
            <WizardSaveButton placement="header" autoSave={autoSave} onSave={onSave} saving={saving} />

            {/* Anonymous share: lets a signed-out planner send the trip
                without an account. It mints an ownerless, read-only link and
                keeps a claim token so the trip follows them into the account
                they create.

                isAuthenticated === false, not !isAuthenticated: the flag is
                tri-state and `null` means still resolving. Rendering on null
                would flash a share button at users who turn out to be signed
                in. Also hidden once a trip is saved — at that point the
                owner-based share flow is the right one. */}
            {isAuthenticated === false && !savedTripId && (
              <ShareButton {...share} />
            )}
          </div>
        </div>
      </div>

      {moreOpen && (
        <div
          data-more-backdrop
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/20 sm:hidden"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* Mobile Sticky Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 px-4 py-3 sm:hidden pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        {moreOpen && (
          <div id="result-more" className="mb-3 flex flex-col gap-2 border-b border-slate-100 pb-3">
            {/* Hides once the trip is saved. */}
            {!savedTripId && !autoSaving && (
              <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-700">
                <CheckIcon />
                {t(keptPlan ? "wizard.kept.mobileNudge" : "wizard.result.mobileSaveNudge", {
                  count: generatedItinerary.days.length,
                })}
              </p>
            )}
            {canEmailPlan && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  setPlanEmail("asked");
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-slate-300 font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <MailIcon className="h-4 w-4" />
                {t("wizard.kept.emailAction")}
              </button>
            )}
            {/* Ask your crew to vote, before saving (the peak share-intent
                moment). A SIGNED-OUT planner gets the share button: the
                onSave() route would put them straight into the auth wall the
                anonymous share exists to remove. isAuthenticated is tri-state,
                so only an explicit `false` swaps: `null` means still resolving
                and must not flash a share button at someone who turns out to
                be signed in. */}
            {!savedTripId && !autoSaving && (isAuthenticated === false ? (
              <ShareButton {...share} />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onSave();
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl font-semibold border border-[var(--secondary)] text-[var(--secondary-ink)] hover:bg-[var(--secondary)]/5 transition-colors"
              >
                <CrewIcon />
                {t("wizard.result.shareForVotes")}
              </button>
            ))}
            <RegenerateButton
              onRegenerate={() => {
                setMoreOpen(false);
                requestRegenerate();
              }}
              isRegenerating={regenerating}
              variant="default"
              className="w-full justify-center"
            />
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                onStartOver();
              }}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-slate-100 font-medium text-slate-700 transition-colors hover:bg-slate-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {t("wizard.result.startOver")}
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            aria-controls="result-more"
            className="flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            <MoreIcon />
            {tButtons("more")}
          </button>

          {unsavedPill}

          {/* Save (full width) */}
          <WizardSaveButton placement="bar" autoSave={autoSave} onSave={onSave} saving={saving} />
        </div>
      </div>

      {/* After the bars, so it paints over them where they meet on a short screen. */}
      {showPlanEmail && keptPlan && (
        <EmailPlanCard key={keptPlan.token} token={keptPlan.token} offered={planEmail !== "asked"} onClose={closePlanEmail} />
      )}
    </>
  );
}
