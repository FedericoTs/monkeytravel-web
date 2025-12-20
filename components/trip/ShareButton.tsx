"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import ShareAndInviteModal from "./ShareAndInviteModal";
import { CollaboratorAvatars } from "@/components/collaboration/CollaboratorAvatars";
import { trackTripShared } from "@/lib/analytics";
import type { TripCollaborator } from "@/types";

interface ShareButtonProps {
  tripId: string;
  tripTitle: string;
  variant?: "default" | "compact";
  initialTab?: "share" | "invite";
  showNewBadge?: boolean;
}

export default function ShareButton({
  tripId,
  tripTitle,
  variant = "default",
  initialTab = "share",
  showNewBadge = true,
}: ShareButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInTrending, setIsInTrending] = useState(false);
  const [collaborators, setCollaborators] = useState<TripCollaborator[]>([]);
  const [openTab, setOpenTab] = useState<"share" | "invite">(initialTab);

  // Fetch current share status and collaborators on mount
  useEffect(() => {
    async function fetchStatus() {
      try {
        // Fetch share status
        const shareResponse = await fetch(`/api/trips/${tripId}/share`);
        if (shareResponse.ok) {
          const data = await shareResponse.json();
          setIsShared(data.isShared);
          setShareUrl(data.shareUrl);
        }

        // Fetch collaborators
        const collabResponse = await fetch(`/api/trips/${tripId}/collaborators`);
        if (collabResponse.ok) {
          const data = await collabResponse.json();
          setCollaborators(data.collaborators || []);
        }
      } catch (error) {
        console.error("Error fetching status:", error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchStatus();
  }, [tripId]);

  const handleOpen = (tab: "share" | "invite" = "share") => {
    setOpenTab(tab);
    setIsModalOpen(true);
  };

  const handleEnableSharing = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/share`, {
        method: "POST",
      });

      if (response.ok) {
        const data = await response.json();
        setIsShared(true);
        setShareUrl(data.shareUrl);
        trackTripShared({ tripId, shareMethod: "link" });
      }
    } catch (error) {
      console.error("Error creating share link:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopSharing = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/share`, {
        method: "DELETE",
      });

      if (response.ok) {
        setIsShared(false);
        setShareUrl(null);
        setIsModalOpen(false);
      }
    } catch (error) {
      console.error("Error revoking share:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTrendingChange = (isTrending: boolean) => {
    setIsInTrending(isTrending);
  };

  const refreshCollaborators = useCallback(async () => {
    try {
      const response = await fetch(`/api/trips/${tripId}/collaborators`);
      if (response.ok) {
        const data = await response.json();
        setCollaborators(data.collaborators || []);
      }
    } catch (error) {
      console.error("Error refreshing collaborators:", error);
    }
  }, [tripId]);

  // Refresh collaborators when modal closes
  const handleModalClose = () => {
    setIsModalOpen(false);
    refreshCollaborators();
  };

  const hasCollaborators = collaborators.length > 1; // More than just owner

  // Compact variant just shows avatars with + button
  if (variant === "compact") {
    return (
      <>
        <CollaboratorAvatars
          collaborators={collaborators}
          maxVisible={3}
          size="sm"
          onClick={() => handleOpen("invite")}
          showAddButton={true}
        />

        <ShareAndInviteModal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          tripId={tripId}
          tripTitle={tripTitle}
          shareUrl={shareUrl || ""}
          isShared={isShared}
          isInTrending={isInTrending}
          onStopSharing={handleStopSharing}
          onEnableSharing={handleEnableSharing}
          onTrendingChange={handleTrendingChange}
          isLoading={isLoading}
          initialTab={openTab}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Share button with notification dot */}
        <div className="relative">
          <button
            onClick={() => handleOpen("share")}
            disabled={isLoading}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50",
              hasCollaborators
                ? "bg-gradient-to-r from-purple-100 to-blue-100 text-purple-700 hover:from-purple-200 hover:to-blue-200"
                : isShared
                  ? "bg-purple-100 text-purple-700 hover:bg-purple-200"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            {isLoading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            )}
            {isShared ? "Shared" : "Share"}
            {isShared && (
              <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </button>
          {/* Glowing notification dot for new feature */}
          {showNewBadge && !hasCollaborators && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500"></span>
            </span>
          )}
        </div>

        {/* Collaborator avatars (if any) */}
        {hasCollaborators && (
          <CollaboratorAvatars
            collaborators={collaborators.slice(0, 4)}
            maxVisible={3}
            size="sm"
            onClick={() => handleOpen("invite")}
            showAddButton={false}
          />
        )}

        {/* Invite button (if no collaborators yet) */}
        {!hasCollaborators && (
          <button
            onClick={() => handleOpen("invite")}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            Invite
          </button>
        )}
      </div>

      <ShareAndInviteModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        tripId={tripId}
        tripTitle={tripTitle}
        shareUrl={shareUrl || ""}
        isShared={isShared}
        isInTrending={isInTrending}
        onStopSharing={handleStopSharing}
        onEnableSharing={handleEnableSharing}
        onTrendingChange={handleTrendingChange}
        isLoading={isLoading}
        initialTab={openTab}
      />
    </>
  );
}
