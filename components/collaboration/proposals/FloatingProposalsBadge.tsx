"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { ProposalWithVotes } from "@/types";

interface FloatingProposalsBadgeProps {
  proposals: ProposalWithVotes[];
  onClick?: () => void;
}

/**
 * FloatingProposalsBadge - Prominent floating indicator for pending proposals
 *
 * Shows a fixed-position badge when there are proposals awaiting votes.
 * Cannot be ignored - designed for maximum visibility.
 */
export function FloatingProposalsBadge({
  proposals,
  onClick,
}: FloatingProposalsBadgeProps) {
  const pendingCount = proposals.filter(
    p => p.status === 'pending' || p.status === 'voting'
  ).length;

  if (pendingCount === 0) return null;

  return (
    <AnimatePresence>
      <motion.button
        initial={{ opacity: 0, scale: 0.5, y: 50 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.5, y: 50 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onClick}
        className="fixed bottom-24 right-4 sm:bottom-8 sm:right-8 z-[100]
                   flex items-center gap-2 px-5 py-3
                   bg-gradient-to-r from-blue-600 to-indigo-600
                   text-white rounded-full shadow-xl
                   hover:from-blue-700 hover:to-indigo-700
                   transition-colors cursor-pointer"
        style={{
          boxShadow: "0 4px 20px rgba(79, 70, 229, 0.4)",
        }}
      >
        {/* Animated ping indicator */}
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
        </span>

        <span className="text-lg">🗳️</span>
        <span className="font-semibold">
          {pendingCount} vote{pendingCount !== 1 ? 's' : ''} needed
        </span>
      </motion.button>
    </AnimatePresence>
  );
}
