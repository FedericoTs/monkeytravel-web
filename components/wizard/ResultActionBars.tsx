"use client";

import type { ComponentProps, ComponentType } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type AnonymousShareButton from "@/components/trip/AnonymousShareButton";
import type RegenerateButton from "@/components/trip/RegenerateButton";
import { KeptLinkPill } from "@/components/wizard/KeptLinkPill";
import WizardSaveButton from "@/components/wizard/WizardSaveButton";
import type { AutoSaveStatus } from "@/hooks/useAutoSaveTrip";
import type { KeptState } from "@/hooks/useKeptPlan";
import { useRouter } from "@/lib/i18n/routing";
import type { TripIntent } from "@/lib/posthog/events";
import type { PendingClaim } from "@/lib/trips/anonymous-claim-client";
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
 * and the way to share the plan before or after saving it.
 */
export default function ResultActionBars({
  generatedItinerary,
  totalCost,
  tripTitle,
  destination,
  startDate,
  endDate,
  locale,
  tripIntent,
  isAuthenticated,
  savedTripId,
  autoSave,
  autoSaving,
  isUnsaved,
  keptPlan,
  saving,
  onSave,
  onStartOver,
  requestRegenerate,
  regenerating,
  sessionShareUrl,
  onShared,
  onKeep,
  ShareButton,
  RegenerateButton,
}: {
  generatedItinerary: GeneratedItinerary;
  /** The trip's estimated total, in the planner's currency. */
  totalCost: string;
  tripTitle: string;
  destination: string;
  startDate: string;
  endDate: string;
  locale: string;
  tripIntent: TripIntent;
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
  /** A save is under way (the manual one, or a shared plan's claim). */
  saving: boolean;
  onSave: () => void;
  onStartOver: () => void;
  requestRegenerate: () => void;
  regenerating: boolean;
  sessionShareUrl: string | null;
  onShared: (pending: PendingClaim) => void;
  onKeep: () => void;
  /** The share and regenerate buttons, as the page loaded them. */
  ShareButton: ComponentType<ShareButtonProps>;
  RegenerateButton: ComponentType<RegenerateButtonProps>;
}) {
  const t = useTranslations("trips");
  const router = useRouter();
  const shareTrip = {
    title: tripTitle,
    description: generatedItinerary.destination.description,
    destination,
    startDate,
    endDate,
    itinerary: generatedItinerary.days,
    locale: generatedItinerary.language ?? locale,
  };
  // Unsaved-state pill (both save arms); a kept plan's link instead.
  const unsavedPill =
    isUnsaved && !autoSaving && (keptPlan ? <KeptLinkPill token={keptPlan.token} /> : <NotSavedPill />);

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
          <div className="flex items-center gap-2 text-sm text-slate-500">
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
              <ShareButton
                onShared={onShared}
                onKeep={onKeep}
                mode={tripIntent === "group" ? "crew" : "share"}
                existingShareUrl={sessionShareUrl}
                trip={shareTrip}
              />
            )}
          </div>
        </div>
      </div>

      {/* Mobile Sticky Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 px-4 py-3 sm:hidden pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        {/* Phone save motivation — the desktop ValuePropositionBanner is
            hidden sm:block, so without this the phone gets a bare Save button
            with no "why". A compact free/benefit line at the always-visible
            save moment. Hides once the trip is saved. */}
        {!savedTripId && !autoSaving && (
          <p className="mb-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-emerald-600">
            <CheckIcon />
            {t(keptPlan ? "wizard.kept.mobileNudge" : "wizard.result.mobileSaveNudge", {
              count: generatedItinerary.days.length,
            })}
          </p>
        )}
        {/* Ask your crew to vote — full-width above the save row. Shown
            pre-save (the peak share-intent moment).

            A SIGNED-OUT planner gets the share button: the onSave() route
            would put them straight into the auth wall the anonymous share
            exists to remove. Everyone else keeps the save route.
            isAuthenticated is tri-state, so only an explicit `false` swaps —
            `null` means still resolving and must not flash a share button at
            someone who turns out to be signed in. */}
        {!savedTripId && !autoSaving && (isAuthenticated === false ? (
          <ShareButton
            onShared={onShared}
            onKeep={onKeep}
            mode={tripIntent === "group" ? "crew" : "share"}
            existingShareUrl={sessionShareUrl}
            className="mb-2"
            trip={shareTrip}
          />
        ) : (
          <button
            type="button"
            onClick={() => onSave()}
            className="mb-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold border border-[var(--secondary)] text-[var(--secondary-ink)] hover:bg-[var(--secondary)]/5 transition-colors"
          >
            <CrewIcon />
            {t("wizard.result.shareForVotes")}
          </button>
        ))}
        <div className="flex items-center gap-2">
          {/* Start Over: an icon, so it carries its name */}
          <button
            type="button"
            onClick={onStartOver}
            aria-label={t("wizard.result.startOver")}
            className="flex items-center justify-center w-12 h-12 rounded-xl bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-600 transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <RegenerateButton
            onRegenerate={requestRegenerate}
            isRegenerating={regenerating}
            variant="icon-only"
            className="flex-shrink-0"
          />

          {unsavedPill}

          {/* Save (full width) */}
          <WizardSaveButton placement="bar" autoSave={autoSave} onSave={onSave} saving={saving} />
        </div>
      </div>
    </>
  );
}
