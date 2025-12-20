"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type {
  ProposalWithVotes,
  ProposalVoteType,
  CollaboratorRole,
} from "@/types";
import { ROLE_PERMISSIONS } from "@/types";
import { ProposalCard } from "./ProposalCard";
import { EmptySlotCard } from "./EmptySlotCard";

interface ProposalSectionProps {
  /** All proposals for this day */
  proposals: ProposalWithVotes[];
  /** Current day number (1-indexed) */
  dayNumber: number;
  /** Whether the current user is the trip owner */
  isOwner: boolean;
  /** Current user ID */
  currentUserId?: string;
  /** Current user's role */
  userRole: CollaboratorRole;
  /** Number of activities already in this day */
  activityCount: number;
  /** Callback when user votes on a proposal */
  onVote: (proposalId: string, voteType: ProposalVoteType, comment?: string) => Promise<void>;
  /** Callback when user removes their vote */
  onRemoveVote?: (proposalId: string) => Promise<void>;
  /** Callback when proposer withdraws their proposal */
  onWithdraw?: (proposalId: string) => Promise<void>;
  /** Callback when owner force-resolves a proposal */
  onForceResolve?: (proposalId: string, action: 'approve' | 'reject') => Promise<void>;
  /** Callback to open the propose activity sheet */
  onProposeActivity: (day: number, timeSlot?: 'morning' | 'afternoon' | 'evening') => void;
  /** Whether edit mode is active (proposals hidden in edit mode) */
  isEditMode?: boolean;
  /** Whether voting is globally enabled */
  votingEnabled?: boolean;
}

type TimeSlot = 'morning' | 'afternoon' | 'evening';

const TIME_SLOTS: TimeSlot[] = ['morning', 'afternoon', 'evening'];

/**
 * ProposalSection - Displays proposals and empty slots for a day
 *
 * Design principles:
 * - Shows proposals grouped by time slot
 * - Shows "Add activity" prompts for empty slots
 * - Hides in edit mode (editing uses different UI)
 * - Mobile-first responsive layout
 */
export function ProposalSection({
  proposals,
  dayNumber,
  isOwner,
  currentUserId,
  userRole,
  activityCount,
  onVote,
  onRemoveVote,
  onWithdraw,
  onForceResolve,
  onProposeActivity,
  isEditMode = false,
  votingEnabled = true,
}: ProposalSectionProps) {
  // Reserved for future expansion feature
  // const [expandedTimeSlot, setExpandedTimeSlot] = useState<TimeSlot | null>(null);

  // User permissions
  const canVote = ROLE_PERMISSIONS[userRole]?.canVote ?? false;
  const canPropose = ROLE_PERMISSIONS[userRole]?.canSuggest ?? false; // canSuggest = canPropose

  // Filter active proposals for this day
  const activeProposals = useMemo(() => {
    return proposals.filter(
      (p) => p.status === 'pending' || p.status === 'voting'
    );
  }, [proposals]);

  // Group proposals by time slot
  const proposalsBySlot = useMemo(() => {
    const grouped: Record<TimeSlot | 'unspecified', ProposalWithVotes[]> = {
      morning: [],
      afternoon: [],
      evening: [],
      unspecified: [],
    };

    activeProposals.forEach((proposal) => {
      const slot = proposal.target_time_slot as TimeSlot | undefined;
      if (slot && TIME_SLOTS.includes(slot)) {
        grouped[slot].push(proposal);
      } else {
        grouped.unspecified.push(proposal);
      }
    });

    return grouped;
  }, [activeProposals]);

  // Don't show in edit mode
  if (isEditMode) {
    return null;
  }

  // Don't show if voting is disabled
  if (!votingEnabled) {
    return null;
  }

  // Check if there are any proposals at all
  const hasAnyProposals = activeProposals.length > 0;

  // Determine if we should show empty slot prompts
  // Show when there are few activities and user can propose
  const showEmptySlotPrompts = canPropose && activityCount < 6;

  // If no proposals and no empty slot prompts, don't render anything
  if (!hasAnyProposals && !showEmptySlotPrompts) {
    return null;
  }

  return (
    <motion.div
      className="mt-6 space-y-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      data-proposals-section
    >
      {/* Section Header - More prominent when there are proposals */}
      {hasAnyProposals && (
        <motion.div
          className="flex items-center gap-3"
          initial={{ scale: 0.95 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1 }}
        >
          <motion.div
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full shadow-md"
            animate={{
              boxShadow: [
                "0 4px 6px -1px rgba(59, 130, 246, 0.3)",
                "0 4px 12px -1px rgba(59, 130, 246, 0.5)",
                "0 4px 6px -1px rgba(59, 130, 246, 0.3)"
              ]
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <span className="text-base">🗳️</span>
            <span className="text-sm font-semibold text-white">
              {activeProposals.length} Active Proposal{activeProposals.length !== 1 ? 's' : ''} - Vote Now!
            </span>
          </motion.div>
          <div className="flex-1 h-px bg-blue-200" />
        </motion.div>
      )}

      {/* Proposals List - Wrapped in prominent container */}
      {hasAnyProposals && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-4 space-y-3 shadow-sm">
          <AnimatePresence mode="popLayout">
            {activeProposals.map((proposal) => (
              <motion.div
                key={proposal.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <ProposalCard
                  proposal={proposal}
                  currentUserId={currentUserId}
                  isOwner={isOwner}
                  canVote={canVote}
                  onVote={onVote}
                  onRemoveVote={onRemoveVote}
                  onWithdraw={onWithdraw}
                  onForceResolve={onForceResolve}
                  showActions={true}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          <p className="text-xs text-center text-blue-600 font-medium pt-1">
            👆 Tap a proposal to vote
          </p>
        </div>
      )}

      {/* Empty Slot Prompts */}
      {showEmptySlotPrompts && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {TIME_SLOTS.map((slot) => {
            const slotProposals = proposalsBySlot[slot];

            return (
              <EmptySlotCard
                key={slot}
                day={dayNumber}
                timeSlot={slot}
                onPropose={() => onProposeActivity(dayNumber, slot)}
                disabled={!canPropose}
                proposalCount={slotProposals.length}
              />
            );
          })}
        </div>
      )}

      {/* General propose button when there are many activities */}
      {canPropose && !showEmptySlotPrompts && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onProposeActivity(dayNumber)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3
                     border-2 border-dashed border-blue-300 rounded-xl
                     text-blue-600 font-medium
                     hover:border-blue-400 hover:bg-blue-50
                     transition-colors"
        >
          <span className="text-lg">➕</span>
          <span>Propose an activity</span>
        </motion.button>
      )}
    </motion.div>
  );
}

/**
 * Compact version for showing proposal count indicator
 * More prominent with pulse animation
 */
export function ProposalIndicator({
  count,
  onClick,
}: {
  count: number;
  onClick?: () => void;
}) {
  if (count === 0) return null;

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5
                 bg-gradient-to-r from-blue-500 to-blue-600 text-white
                 rounded-full text-xs font-semibold shadow-md
                 hover:from-blue-600 hover:to-blue-700 transition-all"
      animate={{
        boxShadow: [
          "0 2px 4px rgba(59, 130, 246, 0.3)",
          "0 4px 8px rgba(59, 130, 246, 0.5)",
          "0 2px 4px rgba(59, 130, 246, 0.3)"
        ]
      }}
      transition={{ duration: 2, repeat: Infinity }}
    >
      <span>🗳️</span>
      <span>{count} pending vote{count !== 1 ? 's' : ''}</span>
    </motion.button>
  );
}
