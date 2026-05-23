"use client";

/**
 * Inline thumbs-up/down bar for anonymous voters on a shared trip page.
 *
 * Renders below each activity card on /shared/[token]. First time a viewer
 * votes, opens a small inline prompt asking for their display name (optional,
 * lets the trip owner see WHO voted instead of an opaque cookie id).
 *
 * State is fully controlled by the parent (SharedTripView owns the tallies/
 * myVotes maps); this component just renders + emits intent.
 */

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";

export interface VoteTally {
  up: number;
  down: number;
}

export type MyVote = "up" | "down" | null;

interface AnonymousActivityVoteBarProps {
  activityId: string;
  tally: VoteTally;
  myVote: MyVote;
  /** Whether we've already collected this viewer's name (across all activities). */
  hasDisplayName: boolean;
  /** Disable interaction while a request is in flight. */
  pending?: boolean;
  /**
   * Fire a vote. Pass `null` for vote_type to remove an existing vote.
   * displayName is only provided on the very first vote of the session.
   */
  onVote: (args: {
    activityId: string;
    voteType: "up" | "down" | null;
    displayName?: string;
  }) => void;
}

export function AnonymousActivityVoteBar({
  activityId,
  tally,
  myVote,
  hasDisplayName,
  pending = false,
  onVote,
}: AnonymousActivityVoteBarProps) {
  // Local state for the name prompt — only opens after a click, never on its own.
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [pendingVoteType, setPendingVoteType] = useState<"up" | "down" | null>(null);
  const [nameInput, setNameInput] = useState("");

  const handleClick = (clicked: "up" | "down") => {
    // Toggle behavior: clicking your existing vote removes it.
    const nextVote: "up" | "down" | null = myVote === clicked ? null : clicked;

    if (!hasDisplayName && nextVote !== null) {
      // First vote of the session — pause and ask for a name. The user can
      // skip (just press Vote without typing) and we'll send vote-only.
      setPendingVoteType(nextVote);
      setShowNamePrompt(true);
      return;
    }

    onVote({ activityId, voteType: nextVote });
  };

  const handleConfirmWithName = () => {
    const trimmed = nameInput.trim();
    onVote({
      activityId,
      voteType: pendingVoteType,
      displayName: trimmed.length > 0 ? trimmed : undefined,
    });
    setShowNamePrompt(false);
    setNameInput("");
    setPendingVoteType(null);
  };

  const handleSkipName = () => {
    onVote({ activityId, voteType: pendingVoteType });
    setShowNamePrompt(false);
    setNameInput("");
    setPendingVoteType(null);
  };

  const upActive = myVote === "up";
  const downActive = myVote === "down";

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleClick("up")}
          disabled={pending}
          aria-pressed={upActive}
          aria-label={upActive ? "Remove your upvote" : "Upvote this activity"}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[36px] disabled:opacity-50 disabled:cursor-not-allowed ${
            upActive
              ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
              : "bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 border border-transparent"
          }`}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
          <span>{tally.up}</span>
        </button>

        <button
          type="button"
          onClick={() => handleClick("down")}
          disabled={pending}
          aria-pressed={downActive}
          aria-label={downActive ? "Remove your downvote" : "Downvote this activity"}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[36px] disabled:opacity-50 disabled:cursor-not-allowed ${
            downActive
              ? "bg-rose-100 text-rose-700 border border-rose-300"
              : "bg-slate-100 text-slate-600 hover:bg-rose-50 hover:text-rose-700 border border-transparent"
          }`}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
          <span>{tally.down}</span>
        </button>

        {myVote !== null && !showNamePrompt && (
          <span className="text-[11px] text-slate-400 ml-1">Your vote</span>
        )}
      </div>

      {showNamePrompt && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
          <label htmlFor={`anon-name-${activityId}`} className="text-xs text-slate-600">
            What&apos;s your name? <span className="text-slate-400">(so the trip owner knows who voted)</span>
          </label>
          <input
            id={`anon-name-${activityId}`}
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Sarah"
            maxLength={60}
            autoFocus
            className="flex-1 min-w-[120px] px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmWithName();
              if (e.key === "Escape") handleSkipName();
            }}
          />
          <button
            type="button"
            onClick={handleConfirmWithName}
            className="px-2.5 py-1 text-xs font-medium rounded bg-[var(--primary)] text-white hover:opacity-90"
          >
            Vote
          </button>
          <button
            type="button"
            onClick={handleSkipName}
            className="px-2.5 py-1 text-xs font-medium rounded text-slate-500 hover:text-slate-700"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
