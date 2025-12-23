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
import { trackSharePromptShown, trackSharePromptAction } from "@/lib/analytics";

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
    title: "Plan Together",
    description: "Invite friends to view and edit the itinerary",
  },
  {
    icon: Vote,
    title: "Vote on Activities",
    description: "Let everyone vote on what to do each day",
  },
  {
    icon: MessageSquare,
    title: "Suggest Ideas",
    description: "Collaborators can propose new activities",
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
  const [isExiting, setIsExiting] = useState(false);
  const hasTrackedView = useRef(false);

  // Track prompt shown (only once)
  useEffect(() => {
    if (isOpen && !hasTrackedView.current) {
      trackSharePromptShown({
        tripId,
        tripDestination: destination,
        tripDays,
      });
      hasTrackedView.current = true;
    }
  }, [isOpen, tripId, destination, tripDays]);

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
    trackSharePromptAction({ tripId, action: "skip" });
    setIsExiting(true);
    setTimeout(() => {
      setIsExiting(false);
      onClose();
    }, 200);
  };

  const handleInvite = () => {
    trackSharePromptAction({ tripId, action: "invite" });
    onInvite();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && !isExiting && (
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

              <h2 className="text-xl font-bold text-center mb-1">Trip Saved!</h2>
              <p className="text-white/80 text-center text-sm">
                {tripDays} days in {destination}
              </p>
            </div>

            {/* Collaboration CTA */}
            <div className="p-6">
              <h3 className="text-lg font-semibold text-slate-900 text-center mb-2">
                Traveling with friends?
              </h3>
              <p className="text-slate-500 text-center text-sm mb-6">
                Invite them to collaborate on your trip!
              </p>

              {/* Benefits */}
              <div className="space-y-3 mb-6">
                {COLLABORATION_BENEFITS.map((benefit, index) => (
                  <motion.div
                    key={benefit.title}
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
                        {benefit.title}
                      </p>
                      <p className="text-slate-500 text-xs">
                        {benefit.description}
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
                  Invite Trip Buddies
                  <ArrowRight className="w-4 h-4 ml-1" />
                </motion.button>

                <button
                  onClick={handleSkip}
                  className="w-full py-3 px-4 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl font-medium transition-colors text-sm"
                >
                  Maybe Later
                </button>
              </div>

              {/* Social proof hint */}
              <p className="text-center text-xs text-slate-400 mt-4">
                Trips with collaborators have 3x more activities planned
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
