"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type {
  ProposalWithVotes,
  ProposalVoteType,
  Activity,
  VoteType,
} from "@/types";
import { VOTE_INFO, PROPOSAL_TIMING } from "@/types";
import { ProposalBadge, ProposalVoteSummary } from "./ProposalBadge";
import { ProposalVoteButtons } from "./ProposalVoteButtons";
import { getProposalTimeRemaining } from "@/lib/proposals/consensus";

interface ProposalCardProps {
  proposal: ProposalWithVotes;
  currentUserId?: string;
  isOwner?: boolean;
  canVote?: boolean;
  onVote: (proposalId: string, voteType: ProposalVoteType, comment?: string) => Promise<void>;
  onRemoveVote?: (proposalId: string) => Promise<void>;
  onWithdraw?: (proposalId: string) => Promise<void>;
  onForceResolve?: (proposalId: string, action: 'approve' | 'reject') => Promise<void>;
  showActions?: boolean;
  compact?: boolean;
}

export function ProposalCard({
  proposal,
  currentUserId,
  isOwner = false,
  canVote = true,
  onVote,
  onRemoveVote,
  onWithdraw,
  onForceResolve,
  showActions = true,
  compact = false,
}: ProposalCardProps) {
  const t = useTranslations("common.proposals");
  const [isExpanded, setIsExpanded] = useState(false);
  // Reserved for future owner action expansion feature
  // const [showOwnerActions, setShowOwnerActions] = useState(false);

  const activity = proposal.activity_data as Activity;

  // Format time remaining with translations
  const formatTimeRemaining = (hours: number): string => {
    if (hours <= 0) return t("time.expiringSoon");
    if (hours < 24) return t("time.hoursLeft", { hours: Math.round(hours) });
    const days = Math.floor(hours / 24);
    return t("time.daysLeft", { days });
  };
  const isProposer = currentUserId === proposal.proposed_by;
  const isActive = proposal.status === 'pending' || proposal.status === 'voting';
  const isDeadlock = proposal.consensus?.status === 'deadlock';

  // Calculate time remaining
  const timeRemaining = getProposalTimeRemaining(
    proposal.created_at,
    PROPOSAL_TIMING.EXPIRY_DAYS * 24
  );

  const handleVote = async (voteType: ProposalVoteType, comment?: string) => {
    await onVote(proposal.id, voteType, comment);
  };

  const handleRemoveVote = async () => {
    if (onRemoveVote) {
      await onRemoveVote(proposal.id);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`
        bg-white rounded-xl border shadow-sm overflow-hidden
        ${isActive ? 'border-blue-200' : 'border-gray-200'}
        ${isDeadlock ? 'ring-2 ring-amber-300' : ''}
      `}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Activity Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <ProposalBadge
                status={proposal.status}
                consensus={proposal.consensus}
                size="sm"
              />
              {proposal.type === 'replacement' && (
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                  {t("badges.replacement")}
                </span>
              )}
            </div>

            <h4 className="font-medium text-gray-900 truncate">
              {activity.name}
            </h4>

            {!compact && (
              <p className="text-sm text-gray-500 mt-0.5">
                {t("labels.day", { number: proposal.target_day + 1 })}
                {proposal.target_time_slot && ` • ${proposal.target_time_slot}`}
              </p>
            )}
          </div>

          {/* Activity Image */}
          {activity.image_url && !compact && (
            <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
              <Image
                src={activity.image_url}
                alt={activity.name}
                width={64}
                height={64}
                className="w-full h-full object-cover"
              />
            </div>
          )}
        </div>

        {/* Proposer Info */}
        <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
          {proposal.proposer?.avatar_url ? (
            <Image
              src={proposal.proposer.avatar_url}
              alt={proposal.proposer.display_name}
              width={20}
              height={20}
              className="w-5 h-5 rounded-full"
            />
          ) : (
            <span className="w-5 h-5 bg-gray-200 rounded-full flex items-center justify-center">
              👤
            </span>
          )}
          <span>
            {t("labels.proposedBy", { name: proposal.proposer?.display_name || t("labels.unknown") })}
          </span>
          <span>•</span>
          <span>{formatTimeRemaining(timeRemaining.hours)}</span>
        </div>

        {/* Note */}
        {proposal.note && !compact && (
          <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg p-2">
            &quot;{proposal.note}&quot;
          </p>
        )}
      </div>

      {/* Vote Summary */}
      {proposal.vote_summary.total > 0 && (
        <div className="px-4 pb-2">
          <ProposalVoteSummary
            love={proposal.vote_summary.love ?? 0}
            flexible={proposal.vote_summary.flexible ?? 0}
            concerns={proposal.vote_summary.concerns ?? 0}
            no={proposal.vote_summary.no ?? 0}
            total={proposal.vote_summary.total}
          />
        </div>
      )}

      {/* Actions */}
      {showActions && isActive && (
        <div className="px-4 pb-4 space-y-3">
          {/* Voting Buttons */}
          {canVote && (
            <ProposalVoteButtons
              currentVote={proposal.current_user_vote}
              onVote={handleVote}
              onRemoveVote={proposal.current_user_vote ? handleRemoveVote : undefined}
              size="sm"
            />
          )}

          {/* Proposer Actions */}
          {isProposer && onWithdraw && (
            <button
              onClick={() => onWithdraw(proposal.id)}
              className="w-full text-center text-xs text-gray-500 hover:text-gray-700"
            >
              {t("actions.withdrawProposal")}
            </button>
          )}

          {/* Owner Actions (for deadlock) */}
          {isOwner && isDeadlock && onForceResolve && (
            <div className="border-t pt-3">
              <p className="text-xs text-amber-700 mb-2">
                {t("owner.needsDecision")}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => onForceResolve(proposal.id, 'approve')}
                  className="flex-1 px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg
                             hover:bg-green-600"
                >
                  {t("actions.approve")}
                </button>
                <button
                  onClick={() => onForceResolve(proposal.id, 'reject')}
                  className="flex-1 px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg
                             hover:bg-red-600"
                >
                  {t("actions.reject")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expand/Collapse for more details */}
      {!compact && activity.description && (
        <>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full px-4 py-2 text-xs text-gray-500 hover:bg-gray-50
                       border-t flex items-center justify-center gap-1"
          >
            <span>{isExpanded ? t("expand.showLess") : t("expand.showMore")}</span>
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              ▼
            </motion.span>
          </button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-3">
                  {/* Description */}
                  {activity.description && (
                    <div>
                      <h5 className="text-xs font-medium text-gray-500 mb-1">{t("labels.description")}</h5>
                      <p className="text-sm text-gray-700">{activity.description}</p>
                    </div>
                  )}

                  {/* Details */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {activity.duration_minutes && (
                      <div className="flex items-center gap-1 text-gray-600">
                        <span>⏱️</span>
                        <span>{t("labels.duration", { minutes: activity.duration_minutes })}</span>
                      </div>
                    )}
                    {activity.type && (
                      <div className="flex items-center gap-1 text-gray-600">
                        <span>📍</span>
                        <span className="capitalize">{activity.type}</span>
                      </div>
                    )}
                  </div>

                  {/* Votes Breakdown */}
                  {proposal.votes.length > 0 && (
                    <div>
                      <h5 className="text-xs font-medium text-gray-500 mb-2">{t("labels.votes")}</h5>
                      <div className="space-y-1">
                        {proposal.votes.map((vote) => {
                          const voteInfo = VOTE_INFO[vote.vote_type as VoteType];
                          return (
                            <div
                              key={vote.id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <span>{voteInfo?.emoji || '❓'}</span>
                              <span className="text-gray-700">
                                {vote.user?.display_name || 'Unknown'}
                              </span>
                              <span className={`text-xs ${voteInfo?.color || 'text-gray-500'}`}>
                                {voteInfo?.labelKey ? t(voteInfo.labelKey) : vote.vote_type}
                              </span>
                              {vote.comment && (
                                <span className="text-gray-500 text-xs truncate">
                                  - {vote.comment}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
}
