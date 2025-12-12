"use client";

import { useState, useEffect } from "react";
import { TrendingUp, Globe } from "lucide-react";
import {
  trackShareModalOpened,
  trackTripShared,
  trackReferralLinkClicked,
} from "@/lib/analytics";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  shareUrl: string;
  tripTitle: string;
  tripId: string;
  isShared: boolean;
  isInTrending?: boolean;
  onStopSharing: () => void;
  onTrendingChange?: (isTrending: boolean) => void;
  isLoading: boolean;
}

export default function ShareModal({
  isOpen,
  onClose,
  shareUrl,
  tripTitle,
  tripId,
  isShared,
  isInTrending = false,
  onStopSharing,
  onTrendingChange,
  isLoading,
}: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [trendingEnabled, setTrendingEnabled] = useState(isInTrending);
  const [trendingLoading, setTrendingLoading] = useState(false);

  // Reset state when modal opens and track view
  useEffect(() => {
    if (isOpen) {
      setCopied(false);
      setShowStopConfirm(false);
      setTrendingEnabled(isInTrending);
      // Track modal opened
      trackShareModalOpened({
        tripId,
        tripDestination: tripTitle,
      });
    }
  }, [isOpen, isInTrending, tripId, tripTitle]);

  // Handle trending toggle
  const handleTrendingToggle = async () => {
    if (trendingLoading) return;

    setTrendingLoading(true);
    try {
      const method = trendingEnabled ? "DELETE" : "POST";
      const response = await fetch(`/api/trips/${tripId}/submit-trending`, {
        method,
      });

      if (response.ok) {
        setTrendingEnabled(!trendingEnabled);
        onTrendingChange?.(!trendingEnabled);
      }
    } catch (error) {
      console.error("Failed to update trending status:", error);
    } finally {
      setTrendingLoading(false);
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      // Track copy action
      trackTripShared({ tripId, shareMethod: "link" });
      trackReferralLinkClicked({ code: tripId, medium: "copy" });
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleShareTwitter = () => {
    const text = encodeURIComponent(`Check out my trip to ${tripTitle} on MonkeyTravel!`);
    const url = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
    // Track Twitter share
    trackTripShared({ tripId, shareMethod: "social" });
    trackReferralLinkClicked({ code: tripId, medium: "twitter" });
  };

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(`Check out my trip: ${tripTitle}\n${shareUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank");
    // Track WhatsApp share
    trackTripShared({ tripId, shareMethod: "social" });
    trackReferralLinkClicked({ code: tripId, medium: "whatsapp" });
  };

  const handleShareEmail = () => {
    const subject = encodeURIComponent(`Check out my trip: ${tripTitle}`);
    const body = encodeURIComponent(`I planned this amazing trip using MonkeyTravel. Take a look!\n\n${shareUrl}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    // Track email share
    trackTripShared({ tripId, shareMethod: "email" });
    trackReferralLinkClicked({ code: tripId, medium: "email" });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Share Trip</h3>
              <p className="text-sm text-slate-500">{tripTitle}</p>
            </div>
          </div>

          {/* Share URL */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Share Link
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-600 truncate"
              />
              <button
                onClick={handleCopy}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  copied
                    ? "bg-green-100 text-green-700"
                    : "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
                }`}
              >
                {copied ? (
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Copied
                  </span>
                ) : (
                  "Copy"
                )}
              </button>
            </div>
          </div>

          {/* Social Share */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Share via
            </label>
            <div className="flex items-center gap-3">
              {/* Twitter */}
              <button
                onClick={handleShareTwitter}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <span className="text-sm font-medium">Twitter</span>
              </button>

              {/* WhatsApp */}
              <button
                onClick={handleShareWhatsApp}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                <span className="text-sm font-medium">WhatsApp</span>
              </button>

              {/* Email */}
              <button
                onClick={handleShareEmail}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-sm font-medium">Email</span>
              </button>
            </div>
          </div>

          {/* Submit to Trending */}
          {isShared && (
            <div className="mb-6 p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                    {trendingEnabled ? (
                      <Globe className="w-5 h-5 text-white" />
                    ) : (
                      <TrendingUp className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {trendingEnabled ? "Listed on Explore" : "Submit to Explore"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {trendingEnabled
                        ? "Your trip is visible in the public gallery"
                        : "Let others discover your itinerary"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleTrendingToggle}
                  disabled={trendingLoading}
                  className={`relative w-12 h-7 rounded-full transition-colors ${
                    trendingEnabled
                      ? "bg-gradient-to-r from-amber-500 to-orange-500"
                      : "bg-slate-200"
                  } ${trendingLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span
                    className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      trendingEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Stop Sharing */}
          {isShared && (
            <div className="border-t border-slate-200 pt-4">
              {!showStopConfirm ? (
                <button
                  onClick={() => setShowStopConfirm(true)}
                  className="text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  Stop sharing this trip
                </button>
              ) : (
                <div className="bg-red-50 rounded-lg p-4">
                  <p className="text-sm text-red-800 mb-3">
                    Are you sure? Anyone with the link will no longer be able to view this trip.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowStopConfirm(false)}
                      className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={onStopSharing}
                      disabled={isLoading}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isLoading ? "Stopping..." : "Stop Sharing"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
