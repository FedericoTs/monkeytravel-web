"use client";

import { useState, useEffect, useCallback } from "react";
import type { GeneratedItinerary } from "@/types";

const DRAFT_KEY = "monkeytravel-itinerary-draft";
const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ItineraryDraft {
  generatedItinerary: GeneratedItinerary;
  destination: string;
  startDate: string;
  endDate: string;
  pace: string;
  vibes: string[];
  budgetTier: string;
  savedAt: number;
  userId?: string;
}

interface UseItineraryDraftReturn {
  draft: ItineraryDraft | null;
  saveDraft: (data: Omit<ItineraryDraft, "savedAt">) => void;
  clearDraft: () => void;
  hasDraft: boolean;
  isExpired: boolean;
  restoreDraft: () => ItineraryDraft | null;
}

export function useItineraryDraft(userId?: string): UseItineraryDraftReturn {
  const [draft, setDraft] = useState<ItineraryDraft | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  // Load draft from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DRAFT_KEY);
      if (stored) {
        const parsed: ItineraryDraft = JSON.parse(stored);

        // Check if draft is expired
        const now = Date.now();
        if (now - parsed.savedAt > DRAFT_EXPIRY_MS) {
          setIsExpired(true);
          localStorage.removeItem(DRAFT_KEY);
          return;
        }

        // Check if draft belongs to current user (if userId provided)
        if (userId && parsed.userId && parsed.userId !== userId) {
          // Draft belongs to different user, don't restore
          return;
        }

        setDraft(parsed);
      }
    } catch (error) {
      console.error("Failed to load draft:", error);
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [userId]);

  // Save draft to localStorage
  const saveDraft = useCallback((data: Omit<ItineraryDraft, "savedAt">) => {
    try {
      const draftData: ItineraryDraft = {
        ...data,
        savedAt: Date.now(),
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
      setDraft(draftData);
      setIsExpired(false);
    } catch (error) {
      console.error("Failed to save draft:", error);
    }
  }, []);

  // Clear draft from localStorage
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
      setDraft(null);
      setIsExpired(false);
    } catch (error) {
      console.error("Failed to clear draft:", error);
    }
  }, []);

  // Restore draft (returns the draft data for use)
  const restoreDraft = useCallback((): ItineraryDraft | null => {
    if (draft && !isExpired) {
      return draft;
    }
    return null;
  }, [draft, isExpired]);

  return {
    draft,
    saveDraft,
    clearDraft,
    hasDraft: !!draft && !isExpired,
    isExpired,
    restoreDraft,
  };
}

// Recovery modal component for when user has a draft
export function DraftRecoveryBanner({
  draft,
  onRestore,
  onDiscard,
}: {
  draft: ItineraryDraft;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const formatSavedTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return "yesterday";
  };

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-5 mb-6 animate-fade-in-up">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
          <svg
            className="w-6 h-6 text-amber-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-amber-900 mb-1">
            Unsaved trip found
          </h3>
          <p className="text-sm text-amber-800 mb-3">
            You have an unsaved trip to{" "}
            <span className="font-medium">{draft.destination}</span>
            {" · "}
            {formatDate(draft.startDate)} - {formatDate(draft.endDate)}
          </p>

          <div className="flex items-center gap-2 text-xs text-amber-600 mb-4">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Saved {formatSavedTime(draft.savedAt)}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={onRestore}
              className="px-4 py-2.5 bg-amber-600 text-white font-medium rounded-xl hover:bg-amber-700 transition-colors shadow-sm"
            >
              Restore Trip
            </button>
            <button
              onClick={onDiscard}
              className="px-4 py-2.5 bg-white text-amber-700 font-medium rounded-xl border border-amber-200 hover:bg-amber-50 transition-colors"
            >
              Start Fresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
