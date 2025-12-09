"use client";

import { useState, useEffect } from "react";
import ShareModal from "./ShareModal";
import { trackTripShared } from "@/lib/analytics";

interface ShareButtonProps {
  tripId: string;
  tripTitle: string;
}

export default function ShareButton({ tripId, tripTitle }: ShareButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch current share status on mount
  useEffect(() => {
    async function fetchShareStatus() {
      try {
        const response = await fetch(`/api/trips/${tripId}/share`);
        if (response.ok) {
          const data = await response.json();
          setIsShared(data.isShared);
          setShareUrl(data.shareUrl);
        }
      } catch (error) {
        console.error("Error fetching share status:", error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchShareStatus();
  }, [tripId]);

  const handleShare = async () => {
    if (isShared && shareUrl) {
      // Already shared, just open modal
      setIsModalOpen(true);
      return;
    }

    // Create share link
    setIsLoading(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/share`, {
        method: "POST",
      });

      if (response.ok) {
        const data = await response.json();
        setIsShared(true);
        setShareUrl(data.shareUrl);
        setIsModalOpen(true);
        // Track share event for retention analytics
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

  return (
    <>
      <button
        onClick={handleShare}
        disabled={isLoading}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isShared
            ? "bg-purple-100 text-purple-700 hover:bg-purple-200"
            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        } disabled:opacity-50`}
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

      {isModalOpen && (
        <ShareModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          shareUrl={shareUrl || ""}
          tripTitle={tripTitle}
          isShared={isShared}
          onStopSharing={handleStopSharing}
          isLoading={isLoading}
        />
      )}
    </>
  );
}
