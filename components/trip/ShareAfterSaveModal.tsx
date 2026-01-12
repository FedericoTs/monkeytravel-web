"use client";

/**
 * ShareAfterSaveModal - Shown after user saves a generated trip
 *
 * This is a critical touchpoint for virality - users are at peak excitement
 * right after generating and saving their trip. We prompt them to invite
 * collaborators to plan together.
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Vote, MessageSquare, Sparkles, X, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { trackSharePromptShown, trackSharePromptAction } from "@/lib/analytics";
import { captureSharePromptShown, captureSharePromptAction } from "@/lib/posthog/events";
import { useExperiment } from "@/lib/posthog/hooks";
import { FLAG_SHARE_MODAL_TIMING_EXP, type ShareModalTimingVariant } from "@/lib/posthog/flags";

interface ShareAfterSaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvite: () => void;
  tripId: string;
  tripTitle: string;
  tripDays: number;
  destination: string;
}

const COLLABORATION_BENEFITS = [
  {
    icon: Users,
    titleKey: "planTogether",
  },
  {
    icon: Vote,
    titleKey: "voteOnActivities",
  },
  {
    icon: MessageSquare,
    titleKey: "suggestIdeas",
  },
];

export default function ShareAfterSaveModal({
  isOpen,
  onClose,
  onInvite,
  tripId,
  tripTitle,
  tripDays,
  destination,
}: ShareAfterSaveModalProps) {
  const t = useTranslations("common");
  // Helper to access share translations with proper prefix
  const ts = (key: string, params?: Record<string, string | number>) => t(`share.${key}`, params);
  const [isExiting, setIsExiting] = useState(false);
  const [showDelayed, setShowDelayed] = useState(false);
  const hasTrackedView = useRef(false);

  // A/B Test: Share modal timing experiment
  // Variants: control (0s), delayed-2s (2s), delayed-5s (5s)
  const { variant: timingVariant, isLoading: isVariantLoading } = useExperiment(FLAG_SHARE_MODAL_TIMING_EXP);
  const experimentVariant = (timingVariant as ShareModalTimingVariant) || "control";

  // Timeout to prevent modal from being blocked if PostHog is slow/fails
  const [posthogTimedOut, setPosthogTimedOut] = useState(false);

  // Apply delay based on experiment variant
  useEffect(() => {
    if (!isOpen) {
      setShowDelayed(false);
      setPosthogTimedOut(false);
      return;
    }

    // Start a timeout - if PostHog doesn't load within 1.5s, show modal anyway
    const posthogTimeout = setTimeout(() => {
      if (isVariantLoading) {
        console.warn("[ShareAfterSaveModal] PostHog timed out, using default variant");
        setPosthogTimedOut(true);
      }
    }, 1500);

    // Wait for variant to load OR timeout (prevents infinite blocking)
    if (isVariantLoading && !posthogTimedOut) {
      return () => clearTimeout(posthogTimeout);
    }

    // Clear the timeout since PostHog loaded
    clearTimeout(posthogTimeout);

    // Determine delay based on variant (use "control" if timed out)
    const activeVariant = posthogTimedOut ? "control" : experimentVariant;
    const delayMap: Record<ShareModalTimingVariant, number> = {
      "control": 0,        // Immediate
      "delayed-2s": 2000,  // 2 second delay
      "delayed-5s": 5000,  // 5 second delay
    };
    const delay = delayMap[activeVariant] ?? 0;

    if (delay > 0) {
      const timer = setTimeout(() => setShowDelayed(true), delay);
      return () => clearTimeout(timer);
    } else {
      setShowDelayed(true);
    }
  }, [isOpen, experimentVariant, isVariantLoading, posthogTimedOut]);

  // Active variant (use "control" if PostHog timed out)
  const activeVariant = posthogTimedOut ? "control" : experimentVariant;

  // Track prompt shown (only once)
  useEffect(() => {
    if (isOpen && showDelayed && !hasTrackedView.current) {
      // Track in GA4 (existing)
      trackSharePromptShown({
        tripId,
        tripDestination: destination,
        tripDays,
      });
      // Track in PostHog with experiment variant for A/B analysis
      captureSharePromptShown({
        trip_id: tripId,
        trip_destination: destination,
        trip_days: tripDays,
        location: "post_save",
        experiment_variant: activeVariant,
        delay_ms: activeVariant === "control" ? 0 : activeVariant === "delayed-2s" ? 2000 : 5000,
      });
      hasTrackedView.current = true;
    }
  }, [isOpen, showDelayed, tripId, destination, tripDays, activeVariant]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        trackSharePromptAction({ tripId, action: "skip" });
        setIsExiting(true);
        setTimeout(() => {
          setIsExiting(false);
          onClose();
        }, 200);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, tripId, onClose]);

  const handleSkip = () => {
    // Track in GA4
    trackSharePromptAction({ tripId, action: "skip" });
    // Track in PostHog with experiment variant
    captureSharePromptAction({
      trip_id: tripId,
      action: "skip",
      experiment_variant: activeVariant,
    });
    setIsExiting(true);
    setTimeout(() => {
      setIsExiting(false);
      onClose();
    }, 200);
  };

  const handleInvite = () => {
    // Track in GA4
    trackSharePromptAction({ tripId, action: "invite" });
    // Track in PostHog with experiment variant
    captureSharePromptAction({
      trip_id: tripId,
      action: "invite",
      experiment_variant: activeVariant,
    });
    onInvite();
  };

  // Don't render until delay has passed (for experiment variants)
  if (!isOpen || !showDelayed) return null;

  return (
    <AnimatePresence>
      {!isExiting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={handleSkip}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
          >
            {/* Success Header */}
            <div className="relative bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white">
              {/* Close button */}
              <button
                onClick={handleSkip}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Success animation */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/20 flex items-center justify-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.4, type: "spring" }}
                >
                  <Sparkles className="w-8 h-8" />
                </motion.div>
              </motion.div>

              <h2 className="text-xl font-bold text-center mb-1">{ts("afterSave.tripSaved")}</h2>
              <p className="text-white/80 text-center text-sm">
                {ts("afterSave.daysInDestination", { tripDays, destination })}
              </p>
            </div>

            {/* Collaboration CTA */}
            <div className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 text-center mb-2">
                {ts("afterSave.travelingWithFriends")}
              </h3>
              <p className="text-slate-500 text-center text-sm mb-6">
                {ts("afterSave.inviteToCollaborate")}
              </p>

              {/* Benefits */}
              <div className="space-y-3 mb-6">
                {COLLABORATION_BENEFITS.map((benefit, index) => (
                  <motion.div
                    key={benefit.titleKey}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl"
                  >
                    <div className="p-2 bg-[var(--primary)]/10 rounded-lg">
                      <benefit.icon className="w-4 h-4 text-[var(--primary)]" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 text-sm">
                        {ts(`collaborationBenefits.${benefit.titleKey}.title`)}
                      </p>
                      <p className="text-slate-500 text-xs">
                        {ts(`collaborationBenefits.${benefit.titleKey}.description`)}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleInvite}
                  className="w-full py-3.5 px-4 bg-[var(--primary)] text-white rounded-xl font-medium flex items-center justify-center gap-2 shadow-lg shadow-[var(--primary)]/25 hover:bg-[var(--primary)]/90 transition-colors"
                >
                  <Users className="w-5 h-5" />
                  {ts("afterSave.inviteTripBuddies")}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </motion.button>

                <button
                  onClick={handleSkip}
                  className="w-full py-3 px-4 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl font-medium transition-colors text-sm"
                >
                  {ts("afterSave.maybeLater")}
                </button>
              </div>

              {/* Social proof hint */}
              <p className="text-center text-xs text-slate-400 mt-4">
                {ts("afterSave.collaboratorStats")}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
