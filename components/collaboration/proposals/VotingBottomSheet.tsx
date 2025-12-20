"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import type {
  ProposalWithVotes,
  ProposalVoteType,
  Activity,
} from "@/types";
import { getProposalTimeRemaining } from "@/lib/proposals/consensus";
import { PROPOSAL_TIMING } from "@/types";

interface VotingBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  proposal: ProposalWithVotes | null;
  currentUserId?: string;
  onVote: (voteType: ProposalVoteType, comment?: string) => Promise<void>;
  onRemoveVote?: () => Promise<void>;
  /** Total number of collaborators who can vote */
  totalVoters?: number;
  /** Whether the current user is the trip owner */
  isOwner?: boolean;
  /** Callback for owner force resolution */
  onForceResolve?: (action: 'approve' | 'reject') => Promise<void>;
}

/**
 * VotingBottomSheet - Mobile-friendly voting panel
 *
 * Design principles:
 * - Slide up from bottom (thumb-friendly)
 * - Drag handle for native feel
 * - Large vote buttons (min 52px height)
 * - Activity preview at top
 * - Vote progress with breakdown
 * - Comment option for rejection
 */
export function VotingBottomSheet({
  isOpen,
  onClose,
  proposal,
  currentUserId,
  onVote,
  onRemoveVote,
  totalVoters = 5,
  isOwner = false,
  onForceResolve,
}: VotingBottomSheetProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRejectComment, setShowRejectComment] = useState(false);
  const [rejectComment, setRejectComment] = useState("");

  // Don't render if no proposal
  if (!proposal) return null;

  const activity = proposal.activity_data as Activity;
  const userVote = proposal.current_user_vote;
  const hasVoted = !!userVote;
  const isDeadlock = proposal.consensus?.status === 'deadlock';

  // Calculate time remaining
  const timeRemaining = getProposalTimeRemaining(
    proposal.created_at,
    PROPOSAL_TIMING.EXPIRY_DAYS * 24
  );

  // Vote progress
  const voteCount = proposal.vote_summary.total;
  const approveCount = proposal.vote_summary.approve;
  const rejectCount = proposal.vote_summary.reject;
  const approvePercent = totalVoters > 0 ? (approveCount / totalVoters) * 100 : 0;

  // Format time
  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  };

  const formatTimeRemaining = (hours: number): string => {
    if (hours <= 0) return 'Expiring soon';
    if (hours < 24) return `${Math.round(hours)}h left`;
    const days = Math.floor(hours / 24);
    return `${days}d left`;
  };

  // Handle vote
  const handleVote = useCallback(async (voteType: ProposalVoteType) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const comment = voteType === 'reject' ? rejectComment.trim() : undefined;
      await onVote(voteType, comment);
      setRejectComment("");
      setShowRejectComment(false);
      onClose();
    } catch {
      // Error handling done by parent
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, onVote, rejectComment, onClose]);

  // Handle remove vote
  const handleRemoveVote = useCallback(async () => {
    if (isSubmitting || !onRemoveVote) return;
    setIsSubmitting(true);

    try {
      await onRemoveVote();
      onClose();
    } catch {
      // Error handling done by parent
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, onRemoveVote, onClose]);

  // Handle force resolve (owner only)
  const handleForceResolve = useCallback(async (action: 'approve' | 'reject') => {
    if (isSubmitting || !onForceResolve) return;
    setIsSubmitting(true);

    try {
      await onForceResolve(action);
      onClose();
    } catch {
      // Error handling done by parent
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, onForceResolve, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 z-50"
          />

          {/* Bottom Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 max-h-[85vh] overflow-hidden"
          >
            {/* Drag Handle */}
            <div className="flex justify-center py-3">
              <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
            </div>

            {/* Content */}
            <div className="px-6 pb-8 space-y-5 overflow-y-auto max-h-[calc(85vh-40px)]">
              {/* Activity Preview */}
              <div className="flex items-start gap-4">
                {/* Activity Image */}
                {activity.image_url && (
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    <Image
                      src={activity.image_url}
                      alt={activity.name}
                      width={64}
                      height={64}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-lg text-gray-900 leading-tight">
                    {activity.name}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Day {proposal.target_day + 1} • {formatTime(activity.start_time)}
                    {proposal.target_time_slot && ` • ${proposal.target_time_slot}`}
                  </p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                    {proposal.proposer?.avatar_url ? (
                      <Image
                        src={proposal.proposer.avatar_url}
                        alt={proposal.proposer.display_name}
                        width={18}
                        height={18}
                        className="w-[18px] h-[18px] rounded-full"
                      />
                    ) : (
                      <span className="w-[18px] h-[18px] bg-gray-200 rounded-full flex items-center justify-center text-[10px]">
                        👤
                      </span>
                    )}
                    <span>Proposed by {proposal.proposer?.display_name || 'Unknown'}</span>
                    <span>•</span>
                    <span>{formatTimeRemaining(timeRemaining.hours)}</span>
                  </div>
                </div>
              </div>

              {/* Proposal Note */}
              {proposal.note && (
                <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-600 italic">
                  "{proposal.note}"
                </div>
              )}

              {/* Vote Progress */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                {/* Progress Header */}
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">Voting Progress</span>
                  <span className="text-gray-500">{voteCount}/{totalVoters} voted</span>
                </div>

                {/* Progress Bar */}
                <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-green-400 to-green-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${approvePercent}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>

                {/* Vote Breakdown */}
                <div className="flex items-center justify-center gap-8 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">👍</span>
                    <span className="font-medium text-green-600">{approveCount}</span>
                    <span className="text-gray-400">approve</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">👎</span>
                    <span className="font-medium text-red-600">{rejectCount}</span>
                    <span className="text-gray-400">reject</span>
                  </div>
                </div>

                {/* User's Current Vote */}
                {hasVoted && (
                  <div className="text-center pt-2 border-t border-gray-200">
                    <span className="text-sm text-gray-600">
                      You voted: {' '}
                      <span className={`font-medium ${userVote === 'approve' ? 'text-green-600' : 'text-red-600'}`}>
                        {userVote === 'approve' ? '👍 Approve' : '👎 Reject'}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {/* Vote Buttons */}
              {!showRejectComment ? (
                <div className="space-y-3">
                  {/* Approve Button */}
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleVote('approve')}
                    disabled={isSubmitting}
                    className={`
                      w-full flex items-center justify-center gap-2 py-4 rounded-xl
                      font-semibold text-base transition-all
                      ${hasVoted && userVote === 'approve'
                        ? 'bg-green-100 text-green-700 ring-2 ring-green-500'
                        : 'bg-green-500 text-white hover:bg-green-600'
                      }
                      disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  >
                    <span className="text-xl">✅</span>
                    <span>{hasVoted && userVote === 'approve' ? 'Approved' : 'Approve'}</span>
                  </motion.button>

                  {/* Reject Button */}
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      if (hasVoted && userVote === 'reject') {
                        // Already rejected, just confirm
                        handleVote('reject');
                      } else {
                        // Show comment input
                        setShowRejectComment(true);
                      }
                    }}
                    disabled={isSubmitting}
                    className={`
                      w-full flex items-center justify-center gap-2 py-4 rounded-xl
                      font-semibold text-base transition-all
                      ${hasVoted && userVote === 'reject'
                        ? 'bg-red-100 text-red-700 ring-2 ring-red-500'
                        : 'bg-gray-100 text-gray-700 hover:bg-red-50 hover:text-red-600'
                      }
                      disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  >
                    <span className="text-xl">❌</span>
                    <span>{hasVoted && userVote === 'reject' ? 'Rejected' : 'Reject'}</span>
                  </motion.button>
                </div>
              ) : (
                /* Reject Comment Input */
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-700">
                    Reason for rejection (optional)
                  </label>
                  <textarea
                    value={rejectComment}
                    onChange={(e) => setRejectComment(e.target.value)}
                    placeholder="Help the team understand why..."
                    className="w-full p-3 border border-gray-300 rounded-xl text-sm
                               focus:ring-2 focus:ring-red-500 focus:border-red-500
                               resize-none"
                    rows={2}
                    maxLength={200}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowRejectComment(false);
                        setRejectComment("");
                      }}
                      className="flex-1 py-3 rounded-xl text-gray-600 bg-gray-100
                                 hover:bg-gray-200 font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleVote('reject')}
                      disabled={isSubmitting}
                      className="flex-1 py-3 rounded-xl text-white bg-red-500
                                 hover:bg-red-600 font-medium transition-colors
                                 disabled:opacity-50"
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit Rejection'}
                    </motion.button>
                  </div>
                </div>
              )}

              {/* Change Vote / Remove Vote */}
              {hasVoted && onRemoveVote && !showRejectComment && (
                <button
                  onClick={handleRemoveVote}
                  disabled={isSubmitting}
                  className="w-full text-center text-sm text-gray-500 hover:text-gray-700
                             py-2 transition-colors disabled:opacity-50"
                >
                  Remove my vote
                </button>
              )}

              {/* Owner Actions (for deadlock) */}
              {isOwner && isDeadlock && onForceResolve && (
                <div className="bg-amber-50 rounded-xl p-4 space-y-3 border border-amber-200">
                  <div className="flex items-center gap-2 text-amber-700">
                    <span className="text-lg">⚠️</span>
                    <span className="font-medium">Voting is deadlocked</span>
                  </div>
                  <p className="text-sm text-amber-600">
                    As the trip owner, you can make the final decision.
                  </p>
                  <div className="flex gap-2">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleForceResolve('approve')}
                      disabled={isSubmitting}
                      className="flex-1 py-3 rounded-xl text-white bg-green-500
                                 hover:bg-green-600 font-medium transition-colors
                                 disabled:opacity-50"
                    >
                      Force Approve
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleForceResolve('reject')}
                      disabled={isSubmitting}
                      className="flex-1 py-3 rounded-xl text-white bg-red-500
                                 hover:bg-red-600 font-medium transition-colors
                                 disabled:opacity-50"
                    >
                      Force Reject
                    </motion.button>
                  </div>
                </div>
              )}

              {/* Activity Details */}
              {activity.description && (
                <div className="pt-2">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">About this activity</h4>
                  <p className="text-sm text-gray-600">
                    {activity.description}
                  </p>
                </div>
              )}

              {/* Vote History (collapsed) */}
              {proposal.votes.length > 0 && (
                <details className="group">
                  <summary className="text-sm font-medium text-gray-700 cursor-pointer
                                      hover:text-gray-900 list-none flex items-center gap-2">
                    <span>View all votes ({proposal.votes.length})</span>
                    <span className="text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="mt-3 space-y-2">
                    {proposal.votes.map((vote) => (
                      <div
                        key={vote.id}
                        className="flex items-center gap-3 text-sm bg-gray-50 rounded-lg p-2"
                      >
                        {vote.user?.avatar_url ? (
                          <Image
                            src={vote.user.avatar_url}
                            alt={vote.user.display_name}
                            width={24}
                            height={24}
                            className="w-6 h-6 rounded-full"
                          />
                        ) : (
                          <span className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-xs">
                            👤
                          </span>
                        )}
                        <span className="flex-1 text-gray-700">
                          {vote.user?.display_name || 'Unknown'}
                        </span>
                        <span>
                          {vote.vote_type === 'approve' ? '👍' : '👎'}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
