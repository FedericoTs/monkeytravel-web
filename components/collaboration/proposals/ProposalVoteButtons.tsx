"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import type { VoteType } from "@/types";
import { VOTE_INFO } from "@/types";

interface ProposalVoteButtonsProps {
  currentVote?: VoteType | null;
  onVote: (voteType: VoteType, comment?: string) => Promise<void>;
  onRemoveVote?: () => Promise<void>;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  layout?: 'horizontal' | 'grid' | 'compact';
}

const VOTE_OPTIONS: VoteType[] = ['love', 'flexible', 'concerns', 'no'];

export function ProposalVoteButtons({
  currentVote,
  onVote,
  onRemoveVote,
  disabled = false,
  size = 'md',
  layout = 'grid',
}: ProposalVoteButtonsProps) {
  const t = useTranslations("common.voting");
  const [isLoading, setIsLoading] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [pendingVote, setPendingVote] = useState<VoteType | null>(null);
  const [comment, setComment] = useState('');

  const handleVote = async (voteType: VoteType) => {
    if (disabled || isLoading) return;

    // If voting requires comment (concerns or no), show comment input
    if (VOTE_INFO[voteType].requiresComment && !comment.trim()) {
      setPendingVote(voteType);
      setShowCommentInput(true);
      return;
    }

    try {
      setIsLoading(true);
      await onVote(voteType, comment.trim() || undefined);
      setComment('');
      setShowCommentInput(false);
      setPendingVote(null);
    } catch (error) {
      console.error('Failed to vote:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCommentSubmit = async () => {
    if (!pendingVote || isLoading) return;

    // Check if comment is required but empty
    if (VOTE_INFO[pendingVote].requiresComment && !comment.trim()) {
      return; // Don't allow submit without comment for required votes
    }

    try {
      setIsLoading(true);
      await onVote(pendingVote, comment.trim() || undefined);
      setComment('');
      setShowCommentInput(false);
      setPendingVote(null);
    } catch (error) {
      console.error('Failed to vote:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveVote = async () => {
    if (!onRemoveVote || isLoading) return;

    try {
      setIsLoading(true);
      await onRemoveVote();
    } catch (error) {
      console.error('Failed to remove vote:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  const iconSize = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-xl',
  };

  const layoutClasses = {
    horizontal: 'flex gap-2',
    grid: 'grid grid-cols-2 gap-2',
    compact: 'flex gap-1 justify-center',
  };

  const getButtonStyles = (voteType: VoteType, isSelected: boolean) => {
    const info = VOTE_INFO[voteType];
    if (isSelected) {
      // Selected state with matching background
      const bgMap: Record<VoteType, string> = {
        love: 'bg-green-500 text-white shadow-md ring-2 ring-green-300',
        flexible: 'bg-blue-500 text-white shadow-md ring-2 ring-blue-300',
        concerns: 'bg-amber-500 text-white shadow-md ring-2 ring-amber-300',
        no: 'bg-red-500 text-white shadow-md ring-2 ring-red-300',
      };
      return bgMap[voteType];
    }
    // Unselected state
    return `${info.bgColor} ${info.color} hover:opacity-80 border border-current/20`;
  };

  return (
    <div className="space-y-2">
      <div className={layoutClasses[layout]}>
        {VOTE_OPTIONS.map((voteType) => {
          const info = VOTE_INFO[voteType];
          const isSelected = currentVote === voteType;

          return (
            <motion.button
              key={voteType}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleVote(voteType)}
              disabled={disabled || isLoading}
              className={`
                flex items-center gap-1.5 rounded-full font-medium
                transition-all duration-200
                ${sizeClasses[size]}
                ${getButtonStyles(voteType, isSelected)}
                ${disabled || isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <span className={iconSize[size]}>{info.emoji}</span>
              {layout !== 'compact' && (
                <span>{t(info.labelKey)}</span>
              )}
            </motion.button>
          );
        })}

        {/* Remove Vote Button */}
        {currentVote && onRemoveVote && layout !== 'grid' && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleRemoveVote}
            disabled={isLoading}
            className={`
              flex items-center gap-1 rounded-full font-medium
              bg-gray-100 text-gray-600 hover:bg-gray-200
              transition-all duration-200
              ${sizeClasses[size]}
              ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <span>↩️</span>
            {layout !== 'compact' && <span>{t("undo")}</span>}
          </motion.button>
        )}
      </div>

      {/* Undo button for grid layout */}
      {currentVote && onRemoveVote && layout === 'grid' && (
        <motion.button
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleRemoveVote}
          disabled={isLoading}
          className={`
            w-full flex items-center justify-center gap-1 rounded-full font-medium
            bg-gray-100 text-gray-600 hover:bg-gray-200
            transition-all duration-200
            ${sizeClasses[size]}
            ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <span>↩️</span>
          <span>{t("changeMyVote")}</span>
        </motion.button>
      )}

      {/* Comment Input for votes requiring comment */}
      <AnimatePresence>
        {showCommentInput && pendingVote && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-xs text-gray-600">
                {pendingVote === 'concerns'
                  ? t("concernsPrompt")
                  : t("noPrompt")}
              </p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("shareThoughts")}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                           focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                           resize-none"
                rows={2}
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowCommentInput(false);
                    setPendingVote(null);
                    setComment('');
                  }}
                  className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-200 rounded"
                >
                  {t("cancel")}
                </button>
                <button
                  onClick={handleCommentSubmit}
                  disabled={isLoading || !comment.trim()}
                  className={`px-3 py-1 text-sm text-white rounded
                             disabled:opacity-50
                             ${pendingVote === 'concerns'
                               ? 'bg-amber-500 hover:bg-amber-600'
                               : 'bg-red-500 hover:bg-red-600'
                             }`}
                >
                  {isLoading ? t("submitting") : t("submitVote")}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
