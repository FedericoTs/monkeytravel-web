"use client";

import { useRef } from "react";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import ShareRow from "@/components/ShareRow";
import ParticipantsBar from "@/components/trip/ParticipantsBar";
import PlanByEmail from "@/components/trip/PlanByEmail";
import WhoIsGoingCard from "@/components/trip/WhoIsGoingCard";
import { useCssVarHeight } from "@/hooks/useCssVarHeight";
import { Link } from "@/lib/i18n/routing";
import type { PlanOwnSurface } from "@/lib/trips/plan-own";

/** What a shared or public trip page asks of its reader, at the top and at the end. */
interface SharedTripAskProps {
  participantsEnabled: boolean;
  isOwner: boolean;
  shareToken?: string;
  /** The planner sent this specifically to ask for votes (?vote=1). */
  crewAsk: boolean;
  planOwnHref: string;
  onPlanOwn: (surface: PlanOwnSurface) => void;
  onSave: () => void;
}

/**
 * Participants layout: title · dates · N going · [I'm going] · [Share] · [More]. The
 * vote invitation is the secondary line under the button. The vote banner is the
 * flag-off layout.
 */
export function SharedTripTopAsk({
  participantsEnabled,
  isOwner,
  shareToken,
  crewAsk,
  planOwnHref,
  onPlanOwn,
  onSave,
  tripId,
  tripTitle,
  publicUrl,
}: SharedTripAskProps & {
  tripId: string;
  tripTitle: string;
  /** The public page's canonical URL; absent on a share link. */
  publicUrl?: string;
}) {
  const t = useTranslations("common");
  if (participantsEnabled && isOwner) {
    // The owner (e.g. opening their own share link): show them who's
    // going, not an "I'm going" button.
    return <WhoIsGoingCard tripId={tripId} className="mb-6" />;
  }
  if (!shareToken) {
    // The public page: share its own URL or save a copy, nothing more.
    if (!participantsEnabled || !publicUrl) return null;
    return (
      <div
        data-testid="public-trip-actions"
        className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      >
        <ShareRow url={publicUrl} title={tripTitle} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("share.participants.saveForLater")}
          </button>
          <Link
            href={planOwnHref}
            onClick={() => onPlanOwn("public_top")}
            data-testid="public-plan-like-this"
            className="inline-flex min-h-[40px] items-center rounded-xl bg-[var(--primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          >
            {t("share.planLikeThis.short")}
          </Link>
        </div>
      </div>
    );
  }
  if (participantsEnabled) {
    return (
      <ParticipantsBar
        shareToken={shareToken}
        source={crewAsk ? "crew_ask" : "shared"}
        crewAsk={crewAsk}
        tripTitle={tripTitle}
        onSaveForLater={onSave}
        className="mb-6"
      />
    );
  }
  return (
    <div className="mb-6 flex items-center gap-3 rounded-2xl border border-[var(--secondary)]/30 bg-[var(--secondary)]/5 px-4 py-3">
      <span className="text-2xl leading-none" aria-hidden>🗳️</span>
      <div>
        <p className="font-semibold text-slate-800">{crewAsk ? t("share.crewPrompt.title") : t("shared.voteInviteTitle")}</p>
        <p className="text-sm text-slate-600">{crewAsk ? t("share.crewPrompt.body") : t("shared.voteInviteBody")}</p>
      </div>
    </div>
  );
}

/**
 * Both fixed bars sit on top of the mobile nav (--mt-nav-h, 0px at desktop): at
 * bottom-0 the nav covered the owner's sign-up link. With participants on, "Plan
 * your own trip" sits in flow at the very bottom only. The owner-claim strip and
 * the flag-off two-button bar are fixed bars.
 */
export function SharedTripEndAsk({
  participantsEnabled,
  isOwner,
  shareToken,
  crewAsk,
  planOwnHref,
  onPlanOwn,
  onSave,
  ownerPending,
  tripOver,
  viewerEmail,
  destination,
  likeThisDays,
}: SharedTripAskProps & {
  /** This browser holds the claim on this trip (useOwnerClaim). */
  ownerPending: boolean;
  tripOver: boolean;
  viewerEmail?: string;
  destination: string;
  likeThisDays: number | null;
}) {
  const t = useTranslations("common");
  // The fixed bar publishes its height as --mt-bottom-bar-h, so the global cookie
  // banner can sit ABOVE it instead of on it (hooks/useCssVarHeight, the same
  // mechanism as the wizard footer).
  const bottomBarRef = useRef<HTMLDivElement | null>(null);
  useCssVarHeight(bottomBarRef, "--mt-bottom-bar-h", ownerPending || !participantsEnabled);

  if (ownerPending) {
    return (
      <div
        ref={bottomBarRef}
        data-testid="trip-bottom-bar"
        className="fixed bottom-[var(--mt-nav-h,0px)] left-0 right-0 z-40 p-4 bg-gradient-to-t from-white via-white to-white/80 border-t border-slate-100"
      >
        <div className="max-w-2xl mx-auto">
          <div
            className="flex flex-col gap-3 rounded-xl border border-[var(--primary)]/20 bg-[var(--background-warm)] px-4 py-3 sm:flex-row sm:items-center"
            data-owner-claim-strip
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--foreground)]">{t("share.ownerClaim.title")}</p>
              <p className="text-xs text-slate-600">{t("share.ownerClaim.body")}</p>
            </div>
            <Link
              href={`/auth/signup?redirect=${encodeURIComponent(`/shared/${shareToken}`)}`}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--primary)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--primary)]/90"
            >
              {t("share.ownerClaim.cta")}
            </Link>
          </div>
        </div>
      </div>
    );
  }
  // The owner sees "Who's going" at the top; no recipient CTA here.
  if (participantsEnabled && isOwner) return null;
  if (participantsEnabled) {
    return (
      <section
        data-testid="recipient-footer-cta"
        className="mt-10 rounded-2xl border border-slate-200 bg-[var(--background-warm)] p-5 text-center"
      >
        {/* A share link's last ask is the group's: going, with the plan by email. */}
        {shareToken && !tripOver && (
          <div className="mb-5 border-b border-slate-200 pb-5">
            <PlanByEmail shareToken={shareToken} source={crewAsk ? "crew_ask" : "shared"} defaultEmail={viewerEmail} />
          </div>
        )}
        <p className="mb-3 text-sm text-slate-600">
          {shareToken ? t("share.participants.planOwnLead") : t("share.planLikeThis.lead")}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href={planOwnHref}
            onClick={() => onPlanOwn(shareToken ? "shared_footer" : "public_footer")}
            className={
              shareToken
                ? "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                : "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 text-sm font-semibold text-white shadow-lg hover:from-amber-600 hover:to-orange-600 transition-all"
            }
          >
            {likeThisDays
              ? t("share.planLikeThis.button", { days: likeThisDays, destination })
              : destination
                ? t("share.savedHero.planOwnButton", { destination })
                : t("share.savedHero.planOwnButtonGeneric")}
          </Link>
          <button
            type="button"
            onClick={onSave}
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {t("share.participants.saveForLater")}
          </button>
        </div>
      </section>
    );
  }
  return (
    <div
      ref={bottomBarRef}
      data-testid="trip-bottom-bar"
      className="fixed bottom-[var(--mt-nav-h,0px)] left-0 right-0 z-40 p-4 bg-gradient-to-t from-white via-white to-white/80 border-t border-slate-100"
    >
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onSave}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-[var(--primary)] to-[var(--primary)]/90 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200"
          >
            <Sparkles className="w-5 h-5" />
            {t("share.savedHero.saveButton")}
          </button>
          <Link
            href={planOwnHref}
            onClick={() => onPlanOwn("bottom_bar")}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 text-center"
          >
            {destination ? t("share.savedHero.planOwnButton", { destination }) : t("share.savedHero.planOwnButtonGeneric")}
          </Link>
        </div>
        <p className="text-center text-xs text-slate-500 mt-2">{t("share.savedHero.saveSubtitle")}</p>
      </div>
    </div>
  );
}
