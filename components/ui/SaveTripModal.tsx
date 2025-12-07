"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Calendar, Copy, Check, Loader2, X, Sparkles } from "lucide-react";

interface SaveTripModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** For templates: the template ID */
  templateId?: string;
  /** For shared trips: the share token */
  shareToken?: string;
  /** Trip metadata for display */
  tripTitle: string;
  tripDestination: string;
  tripCountryCode?: string;
  durationDays: number;
  /** Optional callback after successful save */
  onSuccess?: (newTripId: string) => void;
}

// Storage key for pending save action
const PENDING_SAVE_KEY = "pendingSaveTripAction";

interface PendingSave {
  templateId?: string;
  shareToken?: string;
  tripTitle: string;
  startDate?: string;
  timestamp: number;
}

// Country code to flag emoji
function getFlagEmoji(countryCode: string): string {
  if (!countryCode) return "🌍";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

/**
 * Modal for saving a template or shared trip to user's account
 * with date selection.
 *
 * UX Features:
 * - Shows trip preview info
 * - Date picker with calculated end date
 * - Auth-aware (redirects to login if needed)
 * - Stores pending action for post-login execution
 * - Success animation and redirect
 */
export default function SaveTripModal({
  isOpen,
  onClose,
  templateId,
  shareToken,
  tripTitle,
  tripDestination,
  tripCountryCode,
  durationDays,
  onSuccess,
}: SaveTripModalProps) {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");

  // Set default date to tomorrow
  useEffect(() => {
    if (isOpen) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setStartDate(tomorrow.toISOString().split("T")[0]);
      setError(null);
      setSaveSuccess(false);
    }
  }, [isOpen]);

  // Check auth status
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);
    };

    checkAuth();

    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session?.user);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Calculate end date
  const endDate = startDate
    ? (() => {
        const end = new Date(startDate);
        end.setDate(end.getDate() + durationDays - 1);
        return end;
      })()
    : null;

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  // Store pending save action
  const storePendingSave = () => {
    const pending: PendingSave = {
      templateId,
      shareToken,
      tripTitle,
      startDate,
      timestamp: Date.now(),
    };
    localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(pending));
  };

  // Handle save action
  const handleSave = async () => {
    if (!startDate) {
      setError("Please select a start date");
      return;
    }

    if (!isAuthenticated) {
      // Store pending action and redirect to login
      storePendingSave();
      const redirectPath = templateId
        ? `/trips/template/${templateId}`
        : `/shared/${shareToken}`;
      router.push(`/auth/login?redirect=${encodeURIComponent(redirectPath)}`);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      let response;

      if (templateId) {
        // Copy template
        response = await fetch(`/api/templates/${templateId}/copy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate }),
        });
      } else if (shareToken) {
        // Duplicate shared trip with new dates
        response = await fetch("/api/trips/duplicate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shareToken, startDate }),
        });
      } else {
        throw new Error("No template or share token provided");
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save trip");
      }

      setSaveSuccess(true);

      // Get the new trip ID
      const newTripId = templateId ? data.trip.id : data.tripId;

      // Callback or redirect
      if (onSuccess) {
        onSuccess(newTripId);
      } else {
        setTimeout(() => {
          router.push(`/trips/${newTripId}`);
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trip");
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-up">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Success State */}
        {saveSuccess ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">
              Trip Saved!
            </h3>
            <p className="text-slate-600">
              Redirecting to your new trip...
            </p>
          </div>
        ) : (
          <>
            {/* Header with destination */}
            <div className="p-6 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
              <div className="flex items-center gap-4">
                <div className="text-4xl">
                  {getFlagEmoji(tripCountryCode || "")}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    {tripDestination}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {durationDays} days · {tripTitle}
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-[var(--primary)]" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-900">
                    When does your trip start?
                  </label>
                  <p className="text-xs text-slate-500">
                    We'll adjust all dates in the itinerary
                  </p>
                </div>
              </div>

              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 outline-none text-lg"
              />

              {startDate && endDate && (
                <div className="mt-4 p-4 bg-slate-50 rounded-xl">
                  <div className="flex items-center justify-between text-sm">
                    <div>
                      <span className="text-slate-500">Start</span>
                      <p className="font-semibold text-slate-900">
                        {formatDate(new Date(startDate))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-slate-400">
                      <div className="w-8 h-px bg-slate-300" />
                      <span className="text-xs">{durationDays} days</span>
                      <div className="w-8 h-px bg-slate-300" />
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500">End</span>
                      <p className="font-semibold text-slate-900">
                        {formatDate(endDate)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-100 bg-slate-50">
              <button
                onClick={handleSave}
                disabled={!startDate || isSaving}
                className="w-full px-6 py-4 rounded-xl bg-[var(--primary)] text-white font-semibold hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg shadow-[var(--primary)]/25"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Creating Your Trip...</span>
                  </>
                ) : isAuthenticated === false ? (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>Sign Up to Save</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-5 h-5" />
                    <span>Save to My Trips</span>
                  </>
                )}
              </button>

              {isAuthenticated === false && (
                <p className="text-center text-xs text-slate-500 mt-3">
                  Already have an account?{" "}
                  <button
                    onClick={() => {
                      storePendingSave();
                      const redirectPath = templateId
                        ? `/trips/template/${templateId}`
                        : `/shared/${shareToken}`;
                      router.push(`/auth/login?redirect=${encodeURIComponent(redirectPath)}`);
                    }}
                    className="text-[var(--primary)] hover:underline font-medium"
                  >
                    Log in
                  </button>
                </p>
              )}

              {/* Trust badges */}
              <div className="flex items-center justify-center gap-4 mt-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  Free forever
                </span>
                <span className="flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  Fully editable
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes scale-up {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-scale-up {
          animation: scale-up 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

/**
 * Hook to check for pending save action after login
 */
export function usePendingSaveTripAction() {
  const getPending = (): PendingSave | null => {
    try {
      const stored = localStorage.getItem(PENDING_SAVE_KEY);
      if (!stored) return null;

      const pending = JSON.parse(stored) as PendingSave;

      // Expire after 1 hour
      if (Date.now() - pending.timestamp > 60 * 60 * 1000) {
        localStorage.removeItem(PENDING_SAVE_KEY);
        return null;
      }

      return pending;
    } catch {
      return null;
    }
  };

  const clearPending = () => {
    localStorage.removeItem(PENDING_SAVE_KEY);
  };

  return { getPending, clearPending };
}
