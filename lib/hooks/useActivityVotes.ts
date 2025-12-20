"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  VoteType,
  ActivityVote,
  ActivityStatus,
  ConsensusResult,
  ActivityVotingStatus,
} from "@/types";
import { calculateConsensus } from "@/lib/voting/consensus";

interface UseActivityVotesOptions {
  tripId: string;
  enabled?: boolean;
  onVoteChange?: (activityId: string, votes: ActivityVote[]) => void;
}

interface UseActivityVotesReturn {
  // Data
  votes: Record<string, ActivityVote[]>;
  statuses: Record<string, ActivityStatus>;
  consensus: Record<string, ConsensusResult>;
  currentUserVotes: Record<string, VoteType>;
  voterCount: number;

  // State
  isLoading: boolean;
  error: string | null;

  // Actions
  castVote: (activityId: string, voteType: VoteType, comment?: string) => Promise<void>;
  removeVote: (activityId: string) => Promise<void>;
  refreshVotes: () => Promise<void>;

  // Helpers
  getActivityVotes: (activityId: string) => ActivityVote[];
  getActivityConsensus: (activityId: string) => ConsensusResult | null;
  getActivityStatus: (activityId: string) => ActivityVotingStatus;
  getCurrentUserVote: (activityId: string) => VoteType | null;
}

export function useActivityVotes({
  tripId,
  enabled = true,
  onVoteChange,
}: UseActivityVotesOptions): UseActivityVotesReturn {
  const [votes, setVotes] = useState<Record<string, ActivityVote[]>>({});
  const [statuses, setStatuses] = useState<Record<string, ActivityStatus>>({});
  const [consensus, setConsensus] = useState<Record<string, ConsensusResult>>({});
  const [currentUserVotes, setCurrentUserVotes] = useState<Record<string, VoteType>>({});
  const [voterCount, setVoterCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabaseRef = useRef(createClient());
  const channelRef = useRef<ReturnType<typeof supabaseRef.current.channel> | null>(null);

  // Fetch all votes for the trip
  const fetchVotes = useCallback(async () => {
    if (!tripId || !enabled) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`/api/trips/${tripId}/votes`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch votes");
      }

      setVotes(data.votes || {});
      setStatuses(data.statuses || {});
      setConsensus(data.consensus || {});
      setCurrentUserVotes(data.currentUserVotes || {});
      setVoterCount(data.voterCount || 0);
    } catch (err) {
      console.error("Error fetching votes:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch votes");
    } finally {
      setIsLoading(false);
    }
  }, [tripId, enabled]);

  // Cast or update a vote
  const castVote = useCallback(
    async (activityId: string, voteType: VoteType, comment?: string) => {
      try {
        // Optimistic update
        setCurrentUserVotes((prev) => ({
          ...prev,
          [activityId]: voteType,
        }));

        const response = await fetch(
          `/api/trips/${tripId}/activities/${activityId}/vote`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ voteType, comment }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          // Revert optimistic update
          setCurrentUserVotes((prev) => {
            const newVotes = { ...prev };
            delete newVotes[activityId];
            return newVotes;
          });
          throw new Error(data.error || "Failed to cast vote");
        }

        // Refresh to get updated consensus
        await fetchVotes();
      } catch (err) {
        console.error("Error casting vote:", err);
        throw err;
      }
    },
    [tripId, fetchVotes]
  );

  // Remove a vote
  const removeVote = useCallback(
    async (activityId: string) => {
      try {
        // Optimistic update
        const previousVote = currentUserVotes[activityId];
        setCurrentUserVotes((prev) => {
          const newVotes = { ...prev };
          delete newVotes[activityId];
          return newVotes;
        });

        const response = await fetch(
          `/api/trips/${tripId}/activities/${activityId}/vote`,
          { method: "DELETE" }
        );

        const data = await response.json();

        if (!response.ok) {
          // Revert optimistic update
          if (previousVote) {
            setCurrentUserVotes((prev) => ({
              ...prev,
              [activityId]: previousVote,
            }));
          }
          throw new Error(data.error || "Failed to remove vote");
        }

        // Refresh to get updated consensus
        await fetchVotes();
      } catch (err) {
        console.error("Error removing vote:", err);
        throw err;
      }
    },
    [tripId, currentUserVotes, fetchVotes]
  );

  // Helper functions
  const getActivityVotes = useCallback(
    (activityId: string): ActivityVote[] => votes[activityId] || [],
    [votes]
  );

  const getActivityConsensus = useCallback(
    (activityId: string): ConsensusResult | null => consensus[activityId] || null,
    [consensus]
  );

  const getActivityStatus = useCallback(
    (activityId: string): ActivityVotingStatus =>
      // Default to "voting" if enabled (collaborative trip) so voting UI shows
      // Only use "confirmed" if there's an explicit status record marking it confirmed
      statuses[activityId]?.status || (enabled ? "voting" : "confirmed"),
    [statuses, enabled]
  );

  const getCurrentUserVote = useCallback(
    (activityId: string): VoteType | null => currentUserVotes[activityId] || null,
    [currentUserVotes]
  );

  // Initial fetch
  useEffect(() => {
    if (enabled && tripId) {
      fetchVotes();
    }
  }, [enabled, tripId, fetchVotes]);

  // Set up real-time subscription
  useEffect(() => {
    if (!enabled || !tripId) return;

    const supabase = supabaseRef.current;

    // Clean up previous channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Subscribe to vote changes
    const channel = supabase
      .channel(`trip-votes:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_votes",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          console.log("Vote change received:", payload);
          // Refresh votes on any change
          fetchVotes();

          // Notify callback if provided
          if (onVoteChange && payload.new) {
            const vote = payload.new as ActivityVote;
            const activityVotes = votes[vote.activity_id] || [];
            onVoteChange(vote.activity_id, activityVotes);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_status",
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          console.log("Status change received");
          fetchVotes();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log(`Subscribed to votes for trip ${tripId}`);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [enabled, tripId, fetchVotes, onVoteChange, votes]);

  return {
    votes,
    statuses,
    consensus,
    currentUserVotes,
    voterCount,
    isLoading,
    error,
    castVote,
    removeVote,
    refreshVotes: fetchVotes,
    getActivityVotes,
    getActivityConsensus,
    getActivityStatus,
    getCurrentUserVote,
  };
}
