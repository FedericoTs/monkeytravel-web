"use client";

import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import type { ProposalVoteType } from "@/types";

/**
 * The voting sheet's actions on the proposal it shows, for VotingBottomSheet:
 * vote, take the vote back, and the owner's approve or reject of a
 * deadlocked proposal, each confirmed in a toast. The sheet stays open when
 * one throws.
 */
export function useVotingSheetActions({
  proposal,
  voteOnProposal,
  removeVote,
  forceResolve,
}: {
  /** The proposal the sheet shows, if open. */
  proposal: { id: string } | null;
  voteOnProposal: (proposalId: string, voteType: ProposalVoteType, comment?: string) => Promise<void>;
  removeVote: (proposalId: string) => Promise<void>;
  forceResolve: (proposalId: string, action: "approve" | "reject") => Promise<void>;
}) {
  const t = useTranslations("trips");
  const tCommon = useTranslations("common");
  const { addToast } = useToast();
  return {
    onVote: async (voteType: ProposalVoteType, comment?: string) => {
      if (proposal) {
        await voteOnProposal(proposal.id, voteType, comment);
        addToast(tCommon("proposals.toasts.voteRecorded"), "success");
      }
    },
    onRemoveVote: async () => {
      if (proposal) {
        await removeVote(proposal.id);
        addToast(tCommon("proposals.toasts.voteRemoved"), "success");
      }
    },
    onForceResolve: async (action: "approve" | "reject") => {
      if (proposal) {
        try {
          await forceResolve(proposal.id, action);
        } catch (err) {
          addToast(t("detail.proposalActionFailed"), "error");
          throw err;
        }
        // An approval is confirmed by useProposalApprovals, with the day.
        if (action === "reject") addToast(tCommon("proposals.toasts.rejected"), "success");
      }
    },
  };
}
