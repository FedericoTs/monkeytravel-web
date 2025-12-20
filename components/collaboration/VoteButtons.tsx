"use client";

import { useState } from "react";
import { VoteType, VOTE_INFO } from "@/types";

interface VoteButtonsProps {
  currentVote: VoteType | null;
  onVote: (voteType: VoteType, comment?: string) => Promise<void>;
  onRemoveVote?: () => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

export default function VoteButtons({
  currentVote,
  onVote,
  onRemoveVote,
  disabled = false,
  compact = false,
  className = "",
}: VoteButtonsProps) {
  const [isVoting, setIsVoting] = useState(false);
  const [pendingVote, setPendingVote] = useState<VoteType | null>(null);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [comment, setComment] = useState("");

  const handleVoteClick = async (voteType: VoteType) => {
    if (disabled || isVoting) return;

    // If clicking the same vote, remove it
    if (currentVote === voteType && onRemoveVote) {
      setIsVoting(true);
      try {
        await onRemoveVote();
      } finally {
        setIsVoting(false);
      }
      return;
    }

    // If concerns or no, show comment modal
    if (VOTE_INFO[voteType].requiresComment) {
      setPendingVote(voteType);
      setShowCommentModal(true);
      return;
    }

    // Cast vote directly
    setIsVoting(true);
    try {
      await onVote(voteType);
    } finally {
      setIsVoting(false);
    }
  };

  const handleCommentSubmit = async () => {
    if (!pendingVote || !comment.trim()) return;

    setIsVoting(true);
    try {
      await onVote(pendingVote, comment.trim());
      setShowCommentModal(false);
      setComment("");
      setPendingVote(null);
    } finally {
      setIsVoting(false);
    }
  };

  const voteTypes: VoteType[] = ["love", "flexible", "concerns", "no"];

  return (
    <>
      <div className={`flex gap-2 ${className}`}>
        {voteTypes.map((type) => {
          const info = VOTE_INFO[type];
          const isSelected = currentVote === type;
          const isLoading = isVoting && pendingVote === type;

          return (
            <button
              key={type}
              onClick={() => handleVoteClick(type)}
              disabled={disabled || isVoting}
              className={`
                relative flex items-center justify-center
                ${compact ? "w-10 h-10" : "min-w-[48px] h-12 px-3"}
                rounded-xl transition-all duration-200
                ${
                  isSelected
                    ? `${info.bgColor} ring-2 ring-offset-1 ${info.color.replace("text-", "ring-")}`
                    : "bg-slate-100 hover:bg-slate-200"
                }
                ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer active:scale-95"}
                ${isLoading ? "animate-pulse" : ""}
              `}
              title={`${info.emoji} ${info.label}: ${info.description}`}
              aria-label={info.label}
            >
              <span className="text-lg" role="img" aria-label={info.label}>
                {info.emoji}
              </span>
              {!compact && (
                <span className={`ml-1 text-sm font-medium ${isSelected ? info.color : "text-slate-600"}`}>
                  {info.label}
                </span>
              )}
              {isSelected && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full shadow flex items-center justify-center">
                  <svg className={`w-3 h-3 ${info.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Comment Modal for Concerns/No votes */}
      {showCommentModal && pendingVote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">{VOTE_INFO[pendingVote].emoji}</span>
              <div>
                <h3 className="font-semibold text-slate-900">
                  {VOTE_INFO[pendingVote].label}
                </h3>
                <p className="text-sm text-slate-500">
                  Please share why with the group
                </p>
              </div>
            </div>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                pendingVote === "concerns"
                  ? "What concerns do you have about this activity?"
                  : "Why isn't this activity right for you?"
              }
              className="w-full h-24 p-3 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              autoFocus
            />

            <div className="flex gap-3 mt-4">
              <button
                onClick={() => {
                  setShowCommentModal(false);
                  setComment("");
                  setPendingVote(null);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCommentSubmit}
                disabled={!comment.trim() || isVoting}
                className={`
                  flex-1 py-2.5 px-4 rounded-xl font-medium transition-colors
                  ${
                    comment.trim()
                      ? `${VOTE_INFO[pendingVote].bgColor} ${VOTE_INFO[pendingVote].color} hover:opacity-90`
                      : "bg-slate-100 text-slate-400 cursor-not-allowed"
                  }
                `}
              >
                {isVoting ? "Submitting..." : "Submit Vote"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
