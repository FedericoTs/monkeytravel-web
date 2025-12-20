"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ProposalVoteType } from "@/types";
import { PROPOSAL_VOTE_INFO } from "@/types";

interface ProposalVoteButtonsProps {
  currentVote?: ProposalVoteType | null;
  onVote: (voteType: ProposalVoteType, comment?: string) => Promise<void>;
  onRemoveVote?: () => Promise<void>;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  layout?: 'horizontal' | 'compact';
}

export function ProposalVoteButtons({
  currentVote,
  onVote,
  onRemoveVote,
  disabled = false,
  size = 'md',
  layout = 'horizontal',
}: ProposalVoteButtonsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [pendingVote, setPendingVote] = useState<ProposalVoteType | null>(null);
  const [comment, setComment] = useState('');

  const handleVote = async (voteType: ProposalVoteType) => {
    if (disabled || isLoading) return;

    // If voting for reject, show comment input
    if (voteType === 'reject' && !comment.trim()) {
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

  return (
    <div className="space-y-2">
      <div className={`flex gap-2 ${layout === 'compact' ? 'justify-center' : ''}`}>
        {/* Approve Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => handleVote('approve')}
          disabled={disabled || isLoading}
          className={`
            flex items-center gap-1.5 rounded-full font-medium
            transition-all duration-200
            ${sizeClasses[size]}
            ${currentVote === 'approve'
              ? 'bg-green-500 text-white shadow-md ring-2 ring-green-300'
              : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
            }
            ${disabled || isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <span className={iconSize[size]}>{PROPOSAL_VOTE_INFO.approve.emoji}</span>
          {layout !== 'compact' && (
            <span>{currentVote === 'approve' ? 'Approved' : PROPOSAL_VOTE_INFO.approve.label}</span>
          )}
        </motion.button>

        {/* Reject Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => handleVote('reject')}
          disabled={disabled || isLoading}
          className={`
            flex items-center gap-1.5 rounded-full font-medium
            transition-all duration-200
            ${sizeClasses[size]}
            ${currentVote === 'reject'
              ? 'bg-red-500 text-white shadow-md ring-2 ring-red-300'
              : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
            }
            ${disabled || isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <span className={iconSize[size]}>{PROPOSAL_VOTE_INFO.reject.emoji}</span>
          {layout !== 'compact' && (
            <span>{currentVote === 'reject' ? 'Rejected' : PROPOSAL_VOTE_INFO.reject.label}</span>
          )}
        </motion.button>

        {/* Remove Vote Button */}
        {currentVote && onRemoveVote && (
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
            {layout !== 'compact' && <span>Undo</span>}
          </motion.button>
        )}
      </div>

      {/* Comment Input for Reject */}
      <AnimatePresence>
        {showCommentInput && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-xs text-gray-600">
                Why do you think we should skip this? (Optional but helpful)
              </p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share your thoughts..."
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
                  Cancel
                </button>
                <button
                  onClick={handleCommentSubmit}
                  disabled={isLoading}
                  className="px-3 py-1 text-sm bg-red-500 text-white rounded
                             hover:bg-red-600 disabled:opacity-50"
                >
                  {isLoading ? 'Submitting...' : 'Submit Vote'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
