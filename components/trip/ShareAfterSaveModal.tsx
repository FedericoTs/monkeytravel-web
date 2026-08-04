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
import { Users, Vote, MessageSquare, Sparkles, X, ArrowRight, Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { trackSharePromptShown, trackSharePromptAction } from "@/lib/analytics";
import { captureSharePromptShown, captureSharePromptAction } from "@/lib/posthog/events";
import { useExperiment } from "@/lib/posthog/hooks";
import { FLAG_SHARE_MODAL_TIMING_EXP, type ShareModalTimingVariant } from "@/lib/posthog/flags";

interface ShareAfterSaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvite: () => void;
  /**
   * Publishes the trip to /explore. When provided, renders the opt-out
   * publish checkbox. Omit on surfaces where publishing isn't relevant
   * (anon-saved trips, EXPLORE_UGC_ENABLED off).
   *
   * Called at most once, and only from an affirmative button click — never
   * from a dismissal. Fire-and-forget: we don't block the user's exit on a
   * network round-trip, and /trips/[id] renders the true publish state on
   * arrival, so a silent failure self-corrects on the very next screen.
   */
  onPublish?: () => Promise<void> | void;
  /**
   * True when the trip is built around pinned commitments (a booked flight,
   * a wedding, dinner with a named friend). Anchors are personal data about
   * identifiable people that the user did not write for an audience, so the
   * opt-out default is suppressed and the box starts unticked. The server
   * enforces the same rule independently — see the publish route.
   */
  isAnchored?: boolean;
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
  onPublish,
  isAnchored = false,
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
  // Opt-out for ordinary trips, opt-in for anchored ones.
  const [publishChecked, setPublishChecked] = useState(!isAnchored);
  // Publishing is fire-and-forget across two exit paths (invite + done);
  // this guard keeps a double-click from POSTing twice.
  const hasPublished = useRef(false);

  // A/B Test: Share modal timing experiment
  // Variants: control (0s), delayed-2s (2s), delayed-5s (5s)
  const { variant: timingVariant, isLoading: isVariantLoading } = useExperiment(FLAG_SHARE_MODAL_TIMING_EXP);
  const experimentVariant = (timingVariant as ShareModalTimingVariant) || "control";

  // Timeout to prevent modal from being blocked if PostHog is slow/fails
  const [posthogTimedOut, setPosthogTimedOut] = useState(false);

  // Re-arm the checkbox each time the modal opens, so a reopen can't inherit
  // a stale tick — and so an `isAnchored` that arrives a render late (the
  // parent derives it from wizard state) still suppresses the opt-out default.
  //
  // Adjusted during render rather than in an effect: React re-runs this
  // component before touching the DOM, so the user never sees a frame with the
  // wrong default. An effect would paint the box ticked first and correct it
  // after — a visible flash on exactly the control where a wrong default
  // matters most.
  const [lastOpen, setLastOpen] = useState(isOpen);
  if (isOpen !== lastOpen) {
    setLastOpen(isOpen);
    if (isOpen) setPublishChecked(!isAnchored);
  }

  // Apply delay based on experiment variant
  useEffect(() => {
    if (!isOpen) {
      setShowDelayed(false);
      setPosthogTimedOut(false);
      // Companion to the render-phase checkbox re-arm above. Ref writes belong
      // in an effect, not in render.
      hasPublished.current = false;
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

  // Focus trap: cycle Tab/Shift+Tab inside the panel and capture initial focus
  // so screen-reader users land inside the dialog. Framer-motion controls the
  // visual mount/unmount, so BaseModal isn't a clean fit here — we add the
  // dialog semantics inline instead. See BaseModal.tsx for the canonical
  // implementation we mirror.
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || !showDelayed) return;

    triggerRef.current = (document.activeElement as HTMLElement) ?? null;

    // Focus the first focusable inside the panel on mount
    const focusFirst = () => {
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      focusable?.[0]?.focus();
    };
    // Wait one frame for framer-motion to mount the panel
    const raf = requestAnimationFrame(focusFirst);

    return () => {
      cancelAnimationFrame(raf);
      // Restore focus to the trigger on unmount
      triggerRef.current?.focus?.();
    };
  }, [isOpen, showDelayed]);

  // Handle escape key + Tab focus trap
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        trackSharePromptAction({ tripId, action: "skip" });
        setIsExiting(true);
        setTimeout(() => {
          setIsExiting(false);
          onClose();
        }, 200);
        return;
      }

      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, tripId, onClose]);

  /**
   * Run the publish, if the user left the box ticked.
   *
   * Deliberately NOT called from handleDismiss. A ticked checkbox plus a click
   * on a labelled button is consent; closing a modal is not. Publishing on X /
   * Escape / backdrop would mean a user who fled the dialog wakes up with their
   * itinerary on a public page, and no default-on checkbox makes that honest.
   */
  const publishIfChecked = () => {
    if (!onPublish || !publishChecked || hasPublished.current) return;
    hasPublished.current = true;
    // Reuse the share_prompt event so publishes stay in the existing funnel,
    // tagged with a distinct action so the conversion splits out. GA4 falls
    // back to "invite" — its legacy schema only accepts that union.
    trackSharePromptAction({ tripId, action: "invite" });
    captureSharePromptAction({
      trip_id: tripId,
      action: "publish",
      experiment_variant: activeVariant,
    });
    void Promise.resolve(onPublish()).catch(() => {});
  };

  const closeWithExitAnimation = () => {
    setIsExiting(true);
    setTimeout(() => {
      setIsExiting(false);
      onClose();
    }, 200);
  };

  /** X, Escape, backdrop. Abandons the dialog — publishes nothing. */
  const handleDismiss = () => {
    trackSharePromptAction({ tripId, action: "skip" });
    captureSharePromptAction({
      trip_id: tripId,
      action: "skip",
      experiment_variant: activeVariant,
    });
    closeWithExitAnimation();
  };

  /** The tertiary button: an affirmative "I'm finished here". */
  const handleDone = () => {
    publishIfChecked();
    if (!publishChecked) {
      trackSharePromptAction({ tripId, action: "skip" });
      captureSharePromptAction({
        trip_id: tripId,
        action: "skip",
        experiment_variant: activeVariant,
      });
    }
    closeWithExitAnimation();
  };

  const handleInvite = () => {
    publishIfChecked();
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
          onClick={handleDismiss}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-after-save-title"
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
                onClick={handleDismiss}
                aria-label={t("buttons.closeModal")}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
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

              <h2 id="share-after-save-title" className="text-xl font-bold text-center mb-1">{ts("afterSave.tripSaved")}</h2>
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

                {/* Publish-to-Explore, as an opt-OUT tick rather than the
                    button-into-a-second-modal it used to be. That chain cost
                    two clicks and a form at the exact moment the user wants
                    to be done, and it showed: 261 trips produced 14 public
                    ones from 5 publishers. The tick rides along with an exit
                    the user was already taking.

                    Pre-ticked only for unanchored trips (see isAnchored), and
                    only ever acted on from the two buttons below — never from
                    a dismissal. */}
                {onPublish && (
                  <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/60 cursor-pointer hover:border-slate-300 transition-colors">
                    <input
                      type="checkbox"
                      checked={publishChecked}
                      onChange={(e) => setPublishChecked(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-medium text-slate-900 text-sm">
                        <Globe className="w-4 h-4 text-[var(--primary)]" aria-hidden="true" />
                        {ts("afterSave.publishOptIn")}
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        {isAnchored
                          ? ts("afterSave.publishOptInAnchored")
                          : ts("afterSave.publishOptInHelp")}
                      </span>
                    </span>
                  </label>
                )}

                <button
                  onClick={handleDone}
                  className="w-full py-3 px-4 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl font-medium transition-colors text-sm"
                >
                  {publishChecked && onPublish
                    ? ts("afterSave.done")
                    : ts("afterSave.maybeLater")}
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
