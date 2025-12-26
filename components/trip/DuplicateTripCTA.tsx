"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Copy, Sparkles, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

// Storage key for pending duplicate action
const PENDING_DUPLICATE_KEY = "pendingTripDuplicate";

interface DuplicateTripCTAProps {
  shareToken: string;
  tripTitle: string;
  className?: string;
}

interface PendingDuplicate {
  shareToken: string;
  tripTitle: string;
  timestamp: number;
}

/**
 * Floating CTA for duplicating a shared trip to user's account.
 *
 * UX Features:
 * - Sticky at bottom on mobile (thumb zone accessibility)
 * - Auth-aware messaging
 * - Stores pending action for post-login execution
 * - Success feedback with redirect
 */
export default function DuplicateTripCTA({
  shareToken,
  tripTitle,
  className = "",
}: DuplicateTripCTAProps) {
  const t = useTranslations("common.duplicateTrip");
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [duplicateSuccess, setDuplicateSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);

      // Check if there's a pending duplicate action after login
      if (user) {
        const pending = getPendingDuplicate();
        if (pending && pending.shareToken === shareToken) {
          // Auto-execute the pending duplicate
          clearPendingDuplicate();
          handleDuplicate();
        }
      }
    };

    checkAuth();

    // Listen for auth state changes
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session?.user);

      // Check for pending duplicate after login
      if (event === "SIGNED_IN" && session?.user) {
        const pending = getPendingDuplicate();
        if (pending && pending.shareToken === shareToken) {
          clearPendingDuplicate();
          handleDuplicate();
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareToken]);

  // Store pending duplicate action
  const storePendingDuplicate = () => {
    const pending: PendingDuplicate = {
      shareToken,
      tripTitle,
      timestamp: Date.now(),
    };
    localStorage.setItem(PENDING_DUPLICATE_KEY, JSON.stringify(pending));
  };

  // Get pending duplicate action
  const getPendingDuplicate = (): PendingDuplicate | null => {
    try {
      const stored = localStorage.getItem(PENDING_DUPLICATE_KEY);
      if (!stored) return null;

      const pending = JSON.parse(stored) as PendingDuplicate;

      // Expire after 1 hour
      if (Date.now() - pending.timestamp > 60 * 60 * 1000) {
        clearPendingDuplicate();
        return null;
      }

      return pending;
    } catch {
      return null;
    }
  };

  // Clear pending duplicate action
  const clearPendingDuplicate = () => {
    localStorage.removeItem(PENDING_DUPLICATE_KEY);
  };

  // Handle duplicate action
  const handleDuplicate = async () => {
    if (!isAuthenticated) {
      // Store pending action and redirect to login
      storePendingDuplicate();
      router.push(`/auth/login?redirect=/shared/${shareToken}`);
      return;
    }

    setIsDuplicating(true);
    setError(null);

    try {
      const response = await fetch("/api/trips/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save trip");
      }

      setDuplicateSuccess(true);

      // Redirect to the new trip with share=invite to auto-open collaboration modal
      // This prompts users to invite friends, critical for virality
      setTimeout(() => {
        router.push(`/trips/${data.tripId}?share=invite`);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trip");
      setIsDuplicating(false);
    }
  };

  // Success state
  if (duplicateSuccess) {
    return (
      <div className={`fixed bottom-0 left-0 right-0 z-50 p-4 bg-gradient-to-t from-white via-white to-white/80 border-t border-slate-200 ${className}`}>
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-center gap-3 py-4 px-6 bg-emerald-500 text-white rounded-xl shadow-lg">
            <Check className="w-6 h-6" />
            <span className="font-semibold text-lg">{t("tripSaved")}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Floating CTA - Fixed at bottom for thumb accessibility */}
      <div className={`fixed bottom-0 left-0 right-0 z-50 p-4 bg-gradient-to-t from-white via-white to-white/80 border-t border-slate-200 safe-area-pb ${className}`}>
        <div className="max-w-xl mx-auto">
          {/* Error message */}
          {error && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center">
              {error}
            </div>
          )}

          {/* Main CTA Card */}
          <div className="bg-gradient-to-r from-[var(--primary)] to-[var(--primary)]/90 rounded-xl shadow-xl p-4">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              {/* Value Proposition */}
              <div className="flex-1 text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                  <span className="text-white/80 text-sm font-medium">
                    {t("makeItYours")}
                  </span>
                </div>
                <p className="text-white text-xs opacity-80">
                  {t("saveAndCustomize")}
                </p>
              </div>

              {/* CTA Button */}
              <button
                onClick={handleDuplicate}
                disabled={isDuplicating}
                className={`
                  flex items-center justify-center gap-2
                  px-6 py-3 rounded-lg font-semibold text-base
                  transition-all duration-200 min-w-[180px]
                  ${isDuplicating
                    ? "bg-white/20 text-white cursor-wait"
                    : "bg-white text-[var(--primary)] hover:bg-white/90 hover:shadow-lg active:scale-[0.98]"
                  }
                `}
              >
                {isDuplicating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{t("saving")}</span>
                  </>
                ) : isAuthenticated ? (
                  <>
                    <Copy className="w-5 h-5" />
                    <span>{t("saveToMyTrips")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-5 h-5" />
                    <span>{t("signUpToSave")}</span>
                  </>
                )}
              </button>
            </div>

            {/* Additional context for non-authenticated users */}
            {isAuthenticated === false && (
              <p className="text-white/60 text-xs text-center mt-3 sm:hidden">
                {t("alreadyHaveAccount")}{" "}
                <button
                  onClick={() => {
                    storePendingDuplicate();
                    router.push(`/auth/login?redirect=/shared/${shareToken}`);
                  }}
                  className="underline text-white/80 hover:text-white"
                >
                  {t("logIn")}
                </button>
              </p>
            )}
          </div>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-4 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              {t("trustBadges.freeForever")}
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              {t("trustBadges.fullyEditable")}
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              {t("trustBadges.shareWithFriends")}
            </span>
          </div>
        </div>
      </div>

      {/* Spacer to prevent content from being hidden behind fixed CTA */}
      <div className="h-36 sm:h-32" />
    </>
  );
}

/**
 * Hook to check and execute pending duplicate action
 * Use this in the auth callback or login page
 */
export function usePendingDuplicate() {
  const getPending = (): PendingDuplicate | null => {
    try {
      const stored = localStorage.getItem(PENDING_DUPLICATE_KEY);
      if (!stored) return null;

      const pending = JSON.parse(stored) as PendingDuplicate;

      // Expire after 1 hour
      if (Date.now() - pending.timestamp > 60 * 60 * 1000) {
        localStorage.removeItem(PENDING_DUPLICATE_KEY);
        return null;
      }

      return pending;
    } catch {
      return null;
    }
  };

  const clearPending = () => {
    localStorage.removeItem(PENDING_DUPLICATE_KEY);
  };

  return { getPending, clearPending };
}
