"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Activity,
  ActivityProposal,
  ProposalVote,
  ProposalVoteType,
  ProposalType,
  ProposalWithVotes,
  ProposalConsensusResult,
} from "@/types";
import { groupProposalsBySlot } from "@/lib/proposals/consensus";

interface UseProposalsOptions {
  tripId: string;
  enabled?: boolean;
  statusFilter?: 'active' | 'all' | 'pending' | 'voting' | 'approved' | 'rejected';
  onProposalChange?: (proposal: ProposalWithVotes) => void;
}

interface CreateProposalInput {
  type: ProposalType;
  activityData: Activity;
  targetActivityId?: string;
  targetDay: number;
  targetTimeSlot?: 'morning' | 'afternoon' | 'evening';
  note?: string;
}

interface UseProposalsReturn {
  // Data
  proposals: ProposalWithVotes[];
  proposalsBySlot: Map<string, ProposalWithVotes[]>;
  totalVoters: number;

  // State
  isLoading: boolean;
  error: string | null;
  isCreating: boolean;
  isVoting: boolean;

  // Actions
  createProposal: (input: CreateProposalInput) => Promise<ActivityProposal | null>;
  voteOnProposal: (proposalId: string, voteType: ProposalVoteType, comment?: string) => Promise<void>;
  removeVote: (proposalId: string) => Promise<void>;
  withdrawProposal: (proposalId: string) => Promise<void>;
  forceResolve: (proposalId: string, action: 'approve' | 'reject') => Promise<void>;
  deleteProposal: (proposalId: string) => Promise<void>;
  refreshProposals: () => Promise<void>;

  // Helpers
  getProposal: (proposalId: string) => ProposalWithVotes | undefined;
  getProposalsForSlot: (day: number, timeSlot?: string) => ProposalWithVotes[];
  getActiveProposals: () => ProposalWithVotes[];
  getCurrentUserVote: (proposalId: string) => ProposalVoteType | null;
  getProposalConsensus: (proposalId: string) => ProposalConsensusResult | undefined;
  hasConflictingProposals: (day: number, timeSlot?: string) => boolean;
}

export function useProposals({
  tripId,
  enabled = true,
  statusFilter = 'active',
  onProposalChange,
}: UseProposalsOptions): UseProposalsReturn {
  const [proposals, setProposals] = useState<ProposalWithVotes[]>([]);
  const [totalVoters, setTotalVoters] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isVoting, setIsVoting] = useState(false);

  const supabaseRef = useRef(createClient());
  const channelRef = useRef<ReturnType<typeof supabaseRef.current.channel> | null>(null);
  // Track proposals in a ref to avoid recreating subscription on every change
  const proposalsRef = useRef<ProposalWithVotes[]>([]);

  // Group proposals by slot for tournament detection
  const proposalsBySlot = useMemo(() => {
    return groupProposalsBySlot(proposals);
  }, [proposals]);

  // Fetch all proposals for the trip
  const fetchProposals = useCallback(async () => {
    if (!tripId || !enabled) return;

    try {
      setIsLoading(true);
      setError(null);

      const url = new URL(`/api/trips/${tripId}/proposals`, window.location.origin);
      if (statusFilter && statusFilter !== 'all') {
        url.searchParams.set('status', statusFilter);
      }

      const response = await fetch(url.toString());
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch proposals");
      }

      setProposals(data.proposals || []);
      setTotalVoters(data.totalVoters || 0);
    } catch (err) {
      console.error("Error fetching proposals:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch proposals");
    } finally {
      setIsLoading(false);
    }
  }, [tripId, enabled, statusFilter]);

  // Create a new proposal
  const createProposal = useCallback(
    async (input: CreateProposalInput): Promise<ActivityProposal | null> => {
      if (!tripId) return null;

      try {
        setIsCreating(true);
        setError(null);

        const response = await fetch(`/api/trips/${tripId}/proposals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to create proposal");
        }

        // Refresh to get updated list with votes
        await fetchProposals();

        return data.proposal;
      } catch (err) {
        console.error("Error creating proposal:", err);
        setError(err instanceof Error ? err.message : "Failed to create proposal");
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [tripId, fetchProposals]
  );

  // Vote on a proposal
  const voteOnProposal = useCallback(
    async (proposalId: string, voteType: ProposalVoteType, comment?: string) => {
      if (!tripId) return;

      try {
        setIsVoting(true);

        // Optimistic update
        setProposals((prev) =>
          prev.map((p) => {
            if (p.id !== proposalId) return p;
            return {
              ...p,
              current_user_vote: voteType,
              vote_summary: {
                ...p.vote_summary,
                [voteType]: p.vote_summary[voteType] + 1,
                total: p.vote_summary.total + (p.current_user_vote ? 0 : 1),
                ...(p.current_user_vote && p.current_user_vote !== voteType
                  ? { [p.current_user_vote]: p.vote_summary[p.current_user_vote] - 1 }
                  : {}),
              },
            };
          })
        );

        const response = await fetch(
          `/api/trips/${tripId}/proposals/${proposalId}/vote`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ voteType, comment }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          // Revert optimistic update
          await fetchProposals();
          throw new Error(data.error || "Failed to vote");
        }

        // Refresh to get updated consensus
        await fetchProposals();
      } catch (err) {
        console.error("Error voting on proposal:", err);
        throw err;
      } finally {
        setIsVoting(false);
      }
    },
    [tripId, fetchProposals]
  );

  // Remove vote from a proposal
  const removeVote = useCallback(
    async (proposalId: string) => {
      if (!tripId) return;

      try {
        const proposal = proposals.find((p) => p.id === proposalId);
        const previousVote = proposal?.current_user_vote;

        // Optimistic update
        setProposals((prev) =>
          prev.map((p) => {
            if (p.id !== proposalId) return p;
            return {
              ...p,
              current_user_vote: undefined,
              vote_summary: {
                ...p.vote_summary,
                ...(previousVote ? { [previousVote]: p.vote_summary[previousVote] - 1 } : {}),
                total: p.vote_summary.total - 1,
              },
            };
          })
        );

        const response = await fetch(
          `/api/trips/${tripId}/proposals/${proposalId}/vote`,
          { method: "DELETE" }
        );

        const data = await response.json();

        if (!response.ok) {
          // Revert optimistic update
          await fetchProposals();
          throw new Error(data.error || "Failed to remove vote");
        }

        // Refresh to get updated consensus
        await fetchProposals();
      } catch (err) {
        console.error("Error removing vote:", err);
        throw err;
      }
    },
    [tripId, proposals, fetchProposals]
  );

  // Withdraw a proposal (proposer only)
  const withdrawProposal = useCallback(
    async (proposalId: string) => {
      if (!tripId) return;

      try {
        const response = await fetch(
          `/api/trips/${tripId}/proposals/${proposalId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: 'withdraw' }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to withdraw proposal");
        }

        // Refresh to update list
        await fetchProposals();
      } catch (err) {
        console.error("Error withdrawing proposal:", err);
        throw err;
      }
    },
    [tripId, fetchProposals]
  );

  // Force resolve a proposal (owner only)
  const forceResolve = useCallback(
    async (proposalId: string, action: 'approve' | 'reject') => {
      if (!tripId) return;

      try {
        const response = await fetch(
          `/api/trips/${tripId}/proposals/${proposalId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, resolutionMethod: 'owner_override' }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to resolve proposal");
        }

        // Refresh to update list
        await fetchProposals();
      } catch (err) {
        console.error("Error resolving proposal:", err);
        throw err;
      }
    },
    [tripId, fetchProposals]
  );

  // Delete a proposal (proposer only, pending status only)
  const deleteProposal = useCallback(
    async (proposalId: string) => {
      if (!tripId) return;

      try {
        // Optimistic update
        setProposals((prev) => prev.filter((p) => p.id !== proposalId));

        const response = await fetch(
          `/api/trips/${tripId}/proposals/${proposalId}`,
          { method: "DELETE" }
        );

        const data = await response.json();

        if (!response.ok) {
          // Revert optimistic update
          await fetchProposals();
          throw new Error(data.error || "Failed to delete proposal");
        }
      } catch (err) {
        console.error("Error deleting proposal:", err);
        throw err;
      }
    },
    [tripId, fetchProposals]
  );

  // Helper functions
  const getProposal = useCallback(
    (proposalId: string): ProposalWithVotes | undefined =>
      proposals.find((p) => p.id === proposalId),
    [proposals]
  );

  const getProposalsForSlot = useCallback(
    (day: number, timeSlot?: string): ProposalWithVotes[] => {
      const slotKey = `${day}-${timeSlot || 'any'}`;
      return proposalsBySlot.get(slotKey) || [];
    },
    [proposalsBySlot]
  );

  const getActiveProposals = useCallback(
    (): ProposalWithVotes[] =>
      proposals.filter((p) => p.status === 'pending' || p.status === 'voting'),
    [proposals]
  );

  const getCurrentUserVote = useCallback(
    (proposalId: string): ProposalVoteType | null => {
      const proposal = proposals.find((p) => p.id === proposalId);
      return proposal?.current_user_vote || null;
    },
    [proposals]
  );

  const getProposalConsensus = useCallback(
    (proposalId: string): ProposalConsensusResult | undefined => {
      const proposal = proposals.find((p) => p.id === proposalId);
      return proposal?.consensus;
    },
    [proposals]
  );

  const hasConflictingProposals = useCallback(
    (day: number, timeSlot?: string): boolean => {
      const slotProposals = getProposalsForSlot(day, timeSlot);
      return slotProposals.length > 1;
    },
    [getProposalsForSlot]
  );

  // Initial fetch
  useEffect(() => {
    if (enabled && tripId) {
      fetchProposals();
    }
  }, [enabled, tripId, fetchProposals]);

  // Keep proposalsRef in sync with proposals state
  useEffect(() => {
    proposalsRef.current = proposals;
  }, [proposals]);

  // Set up real-time subscription
  useEffect(() => {
    if (!enabled || !tripId) return;

    const supabase = supabaseRef.current;

    // Clean up previous channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    // Subscribe to proposal and vote changes
    const channel = supabase
      .channel(`trip-proposals:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_proposals",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          console.log("Proposal change received:", payload.eventType);
          // Refresh proposals on any change
          fetchProposals();

          // Notify callback if provided (use ref to avoid recreating subscription)
          if (onProposalChange && payload.new) {
            const proposal = proposalsRef.current.find((p) => p.id === (payload.new as { id: string }).id);
            if (proposal) {
              onProposalChange(proposal);
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "proposal_votes",
        },
        (payload) => {
          // Check if this vote is for a proposal in this trip (use ref to avoid recreating subscription)
          const proposalId = (payload.new as { proposal_id?: string })?.proposal_id ||
                            (payload.old as { proposal_id?: string })?.proposal_id;
          const isRelevant = proposalsRef.current.some((p) => p.id === proposalId);

          if (isRelevant) {
            console.log("Proposal vote change received for:", proposalId);
            fetchProposals();
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log(`Subscribed to proposals for trip ${tripId}`);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  // Note: Using proposalsRef instead of proposals to avoid recreating subscription
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tripId, fetchProposals, onProposalChange]);

  return {
    // Data
    proposals,
    proposalsBySlot,
    totalVoters,

    // State
    isLoading,
    error,
    isCreating,
    isVoting,

    // Actions
    createProposal,
    voteOnProposal,
    removeVote,
    withdrawProposal,
    forceResolve,
    deleteProposal,
    refreshProposals: fetchProposals,

    // Helpers
    getProposal,
    getProposalsForSlot,
    getActiveProposals,
    getCurrentUserVote,
    getProposalConsensus,
    hasConflictingProposals,
  };
}
