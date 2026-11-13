"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import DownloadIcsButton from "@/components/calendar/DownloadIcsButton";
import ShareButton from "@/components/trip/ShareButton";
import TripActionsMenu, { TripActionsMenuItem, TripActionsMenuSlot } from "@/components/trip/TripActionsMenu";
import { MapToggle, ViewModeToggle } from "@/components/trip/ViewControls";
import { Link } from "@/lib/i18n/routing";
import type { ItineraryDay, TripMeta } from "@/types";

const ExportMenu = dynamic(() => import("@/components/trip/ExportMenu"), { ssr: false });

/**
 * The trip page's controls bar: the way back to the trips, the view and map
 * toggles, sharing, Edit with AI, and the More menu (export, calendar, add
 * from email). The editing controls come last, as children.
 */
export default function TripControlsBar({
  trip,
  viewMode,
  setViewMode,
  showMap,
  setShowMap,
  isEditMode,
  crewShareRequest,
  isOwner,
  shouldAutoOpenShareModal,
  canUseAssistant,
  onOpenAssistant,
  displayItinerary,
  emailParseEnabled,
  onPasteBooking,
  children,
}: {
  trip: {
    id: string;
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
    budget: { total: number; currency: string } | null;
    meta?: TripMeta;
  };
  viewMode: "timeline" | "cards";
  setViewMode: (mode: "timeline" | "cards") => void;
  showMap: boolean;
  setShowMap: (shown: boolean) => void;
  isEditMode: boolean;
  /** Bumped by the crew banners: each bump reopens sharing on its Share tab. */
  crewShareRequest: number;
  isOwner: boolean;
  /** Arrived with ?share=invite: sharing opens on its Invite tab. */
  shouldAutoOpenShareModal: boolean;
  canUseAssistant: boolean;
  onOpenAssistant: () => void;
  /** The itinerary as shown, for the export. */
  displayItinerary: ItineraryDay[];
  emailParseEnabled: boolean;
  onPasteBooking: () => void;
  /** The editing controls. */
  children: ReactNode;
}) {
  const t = useTranslations("trips");
  const tCommon = useTranslations("common");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-6">
      {/* Left side - Back button. Not on a phone: the tab bar leads to the
          trips there, and the row it took sat between the header and the plan. */}
      <div className="hidden sm:flex items-center gap-2">
        <Link
          href="/trips"
          className="flex items-center gap-1 sm:gap-2 text-slate-600 hover:text-slate-900 px-2 sm:px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden sm:inline">{t('detail.backToTrips')}</span>
        </Link>
      </div>

      {/* Right side - Controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        <ViewModeToggle value={viewMode} onChange={setViewMode} labels={{ cards: t('detail.cards'), timeline: t('detail.timeline') }} />
        <MapToggle shown={showMap} onToggle={() => setShowMap(!showMap)} labels={{ show: t('detail.showMap'), hide: t('detail.hideMap') }} />

        {/* Share Button.
            Crew Loop: the key remounts ShareButton whenever a crew
            banner button fires (crewShareRequest++), so its mount-time
            autoOpen/initialTab props — the exact mechanism the
            ?share=invite deep link uses — re-trigger with the SHARE tab,
            without modifying ShareButton itself. */}
        {!isEditMode && (
          <ShareButton
            key={`share-${crewShareRequest}`}
            tripId={trip.id}
            tripTitle={trip.title}
            tripIntent={trip.meta?.trip_intent}
            canManageSharing={isOwner}
            autoOpen={shouldAutoOpenShareModal || crewShareRequest > 0}
            initialTab={
              crewShareRequest > 0
                ? "share"
                : shouldAutoOpenShareModal
                  ? "invite"
                  : "share"
            }
          />
        )}

        {/* Edit with AI — the primary edit path, surfaced in the bar.
            Opens the same AIAssistant the floating trigger does. */}
        {!isEditMode && canUseAssistant && (
          <button
            onClick={onOpenAssistant}
            className="flex items-center gap-2 p-2 sm:px-3 sm:py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-slate-900 hover:bg-[var(--accent)]/90 transition-colors"
            title={t('detail.editWithAi')}
          >
            <Sparkles className="w-5 h-5 sm:w-4 sm:h-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('detail.editWithAi')}</span>
          </button>
        )}

        {/* More — the secondary export utilities collapse into one ⋯
            menu so the bar reads Share · Edit with AI · More. Each keeps
            its own component. */}
        {!isEditMode && (
          <TripActionsMenu label={t('detail.more')}>
            <TripActionsMenuSlot>
              <ExportMenu
                trip={{
                  title: trip.title,
                  description: trip.description,
                  startDate: trip.startDate,
                  endDate: trip.endDate,
                  budget: trip.budget,
                  itinerary: displayItinerary,
                }}
                surface="trip_detail"
              />
            </TripActionsMenuSlot>

            {/* Add to Calendar (.ics). Self-gates on the calendar flag —
                renders nothing when off, so the slot is safe unconditionally. */}
            <TripActionsMenuSlot>
              <DownloadIcsButton tripId={trip.id} showSubtext={false} />
            </TripActionsMenuSlot>

            {/* Add from email (paste booking → Gemini parse). Flag-gated. */}
            {emailParseEnabled && (
              <TripActionsMenuItem
                onClick={onPasteBooking}
                icon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                }
              >
                {tCommon('addFromEmail.button')}
              </TripActionsMenuItem>
            )}
          </TripActionsMenu>
        )}

        {children}
      </div>
    </div>
  );
}
