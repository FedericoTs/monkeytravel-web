"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import ClaimedTripBanner from "@/components/wizard/ClaimedTripBanner";
import { KeptPlansList } from "@/components/wizard/KeptPlansList";
import { DraftRecoveryBanner, type ItineraryDraft } from "@/hooks/useItineraryDraft";
import type { KeptPlanEntry } from "@/lib/plans/kept-plans-client";
import type { PendingClaim } from "@/lib/trips/anonymous-claim-client";
import type { GeneratedItinerary } from "@/types";

const PendingClaimBanner = dynamic(() => import("@/components/wizard/PendingClaimBanner"), { ssr: false });

/**
 * What step 1 has to say before the form: the trip a signup claimed, a plan
 * shared before signing in, a draft that aged out, a plan link that expired,
 * the plans this browser kept, and an unsaved draft to restore (stepping
 * aside when the kept list already brings it back).
 */
export default function Step1Notices({
  claimedTripId,
  dismissClaimedTrip,
  showPendingClaimBanner,
  pendingClaim,
  handlePendingClaimAction,
  isExpired,
  draft,
  generatedItinerary,
  keptPlanGone,
  isAuthenticated,
  keptPlans,
  locale,
  openingKeptPlan,
  handleOpenKeptPlan,
  showDraftRecovery,
  handleRestoreDraft,
  handleDiscardDraft,
}: {
  /** The trip a signup claimed (hooks/useClaimedTrip.ts). */
  claimedTripId: string | null;
  dismissClaimedTrip: (action: "opened" | "plan_another" | "dismissed") => void;
  showPendingClaimBanner: boolean;
  /** A plan shared before signing in (hooks/usePendingClaim.ts). */
  pendingClaim: PendingClaim | null;
  handlePendingClaimAction: (action: "keep" | "open_link" | "dismissed") => void;
  /** The stored draft aged out. */
  isExpired: boolean;
  draft: ItineraryDraft | null;
  generatedItinerary: GeneratedItinerary | null;
  /** The last plan link opened had expired. */
  keptPlanGone: boolean;
  isAuthenticated: boolean | null;
  keptPlans: KeptPlanEntry[];
  locale: string;
  openingKeptPlan: string | null;
  handleOpenKeptPlan: (token: string, source: "link" | "list") => Promise<void>;
  showDraftRecovery: boolean;
  handleRestoreDraft: () => void;
  handleDiscardDraft: () => void;
}) {
  const t = useTranslations("trips");
  return (
    <>
      {/* The trip a signup claimed — above draft recovery (a finished
          trip outranks an unsaved one), above the masthead. Not
          flag-gated: without it a claimed trip is a dead end. */}
      {claimedTripId && (
        <ClaimedTripBanner
          tripId={claimedTripId}
          onOpen={() => dismissClaimedTrip("opened")}
          onPlanAnother={() => dismissClaimedTrip("plan_another")}
          onDismiss={() => dismissClaimedTrip("dismissed")}
        />
      )}
      {showPendingClaimBanner && pendingClaim && (
        <PendingClaimBanner
          pending={pendingClaim}
          onKeep={() => handlePendingClaimAction("keep")}
          onOpenLink={() => handlePendingClaimAction("open_link")}
          onDismiss={() => handlePendingClaimAction("dismissed")}
        />
      )}
      {/* A draft that aged out. useItineraryDraft deletes it on read and
          returns isExpired; say so once, plainly, rather than let the
          plan disappear without a word. */}
      {isExpired && !draft && !generatedItinerary && (
        <p className="mb-2 text-sm text-slate-600" role="status" data-draft-expired>
          {t("wizard.draftRecovery.expired")}
        </p>
      )}
      {keptPlanGone && (
        <p className="text-sm text-slate-600" role="status">
          {t("wizard.kept.gone")}
        </p>
      )}
      {/* A signed-out planner's kept plans. The draft banner steps aside
          when the draft is one of them: the list already brings it back. */}
      {isAuthenticated === false && !generatedItinerary && (
        <KeptPlansList
          plans={keptPlans}
          locale={locale}
          opening={openingKeptPlan}
          onOpen={(token) => void handleOpenKeptPlan(token, "list")}
        />
      )}
      {/* Returning-visitor draft recovery. A valid unsaved draft exists
          within the draft TTL (useItineraryDraft) — the banner lets the
          user recover straight into the Save moment instead of
          re-running the wizard and burning another scarce anon
          generation. */}
      {showDraftRecovery &&
        draft &&
        !(
          isAuthenticated === false &&
          keptPlans.some(
            (p) => p.destination === draft.destination && p.startDate === draft.startDate && p.endDate === draft.endDate
          )
        ) && (
        <DraftRecoveryBanner
          draft={draft}
          onRestore={handleRestoreDraft}
          onDiscard={handleDiscardDraft}
        />
      )}
    </>
  );
}
