"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence, useDragControls, PanInfo } from "framer-motion";
import Image from "next/image";
import type {
  ProposalWithVotes,
  ProposalVoteType,
  Activity,
} from "@/types";
import { getProposalTimeRemaining } from "@/lib/proposals/consensus";
import { PROPOSAL_TIMING } from "@/types";

/**
 * 4-Level Voting Options for Proposals
 * Maps to binary approve/reject for storage but provides nuanced UX
 */
const PROPOSAL_VOTE_OPTIONS = [
  {
    id: 'love' as const,
    label: 'Love it!',
    emoji: '😍',
    mapsTo: 'approve' as ProposalVoteType,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    ringColor: 'ring-green-500',
    hoverBg: 'hover:bg-green-100',
    description: 'This is a must-do!',
    requiresComment: false,
  },
  {
    id: 'flexible' as const,
    label: 'Open to it',
    emoji: '👌',
    mapsTo: 'approve' as ProposalVoteType,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    ringColor: 'ring-blue-500',
    hoverBg: 'hover:bg-blue-100',
    description: "I'm flexible on this",
    requiresComment: false,
  },
  {
    id: 'concerns' as const,
    label: 'Concerns',
    emoji: '🤔',
    mapsTo: 'reject' as ProposalVoteType,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    ringColor: 'ring-amber-500',
    hoverBg: 'hover:bg-amber-100',
    description: 'I have some reservations',
    requiresComment: true,
  },
  {
    id: 'skip' as const,
    label: 'Skip this',
    emoji: '👎',
    mapsTo: 'reject' as ProposalVoteType,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    ringColor: 'ring-red-500',
    hoverBg: 'hover:bg-red-100',
    description: "This isn't for me",
    requiresComment: true,
  },
] as const;

type VoteOptionId = typeof PROPOSAL_VOTE_OPTIONS[number]['id'];

interface VotingBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  proposal: ProposalWithVotes | null;
  currentUserId?: string;
  onVote: (voteType: ProposalVoteType, comment?: string) => Promise<void>;
  onRemoveVote?: () => Promise<void>;
  totalVoters?: number;
  isOwner?: boolean;
  onForceResolve?: (action: 'approve' | 'reject') => Promise<void>;
}

/**
 * VotingBottomSheet - Premium mobile-first voting experience
 *
 * Uses 4-level voting (Love/Open/Concerns/Skip) for nuanced feedback
 * while storing as binary (approve/reject) in the database.
 */
export function VotingBottomSheet({
  isOpen,
  onClose,
  proposal,
  onVote,
  onRemoveVote,
  totalVoters = 5,
  isOwner = false,
  onForceResolve,
}: VotingBottomSheetProps) {
  // ======================================================================
  // ALL HOOKS MUST BE CALLED UNCONDITIONALLY (Rules of Hooks)
  // ======================================================================

  const dragControls = useDragControls();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedOption, setSelectedOption] = useState<VoteOptionId | null>(null);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [comment, setComment] = useState("");

  const handleVote = useCallback(async (option: typeof PROPOSAL_VOTE_OPTIONS[number]) => {
    if (isSubmitting) return;

    // If requires comment and not showing input yet, show it
    if (option.requiresComment && !showCommentInput) {
      setSelectedOption(option.id);
      setShowCommentInput(true);
      return;
    }

    setIsSubmitting(true);
    try {
      await onVote(option.mapsTo, comment.trim() || undefined);
      setComment("");
      setShowCommentInput(false);
      setSelectedOption(null);
      onClose();
    } catch {
      // Error handling done by parent
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, onVote, comment, showCommentInput, onClose]);

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

  const activity = useMemo(() => {
    return proposal?.activity_data as Activity | null;
  }, [proposal?.activity_data]);

  const isValidActivity = useMemo(() => {
    return activity && typeof activity === 'object' && !!activity.name;
  }, [activity]);

  const userVote = proposal?.current_user_vote;
  const hasVoted = !!userVote;
  const isDeadlock = proposal?.consensus?.status === 'deadlock';

  const timeRemaining = useMemo(() => {
    if (!proposal) return { hours: 0, minutes: 0, isExpired: true, isExpiringSoon: false };
    return getProposalTimeRemaining(
      proposal.created_at,
      PROPOSAL_TIMING.EXPIRY_DAYS * 24
    );
  }, [proposal]);

  const voteCount = proposal?.vote_summary.total ?? 0;
  const approveCount = proposal?.vote_summary.approve ?? 0;
  const rejectCount = proposal?.vote_summary.reject ?? 0;
  const positivePercent = totalVoters > 0 ? (approveCount / totalVoters) * 100 : 0;

  // ======================================================================
  // END OF HOOKS - CONDITIONAL RENDERING BELOW
  // ======================================================================

  const formatTime = (time: string) => {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  };

  const formatDuration = (mins: number) => {
    if (!mins) return '';
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remaining = mins % 60;
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
  };

  const formatTimeRemaining = (hours: number): string => {
    if (hours <= 0) return 'Expiring soon';
    if (hours < 24) return `${Math.round(hours)}h left`;
    const days = Math.floor(hours / 24);
    return `${days}d left`;
  };

  // Get user's selected option based on their vote
  const getUserSelectedOption = (): VoteOptionId | null => {
    if (!userVote) return null;
    // Map approve/reject back to the first matching option
    return userVote === 'approve' ? 'love' : 'skip';
  };

  if (!isOpen) return null;

  if (!proposal) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/40 z-50"
        />
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          dragListener={false}
          dragControls={dragControls}
          onDragEnd={(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
            if (info.offset.y > 100 || info.velocity.y > 500) {
              onClose();
            }
          }}
          className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 p-6"
        >
          <div
            className="flex justify-center py-3 cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => dragControls.start(e)}
            style={{ touchAction: 'none' }}
          >
            <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
          </div>
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No proposal selected</p>
            <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700">
              Close
            </button>
          </div>
        </motion.div>
      </>
    );
  }

  if (!isValidActivity || !activity) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/40 z-50"
        />
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.5 }}
          dragListener={false}
          dragControls={dragControls}
          onDragEnd={(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
            if (info.offset.y > 100 || info.velocity.y > 500) {
              onClose();
            }
          }}
          className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 p-6"
        >
          <div
            className="flex justify-center py-3 cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => dragControls.start(e)}
            style={{ touchAction: 'none' }}
          >
            <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
          </div>
          <div className="text-center py-8">
            <p className="text-red-600 mb-4">Unable to load proposal details</p>
            <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700">
              Close
            </button>
          </div>
        </motion.div>
      </>
    );
  }

  const userSelectedOption = getUserSelectedOption();

  return (
    <AnimatePresence>
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
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        dragListener={false}
        dragControls={dragControls}
        onDragEnd={(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
          // Close if dragged down more than 100px or with velocity
          if (info.offset.y > 100 || info.velocity.y > 500) {
            onClose();
          }
        }}
        className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 max-h-[90vh] overflow-hidden"
      >
        {/* Drag Handle - Swipe down to close */}
        <div
          className="flex justify-center py-4 cursor-grab active:cursor-grabbing select-none"
          onPointerDown={(e) => dragControls.start(e)}
          style={{ touchAction: 'none' }}
        >
          <div className="w-12 h-1.5 bg-gray-300 rounded-full hover:bg-gray-400 transition-colors" />
          <span className="sr-only">Drag to close</span>
        </div>

        {/* Content - Scrollable */}
        <div className="px-5 pb-8 space-y-5 overflow-y-auto max-h-[calc(90vh-56px)] overscroll-contain">

          {/* Activity Preview Card */}
          <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-2xl p-4">
            <div className="flex items-start gap-4">
              {activity.image_url && (
                <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-200 flex-shrink-0 shadow-sm">
                  <Image
                    src={activity.image_url}
                    alt={activity.name}
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg text-gray-900 leading-tight">
                  {activity.name}
                </h3>

                {/* Activity Details */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    <span>📅</span> Day {proposal.target_day + 1}
                  </span>
                  {activity.start_time && (
                    <span className="flex items-center gap-1">
                      <span>🕐</span> {formatTime(activity.start_time)}
                    </span>
                  )}
                  {activity.duration_minutes && (
                    <span className="flex items-center gap-1">
                      <span>⏱️</span> {formatDuration(activity.duration_minutes)}
                    </span>
                  )}
                </div>

                {/* Activity Type & Location */}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {activity.type && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white text-gray-600 border border-gray-200 capitalize">
                      {activity.type}
                    </span>
                  )}
                  {activity.location && (
                    <span className="text-xs text-gray-400 truncate max-w-[150px]">
                      📍 {activity.location}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Proposer Info */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-200/50">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                {proposal.proposer?.avatar_url ? (
                  <Image
                    src={proposal.proposer.avatar_url}
                    alt={proposal.proposer.display_name}
                    width={24}
                    height={24}
                    className="w-6 h-6 rounded-full"
                  />
                ) : (
                  <span className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-xs">
                    👤
                  </span>
                )}
                <span>Suggested by <span className="font-medium text-gray-700">{proposal.proposer?.display_name || 'Unknown'}</span></span>
              </div>
              <span className="text-xs text-gray-400">
                {formatTimeRemaining(timeRemaining.hours)}
              </span>
            </div>
          </div>

          {/* Proposal Note */}
          {proposal.note && (
            <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3 text-sm text-amber-800">
              <span className="font-medium">Note:</span> "{proposal.note}"
            </div>
          )}

          {/* Vote Progress - Compact */}
          <div className="flex items-center gap-3 py-2">
            <div className="flex-1">
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-green-400 to-emerald-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${positivePercent}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500 flex-shrink-0">
              <span className="flex items-center gap-1">
                <span className="text-green-500">👍</span>
                <span className="font-medium">{approveCount}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-red-400">👎</span>
                <span className="font-medium">{rejectCount}</span>
              </span>
              <span className="text-gray-400">of {totalVoters}</span>
            </div>
          </div>

          {/* User's Current Vote Status */}
          {hasVoted && (
            <div className="flex items-center justify-center gap-2 py-2 bg-gray-50 rounded-xl">
              <span className="text-sm text-gray-600">Your vote:</span>
              <span className={`text-sm font-medium ${userVote === 'approve' ? 'text-green-600' : 'text-red-600'}`}>
                {userVote === 'approve' ? '👍 Positive' : '👎 Negative'}
              </span>
            </div>
          )}

          {/* Vote Buttons - 2x2 Grid */}
          {!showCommentInput ? (
            <div className="grid grid-cols-2 gap-3">
              {PROPOSAL_VOTE_OPTIONS.map((option) => {
                const isSelected = userSelectedOption === option.id || selectedOption === option.id;
                const isPositive = option.mapsTo === 'approve';

                return (
                  <motion.button
                    key={option.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleVote(option)}
                    disabled={isSubmitting}
                    className={`
                      flex flex-col items-center justify-center gap-1 py-4 px-3 rounded-2xl
                      font-medium text-sm transition-all duration-200
                      ${isSelected
                        ? `${option.bgColor} ${option.color} ring-2 ${option.ringColor}`
                        : `bg-gray-50 text-gray-600 ${option.hoverBg}`
                      }
                      disabled:opacity-50 disabled:cursor-not-allowed
                      ${isPositive ? 'border-l-4 border-l-transparent hover:border-l-green-400' : 'border-l-4 border-l-transparent hover:border-l-red-300'}
                    `}
                  >
                    <span className="text-2xl">{option.emoji}</span>
                    <span className="font-semibold">{option.label}</span>
                    <span className="text-xs text-gray-400 font-normal">{option.description}</span>
                  </motion.button>
                );
              })}
            </div>
          ) : (
            /* Comment Input for Concerns/Skip */
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <span className="text-lg">
                  {PROPOSAL_VOTE_OPTIONS.find(o => o.id === selectedOption)?.emoji}
                </span>
                <span>Why do you feel this way? (optional)</span>
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Help your travel buddies understand..."
                className="w-full p-4 border border-gray-200 rounded-xl text-sm
                           focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                           resize-none bg-gray-50"
                rows={3}
                maxLength={200}
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowCommentInput(false);
                    setComment("");
                    setSelectedOption(null);
                  }}
                  className="flex-1 py-3 rounded-xl text-gray-600 bg-gray-100
                             hover:bg-gray-200 font-medium transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    const option = PROPOSAL_VOTE_OPTIONS.find(o => o.id === selectedOption);
                    if (option) handleVote(option);
                  }}
                  disabled={isSubmitting}
                  className="flex-1 py-3 rounded-xl text-white bg-gray-800
                             hover:bg-gray-900 font-medium transition-colors
                             disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Vote'}
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Change Vote Option */}
          {hasVoted && onRemoveVote && !showCommentInput && (
            <button
              onClick={handleRemoveVote}
              disabled={isSubmitting}
              className="w-full text-center text-sm text-gray-400 hover:text-gray-600
                         py-2 transition-colors disabled:opacity-50"
            >
              Change my vote
            </button>
          )}

          {/* Owner Actions (for deadlock) */}
          {isOwner && isDeadlock && onForceResolve && (
            <div className="bg-amber-50 rounded-xl p-4 space-y-3 border border-amber-200">
              <div className="flex items-center gap-2 text-amber-700">
                <span className="text-lg">⚠️</span>
                <span className="font-medium">Voting is split</span>
              </div>
              <p className="text-sm text-amber-600">
                As the trip organizer, you can make the final call.
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
                  Add to Plan
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleForceResolve('reject')}
                  disabled={isSubmitting}
                  className="flex-1 py-3 rounded-xl text-white bg-gray-500
                             hover:bg-gray-600 font-medium transition-colors
                             disabled:opacity-50"
                >
                  Skip This
                </motion.button>
              </div>
            </div>
          )}

          {/* Activity Description - if available */}
          {activity.description && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-sm text-gray-600 leading-relaxed">
                {activity.description}
              </p>
            </div>
          )}

          {/* Votes List - Collapsed */}
          {proposal.votes.length > 0 && (
            <details className="group">
              <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-600
                                  list-none flex items-center gap-2 py-2">
                <span>See who voted ({proposal.votes.length})</span>
                <span className="group-open:rotate-180 transition-transform text-xs">▼</span>
              </summary>
              <div className="mt-2 space-y-2">
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
                    <span className="flex-1 text-gray-700">{vote.user?.display_name || 'Unknown'}</span>
                    <span>{vote.vote_type === 'approve' ? '👍' : '👎'}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
