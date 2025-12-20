"use client";

import { useState } from "react";
import VoteButtons from "./VoteButtons";
import StatusBadge from "./StatusBadge";
import { VoteType, ActivityVote, ConsensusResult, VOTE_INFO, ActivityVotingStatus } from "@/types";
import { getConsensusDisplayInfo } from "@/lib/voting/consensus";

interface VotingSectionProps {
  activityId: string;
  votes: ActivityVote[];
  consensus: ConsensusResult | null;
  status: ActivityVotingStatus;
  currentUserVote: VoteType | null;
  canVote: boolean;
  totalVoters: number;
  onVote: (voteType: VoteType, comment?: string) => Promise<void>;
  onRemoveVote: () => Promise<void>;
  className?: string;
}

export default function VotingSection({
  activityId,
  votes,
  consensus,
  status,
  currentUserVote,
  canVote,
  totalVoters,
  onVote,
  onRemoveVote,
  className = "",
}: VotingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Don't show voting for confirmed activities (unless there are existing votes)
  if (status === "confirmed" && votes.length === 0) {
    return null;
  }

  // Don't show for completed/skipped activities
  if (status === "completed" || status === "skipped") {
    return null;
  }

  const displayInfo = consensus
    ? getConsensusDisplayInfo(consensus)
    : {
        label: "No votes yet",
        color: "text-slate-500",
        bgColor: "bg-slate-100",
        icon: "clock",
        description: "Be the first to vote",
      };

  const votedCount = votes.length;
  const participationPercent = totalVoters > 0 ? Math.round((votedCount / totalVoters) * 100) : 0;

  return (
    <div className={`border-t border-slate-100 pt-3 ${className}`}>
      {/* Header with status and participation */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} consensus={consensus} />
          <span className="text-xs text-slate-500">
            {votedCount}/{totalVoters} voted
          </span>
        </div>

        {votes.length > 0 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            {isExpanded ? "Hide" : "Show"} votes
            <svg
              className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Participation progress bar */}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full transition-all duration-300 ${
            participationPercent >= 50 ? "bg-green-400" : "bg-amber-400"
          }`}
          style={{ width: `${participationPercent}%` }}
        />
      </div>

      {/* Vote buttons (if user can vote) */}
      {canVote && (status === "proposed" || status === "voting" || status === "deadlock") && (
        <VoteButtons
          currentVote={currentUserVote}
          onVote={onVote}
          onRemoveVote={onRemoveVote}
          compact
          className="mb-3"
        />
      )}

      {/* Expanded vote breakdown */}
      {isExpanded && votes.length > 0 && (
        <div className="mt-3 p-3 bg-slate-50 rounded-xl animate-in slide-in-from-top-2 duration-200">
          {/* Vote distribution */}
          <div className="flex gap-4 mb-3 text-xs">
            {(["love", "flexible", "concerns", "no"] as VoteType[]).map((type) => {
              const count = votes.filter((v) => v.vote_type === type).length;
              if (count === 0) return null;
              const info = VOTE_INFO[type];
              return (
                <div key={type} className="flex items-center gap-1">
                  <span>{info.emoji}</span>
                  <span className={info.color}>{count}</span>
                </div>
              );
            })}
          </div>

          {/* Individual votes */}
          <div className="space-y-2">
            {votes.map((vote) => (
              <div key={vote.id} className="flex items-start gap-2">
                <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-xs overflow-hidden">
                  {vote.user?.avatar_url ? (
                    <img
                      src={vote.user.avatar_url}
                      alt={vote.user.display_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    vote.user?.display_name?.[0]?.toUpperCase() || "?"
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-700 truncate">
                      {vote.user?.display_name || "Unknown"}
                    </span>
                    <span className="text-sm">{VOTE_INFO[vote.vote_type].emoji}</span>
                  </div>
                  {vote.comment && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                      &ldquo;{vote.comment}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pending voters indicator */}
          {consensus && consensus.pendingVoters.length > 0 && (
            <div className="mt-3 pt-2 border-t border-slate-200">
              <p className="text-xs text-slate-500">
                Waiting for {consensus.pendingVoters.length} more vote
                {consensus.pendingVoters.length !== 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Deadlock owner action */}
      {status === "deadlock" && (
        <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-700">
            No consensus reached. Trip owner can make the final decision.
          </p>
        </div>
      )}
    </div>
  );
}
