"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence, useDragControls, PanInfo } from "framer-motion";
import { useTranslations } from "next-intl";
import Image from "next/image";
import type {
  ProposalWithVotes,
  ProposalVoteType,
  Activity,
  VoteType,
} from "@/types";
import { getProposalTimeRemaining } from "@/lib/proposals/consensus";
import { PROPOSAL_TIMING, VOTE_INFO } from "@/types";

/**
 * 4-Level Voting Options for Proposals
 * Now stores actual vote type in database (no more mapping)
 * Unified with activity voting for consistency
 */
// Vote options with styling - labels/descriptions resolved at render time via translations
const PROPOSAL_VOTE_OPTIONS: Array<{
  id: VoteType;
  labelKey: string;
  emoji: string;
  color: string;
  bgColor: string;
  ringColor: string;
  hoverBg: string;
  descriptionKey: string;
  requiresComment: boolean;
  isPositive: boolean;
}> = [
  {
    id: 'love',
    labelKey: VOTE_INFO.love.labelKey,
    emoji: VOTE_INFO.love.emoji,
    color: VOTE_INFO.love.color,
    bgColor: VOTE_INFO.love.bgColor,
    ringColor: 'ring-green-500',
    hoverBg: 'hover:bg-green-100',
    descriptionKey: VOTE_INFO.love.descriptionKey,
    requiresComment: VOTE_INFO.love.requiresComment,
    isPositive: true,
  },
  {
    id: 'flexible',
    labelKey: VOTE_INFO.flexible.labelKey,
    emoji: VOTE_INFO.flexible.emoji,
    color: VOTE_INFO.flexible.color,
    bgColor: VOTE_INFO.flexible.bgColor,
    ringColor: 'ring-blue-500',
    hoverBg: 'hover:bg-blue-100',
    descriptionKey: VOTE_INFO.flexible.descriptionKey,
    requiresComment: VOTE_INFO.flexible.requiresComment,
    isPositive: true,
  },
  {
    id: 'concerns',
    labelKey: VOTE_INFO.concerns.labelKey,
    emoji: VOTE_INFO.concerns.emoji,
    color: VOTE_INFO.concerns.color,
    bgColor: VOTE_INFO.concerns.bgColor,
    ringColor: 'ring-amber-500',
    hoverBg: 'hover:bg-amber-100',
    descriptionKey: VOTE_INFO.concerns.descriptionKey,
    requiresComment: VOTE_INFO.concerns.requiresComment,
    isPositive: false,
  },
  {
    id: 'no',
    labelKey: VOTE_INFO.no.labelKey,
    emoji: VOTE_INFO.no.emoji,
    color: VOTE_INFO.no.color,
    bgColor: VOTE_INFO.no.bgColor,
    ringColor: 'ring-red-500',
    hoverBg: 'hover:bg-red-100',
    descriptionKey: VOTE_INFO.no.descriptionKey,
    requiresComment: VOTE_INFO.no.requiresComment,
    isPositive: false,
  },
];

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

  const t = useTranslations('common.voting');
  const tc = useTranslations('common.buttons');
  const dragControls = useDragControls();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedOption, setSelectedOption] = useState<VoteType | null>(null);
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
      // Now using option.id directly - no more mapping to binary approve/reject
      await onVote(option.id, comment.trim() || undefined);
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

  // 4-level vote counts from unified voting system
  const voteCount = proposal?.vote_summary.total ?? 0;
  const loveCount = proposal?.vote_summary.love ?? 0;
  const flexibleCount = proposal?.vote_summary.flexible ?? 0;
  const concernsCount = proposal?.vote_summary.concerns ?? 0;
  const noCount = proposal?.vote_summary.no ?? 0;
  // Positive = love + flexible, used for progress bar
  const positiveCount = loveCount + flexibleCount;
  const negativeCount = concernsCount + noCount;
  const positivePercent = totalVoters > 0 ? (positiveCount / totalVoters) * 100 : 0;

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
    if (hours <= 0) return t('expiringSoon');
    if (hours < 24) return t('hoursLeft', { hours: Math.round(hours) });
    const days = Math.floor(hours / 24);
    return t('daysLeft', { days });
  };

  // Get user's selected option based on their vote
  // Now returns actual vote type directly (no more guessing from binary)
  const getUserSelectedOption = (): VoteType | null => {
    if (!userVote) return null;
    // Vote is now stored as actual type (love/flexible/concerns/no)
    return userVote as VoteType;
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
            <p className="text-gray-500 mb-4">{t('noProposalSelected')}</p>
            <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700">
              {tc('close')}
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
            <p className="text-red-600 mb-4">{t('unableToLoad')}</p>
            <button onClick={onClose} className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700">
              {tc('close')}
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
          <span className="sr-only">{t('dragToClose')}</span>
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
                    <span>📅</span> {t('day', { day: proposal.target_day + 1 })}
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
                <span>{t('suggestedBy')} <span className="font-medium text-gray-700">{proposal.proposer?.display_name || t('unknown')}</span></span>
              </div>
              <span className="text-xs text-gray-400">
                {formatTimeRemaining(timeRemaining.hours)}
              </span>
            </div>
          </div>

          {/* Proposal Note */}
          {proposal.note && (
            <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-3 text-sm text-amber-800">
              <span className="font-medium">{t('note')}:</span> &quot;{proposal.note}&quot;
            </div>
          )}

          {/* Vote Progress - 4-Level Display */}
          <div className="space-y-2 py-2">
            {/* Progress bar */}
            <div className="flex items-center gap-3">
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
              <span className="text-sm text-gray-400 flex-shrink-0">{voteCount}/{totalVoters}</span>
            </div>
            {/* 4-Level Vote Breakdown */}
            <div className="flex items-center justify-center gap-4 text-sm">
              <span className="flex items-center gap-1" title={t(VOTE_INFO.love.labelKey)}>
                <span>{VOTE_INFO.love.emoji}</span>
                <span className="font-medium text-gray-600">{loveCount}</span>
              </span>
              <span className="flex items-center gap-1" title={t(VOTE_INFO.flexible.labelKey)}>
                <span>{VOTE_INFO.flexible.emoji}</span>
                <span className="font-medium text-gray-600">{flexibleCount}</span>
              </span>
              <span className="flex items-center gap-1" title={t(VOTE_INFO.concerns.labelKey)}>
                <span>{VOTE_INFO.concerns.emoji}</span>
                <span className="font-medium text-gray-600">{concernsCount}</span>
              </span>
              <span className="flex items-center gap-1" title={t(VOTE_INFO.no.labelKey)}>
                <span>{VOTE_INFO.no.emoji}</span>
                <span className="font-medium text-gray-600">{noCount}</span>
              </span>
            </div>
          </div>

          {/* User's Current Vote Status - Shows actual vote type */}
          {hasVoted && userVote && (
            <div className="flex items-center justify-center gap-2 py-2 bg-gray-50 rounded-xl">
              <span className="text-sm text-gray-600">{t('yourVote')}</span>
              <span className={`text-sm font-medium ${VOTE_INFO[userVote as VoteType]?.color || 'text-gray-600'}`}>
                {VOTE_INFO[userVote as VoteType]?.emoji} {t(VOTE_INFO[userVote as VoteType]?.labelKey)}
              </span>
            </div>
          )}

          {/* Vote Buttons - 2x2 Grid */}
          {!showCommentInput ? (
            <div className="grid grid-cols-2 gap-3">
              {PROPOSAL_VOTE_OPTIONS.map((option) => {
                const isSelected = userSelectedOption === option.id || selectedOption === option.id;

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
                      ${option.isPositive ? 'border-l-4 border-l-transparent hover:border-l-green-400' : 'border-l-4 border-l-transparent hover:border-l-red-300'}
                    `}
                  >
                    <span className="text-2xl">{option.emoji}</span>
                    <span className="font-semibold">{t(option.labelKey)}</span>
                    <span className="text-xs text-gray-400 font-normal">{t(option.descriptionKey)}</span>
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
                <span>{t('whyFeelThisWay')}</span>
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('commentPlaceholder')}
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
                  {tc('cancel')}
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
                  {isSubmitting ? t('submitting') : t('submitVote')}
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
              {t('changeMyVote')}
            </button>
          )}

          {/* Owner Actions (for deadlock) */}
          {isOwner && isDeadlock && onForceResolve && (
            <div className="bg-amber-50 rounded-xl p-4 space-y-3 border border-amber-200">
              <div className="flex items-center gap-2 text-amber-700">
                <span className="text-lg">⚠️</span>
                <span className="font-medium">{t('votingSplit')}</span>
              </div>
              <p className="text-sm text-amber-600">
                {t('tripOrganizerCall')}
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
                  {t('addToPlan')}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleForceResolve('reject')}
                  disabled={isSubmitting}
                  className="flex-1 py-3 rounded-xl text-white bg-gray-500
                             hover:bg-gray-600 font-medium transition-colors
                             disabled:opacity-50"
                >
                  {t('skipThis')}
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
                <span>{t('seeWhoVoted')} ({proposal.votes.length})</span>
                <span className="group-open:rotate-180 transition-transform text-xs">▼</span>
              </summary>
              <div className="mt-2 space-y-2">
                {proposal.votes.map((vote) => {
                  const voteInfo = VOTE_INFO[vote.vote_type as VoteType];
                  return (
                    <div
                      key={vote.id}
                      className="bg-gray-50 rounded-lg p-2 space-y-1"
                    >
                      <div className="flex items-center gap-3 text-sm">
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
                        <span className="flex-1 text-gray-700">{vote.user?.display_name || t('unknown')}</span>
                        <span title={voteInfo?.labelKey ? t(voteInfo.labelKey) : undefined}>{voteInfo?.emoji || '❓'}</span>
                      </div>
                      {vote.comment && (
                        <p className="text-xs text-gray-500 italic ml-9">
                          &ldquo;{vote.comment}&rdquo;
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
