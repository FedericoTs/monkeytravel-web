"use client";

import { useEffect, useState } from "react";
import { Eye, Share2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { trackShareModalOpened } from "@/lib/analytics";
import BottomSheet from "@/components/ui/BottomSheet";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { useIsPhone } from "@/hooks/useMediaQuery";
import InviteTab from "@/components/trip/InviteTab";
import ShareLinkTab from "@/components/trip/ShareLinkTab";
import { useShareLink } from "@/hooks/useShareLink";
import { useTripInvites } from "@/hooks/useTripInvites";

type TabType = "share" | "invite";

interface ShareAndInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  tripTitle: string;
  // Share props
  shareUrl: string;
  /**
   * From trip_meta.trip_intent. "group" opens the share tab on the crew ask
   * (the link carries ?vote=1 and the recipient page leads with the vote);
   * anything else opens on the plain link. Both stay one tap away.
   */
  tripIntent?: "solo" | "group" | null;
  isShared: boolean;
  isInTrending?: boolean;
  onStopSharing: () => void;
  onEnableSharing: () => Promise<void>;
  onTrendingChange?: (isTrending: boolean) => void;
  isLoading: boolean;
  // Initial tab (for opening directly to invite tab)
  initialTab?: TabType;
  /**
   * Whether this viewer may turn the link on or off and list the trip in
   * Explore. Only the owner may (POST/DELETE /share and /publish are
   * owner-only), so a collaborator's click used to fail silently. Defaults
   * to true: the owner's view is unchanged.
   */
  canManageSharing?: boolean;
  /**
   * Whether Explore is on. While it's off the publish route answers 404, so
   * the switch is hidden. Defaults to true.
   */
  exploreEnabled?: boolean;
  /** Opens the publish flow, which applies the Explore checks. */
  onRequestPublish?: () => void;
}

/** The two tabs, on a phone and on a desktop. */
function ShareTabButtons({
  activeTab,
  onChange,
  memberCount,
  className = "",
}: {
  activeTab: TabType;
  onChange: (tab: TabType) => void;
  /** Everyone on the trip, the owner included. */
  memberCount: number;
  className?: string;
}) {
  const t = useTranslations("common");
  const ts = (key: string) => t(`share.${key}`);
  return (
    <div className={cn("flex gap-2", className)}>
      <button
        onClick={() => onChange("share")}
        className={cn(
          "flex-1 flex flex-col items-center gap-1 px-4 py-3 rounded-xl border-2 transition-all",
          activeTab === "share"
            ? "border-slate-300 bg-slate-50 shadow-sm"
            : "border-transparent bg-slate-100/50 hover:bg-slate-100"
        )}
      >
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center",
          activeTab === "share" ? "bg-slate-200" : "bg-slate-200/50"
        )}>
          <Eye className={cn("w-4 h-4", activeTab === "share" ? "text-slate-700" : "text-slate-500")} />
        </div>
        <span className={cn("text-sm font-medium", activeTab === "share" ? "text-slate-900" : "text-slate-600")}>
          {ts("invite.viewOnlyLink")}
        </span>
        <span className="text-xs text-slate-500">{ts("invite.anyoneCanView")}</span>
      </button>
      <button
        onClick={() => onChange("invite")}
        className={cn(
          "flex-1 flex flex-col items-center gap-1 px-4 py-3 rounded-xl border-2 transition-all",
          activeTab === "invite"
            ? "border-[var(--primary)] bg-blue-50 shadow-sm"
            : "border-transparent bg-blue-50/30 hover:bg-blue-50/60"
        )}
      >
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center relative",
          activeTab === "invite" ? "bg-[var(--primary)]" : "bg-blue-100"
        )}>
          <UserPlus className={cn("w-4 h-4", activeTab === "invite" ? "text-white" : "text-[var(--primary-ink)]")} />
          {memberCount > 1 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] font-bold bg-amber-400 text-amber-900 rounded-full flex items-center justify-center">
              {memberCount - 1}
            </span>
          )}
        </div>
        <span className={cn("text-sm font-medium", activeTab === "invite" ? "text-[var(--primary-ink)]" : "text-slate-600")}>
          {ts("invite.inviteToCollaborate")}
        </span>
        <span className="text-xs text-slate-500">{ts("invite.editVoteSuggest")}</span>
      </button>
    </div>
  );
}

export default function ShareAndInviteModal({
  isOpen,
  onClose,
  tripId,
  tripTitle,
  shareUrl,
  tripIntent,
  isShared,
  isInTrending = false,
  onStopSharing,
  onEnableSharing,
  onTrendingChange,
  isLoading,
  initialTab = "share",
  canManageSharing = true,
  exploreEnabled = true,
  onRequestPublish,
}: ShareAndInviteModalProps) {
  const t = useTranslations("common");
  const ts = (key: string) => t(`share.${key}`);
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const isMobile = useIsPhone();
  const link = useShareLink({ tripId, tripTitle, shareUrl, tripIntent, isInTrending, onTrendingChange, onRequestPublish });
  const invites = useTripInvites(tripId);
  const { reopen: reopenLink } = link;
  const { collaborators, reopen: reopenInvites } = invites;

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      reopenLink(isInTrending);

      // Track modal opened
      trackShareModalOpened({
        tripId,
        tripDestination: tripTitle,
      });

      reopenInvites();
    }
  }, [isOpen, initialTab, isInTrending, tripId, tripTitle, reopenLink, reopenInvites]);

  // The desktop dialog's Escape, scroll lock, focus and Tab. On mobile the
  // BottomSheet is the dialog and does all of this itself.
  const { panelRef } = useModalBehavior({ isOpen: isOpen && !isMobile, onClose });

  if (!isOpen) return null;

  const tabs = (className?: string) => (
    <ShareTabButtons activeTab={activeTab} onChange={setActiveTab} memberCount={collaborators.length} className={className} />
  );
  const content =
    activeTab === "share" ? (
      <ShareLinkTab
        link={link}
        isShared={isShared}
        canManageSharing={canManageSharing}
        exploreEnabled={exploreEnabled}
        isLoading={isLoading}
        onEnableSharing={onEnableSharing}
        onStopSharing={onStopSharing}
      />
    ) : (
      <InviteTab tripId={tripId} tripTitle={tripTitle} invites={invites} />
    );

  // Mobile: Use BottomSheet for better UX
  if (isMobile) {
    return (
      <BottomSheet isOpen={isOpen} onClose={onClose} title={ts("titleWithInvite")}>
        <div className="px-4 pb-6">
          {/* Tabs */}
          <div className="border-b border-slate-200 mb-4">{tabs()}</div>
          {/* Content */}
          {content}
        </div>
      </BottomSheet>
    );
  }

  // Desktop: a centered dialog.
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-and-invite-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal. The positioning container sits on top of the backdrop, so a
          click in the dark area around the panel lands here and closes too; the
          panel stops its own clicks from bubbling up. min-h-dvh with safe-area
          padding: min-h-screen (100vh) over-counts on iOS Safari by the URL bar
          and home indicator, which can put the bottom button out of view. */}
      <div
        className="relative min-h-screen min-h-dvh flex items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
        onClick={onClose}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            aria-label={ts("a11y.close")}
            title={t("buttons.close")}
            className="absolute top-4 right-4 z-10 text-slate-500 hover:text-slate-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Header with tabs */}
          <div className="border-b border-slate-200">
            <div className="flex items-center gap-4 px-6 pt-6 pb-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
                <Share2 className="w-6 h-6 text-[var(--primary-ink)]" />
              </div>
              <div className="flex-1">
                <h3 id="share-and-invite-title" className="text-lg font-semibold text-slate-900">{ts("titleWithInvite")}</h3>
                <p className="text-sm text-slate-500 truncate">{tripTitle}</p>
              </div>
            </div>

            {/* Tabs */}
            {tabs("px-6")}
          </div>

          {/* Content */}
          <div className="p-6 max-h-[60vh] overflow-y-auto">{content}</div>
        </div>
      </div>
    </div>
  );
}
