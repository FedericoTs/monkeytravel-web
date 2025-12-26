"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type {
  ProposalWithVotes,
  Activity,
  VoteType,
} from "@/types";
import { getProposalTimeRemaining } from "@/lib/proposals/consensus";
import { PROPOSAL_TIMING, VOTE_INFO } from "@/types";

interface InlineProposalCardProps {
  proposal: ProposalWithVotes;
  currentUserId?: string;
  canVote?: boolean;
  onTapToVote: () => void;
  /** Optional: number of collaborators who can vote */
  totalVoters?: number;
}

/**
 * Inline Proposal Card - Ghost card style that appears within the activity timeline
 *
 * Design principles:
 * - Dashed border to distinguish from confirmed activities
 * - Gradient background (amber for proposed, blue for voting)
 * - Left accent bar matching state
 * - Tap to open voting bottom sheet
 * - Shows vote progress inline
 */
function InlineProposalCardComponent({
  proposal,
  currentUserId,
  canVote = true,
  onTapToVote,
  totalVoters = 5,
}: InlineProposalCardProps) {
  const t = useTranslations("common.proposals");
  const tv = useTranslations("common.voting"); // Voting type labels
  const activity = proposal.activity_data as Activity | null;
  const isActive = proposal.status === 'pending' || proposal.status === 'voting';

  const handleClick = () => {
    if (isActive && canVote) {
      onTapToVote();
    }
  };

  // Handle missing or invalid activity_data - render a fallback card
  if (!activity || typeof activity !== 'object' || !activity.name) {
    return (
      <div className="w-full text-left relative overflow-hidden border-2 border-dashed border-gray-300 bg-gray-50 rounded-xl p-4">
        <div className="flex items-center gap-2 text-gray-500">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
            <span>⚠️</span>
            <span>{t("status.invalid")}</span>
          </span>
          <span className="text-sm">{t("errors.dataUnavailable")}</span>
        </div>
      </div>
    );
  }
  const consensusStatus = proposal.consensus?.status;

  // Calculate time remaining
  const timeRemaining = getProposalTimeRemaining(
    proposal.created_at,
    PROPOSAL_TIMING.EXPIRY_DAYS * 24
  );

  // Determine card state and styling
  const getCardState = () => {
    if (consensusStatus === 'approved') return 'approved';
    if (consensusStatus === 'rejected') return 'rejected';
    if (consensusStatus === 'deadlock') return 'deadlock';
    if (proposal.status === 'voting' || proposal.vote_summary.total > 0) return 'voting';
    return 'proposed';
  };

  const cardState = getCardState();

  // State-based styling
  const stateStyles = {
    proposed: {
      border: 'border-amber-300',
      bg: 'from-amber-50/70 to-yellow-50/50',
      accent: 'border-l-amber-400',
      badge: 'bg-amber-100 text-amber-700',
      badgeIcon: '💡',
      badgeText: t("badges.proposed"),
    },
    voting: {
      border: 'border-blue-300',
      bg: 'from-blue-50/70 to-indigo-50/50',
      accent: 'border-l-blue-500',
      badge: 'bg-blue-100 text-blue-700',
      badgeIcon: '🗳️',
      badgeText: t("badges.voting"),
    },
    approved: {
      border: 'border-green-300',
      bg: 'from-green-50/70 to-emerald-50/50',
      accent: 'border-l-green-500',
      badge: 'bg-green-100 text-green-700',
      badgeIcon: '✅',
      badgeText: t("badges.approved"),
    },
    rejected: {
      border: 'border-gray-300',
      bg: 'from-gray-50/50 to-gray-100/30',
      accent: 'border-l-gray-400',
      badge: 'bg-gray-100 text-gray-500',
      badgeIcon: '❌',
      badgeText: t("badges.rejected"),
    },
    deadlock: {
      border: 'border-amber-400',
      bg: 'from-amber-50/70 to-orange-50/50',
      accent: 'border-l-amber-500',
      badge: 'bg-amber-100 text-amber-700',
      badgeIcon: '⚠️',
      badgeText: t("badges.needsDecision"),
    },
  };

  const styles = stateStyles[cardState];

  // Vote progress - 4-level voting system
  const voteCount = proposal.vote_summary.total;
  const loveCount = proposal.vote_summary.love ?? 0;
  const flexibleCount = proposal.vote_summary.flexible ?? 0;
  const concernsCount = proposal.vote_summary.concerns ?? 0;
  const noCount = proposal.vote_summary.no ?? 0;
  // Positive votes = love + flexible (for progress bar)
  const positiveCount = loveCount + flexibleCount;
  const positivePercent = totalVoters > 0 ? (positiveCount / totalVoters) * 100 : 0;

  // User's current vote
  const userVote = proposal.current_user_vote;
  const hasVoted = !!userVote;
  const userVoteInfo = userVote ? VOTE_INFO[userVote as VoteType] : null;

  // Format time
  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  };

  // Format duration
  const formatDuration = (mins: number) => {
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remaining = mins % 60;
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
  };

  // Time remaining display
  const formatTimeRemaining = (hours: number): string => {
    if (hours <= 0) return t("time.expiringSoon");
    if (hours < 24) return t("time.hoursLeft", { hours: Math.round(hours) });
    const days = Math.floor(hours / 24);
    return t("time.daysLeft", { days });
  };

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={handleClick}
      disabled={!isActive || !canVote}
      className={`
        w-full text-left relative overflow-hidden
        border-2 border-dashed ${styles.border}
        border-l-4 border-l-solid ${styles.accent}
        bg-gradient-to-br ${styles.bg}
        rounded-xl p-4
        transition-all duration-300
        ${isActive && canVote ? 'cursor-pointer hover:shadow-md' : 'cursor-default'}
        ${cardState === 'rejected' ? 'opacity-60' : ''}
      `}
      style={{
        borderLeftStyle: 'solid',
      }}
    >
      {/* Subtle pulse animation for voting state */}
      {cardState === 'voting' && (
        <motion.div
          className="absolute inset-0 bg-blue-200/20 rounded-xl"
          animate={{
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}

      <div className="relative z-10">
        {/* Header Row */}
        <div className="flex items-start gap-3">
          {/* Activity Image (if available) */}
          {activity.image_url && (
            <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
              <Image
                src={activity.image_url}
                alt={activity.name}
                width={48}
                height={48}
                className={`w-full h-full object-cover ${cardState === 'rejected' ? 'grayscale' : ''}`}
              />
            </div>
          )}

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Badge + Time */}
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles.badge}`}>
                <span>{styles.badgeIcon}</span>
                <span>{styles.badgeText}</span>
              </span>
              <span className="text-xs text-gray-500">
                {formatTime(activity.start_time)}
              </span>
            </div>

            {/* Activity Name */}
            <h4 className={`font-medium text-gray-900 truncate ${cardState === 'rejected' ? 'line-through text-gray-500' : ''}`}>
              {activity.name}
            </h4>

            {/* Time + Duration + Type */}
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
              <span>{formatDuration(activity.duration_minutes)}</span>
              <span>•</span>
              <span className="capitalize">{activity.type}</span>
              {activity.location && (
                <>
                  <span>•</span>
                  <span className="truncate max-w-[120px]">{activity.location}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Proposer + Time Remaining Row */}
        <div className="flex items-center justify-between mt-3 text-xs">
          <div className="flex items-center gap-2 text-gray-500">
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
            <span>{t("labels.by", { name: proposal.proposer?.display_name || t("labels.unknown") })}</span>
          </div>

          {isActive && (
            <span className="text-gray-400">
              {formatTimeRemaining(timeRemaining.hours)}
            </span>
          )}
        </div>

        {/* Vote Progress Bar */}
        {isActive && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              {/* Progress bar */}
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-green-400 to-green-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${positivePercent}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>

              {/* Vote count */}
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {t("voting.votedCount", { count: voteCount, total: totalVoters })}
              </span>
            </div>

            {/* Vote breakdown - 4-level display */}
            {voteCount > 0 && (
              <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
                <span className="flex items-center gap-0.5" title={tv(VOTE_INFO.love.labelKey)}>
                  <span>{VOTE_INFO.love.emoji}</span>
                  <span>{loveCount}</span>
                </span>
                <span className="flex items-center gap-0.5" title={tv(VOTE_INFO.flexible.labelKey)}>
                  <span>{VOTE_INFO.flexible.emoji}</span>
                  <span>{flexibleCount}</span>
                </span>
                <span className="flex items-center gap-0.5" title={tv(VOTE_INFO.concerns.labelKey)}>
                  <span>{VOTE_INFO.concerns.emoji}</span>
                  <span>{concernsCount}</span>
                </span>
                <span className="flex items-center gap-0.5" title={tv(VOTE_INFO.no.labelKey)}>
                  <span>{VOTE_INFO.no.emoji}</span>
                  <span>{noCount}</span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* User Vote Indicator + CTA */}
        {isActive && canVote && (
          <div className="mt-3 flex items-center justify-between">
            {hasVoted && userVoteInfo ? (
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${userVoteInfo.color}`}>
                <span>{userVoteInfo.emoji}</span>
                <span>{t("voting.yourVote", { vote: tv(userVoteInfo.labelKey) })}</span>
              </span>
            ) : (
              <span className="text-xs text-blue-600 font-medium animate-pulse">
                {t("voting.tapToVote")}
              </span>
            )}

            {hasVoted && (
              <span className="text-xs text-blue-500 font-medium">
                {t("voting.changeVote")}
              </span>
            )}
          </div>
        )}

        {/* Note (if present and short) */}
        {proposal.note && proposal.note.length < 80 && isActive && (
          <div className="mt-2 text-xs text-gray-600 italic bg-white/50 rounded-lg px-2 py-1">
            "{proposal.note}"
          </div>
        )}
      </div>
    </motion.button>
  );
}

export const InlineProposalCard = memo(InlineProposalCardComponent);
