"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import type { Activity, ActivityProposal } from "@/types";

/**
 * The trip page's side of a proposal the crew approved, for useProposals'
 * `onProposalChange`. The server has already added an approved proposal's
 * activity to the trip: the page takes the stored copy (`refetchQueued`),
 * once per proposal, in the save queue and never over unsaved edits (their
 * save gets the conflict choice instead). A toast names the activity, and
 * the proposal stays in `recentlyApproved` for 3 s while its approval
 * animates in the day's list.
 */
export function useProposalApprovals(refetchQueued: () => Promise<unknown>) {
  const t = useTranslations("trips");
  const { addToast } = useToast();
  const router = useRouter();

  // Track recently approved proposals to show transition animation
  const [recentlyApproved, setRecentlyApproved] = useState<Set<string>>(new Set());

  const approvalsSeenRef = useRef<Set<string>>(new Set());
  const handleProposalChange = useCallback((proposal: ActivityProposal) => {
    if (proposal.status === "approved" && !approvalsSeenRef.current.has(proposal.id)) {
      approvalsSeenRef.current.add(proposal.id);
      // Mark as recently approved for animation
      setRecentlyApproved((prev) => new Set([...prev, proposal.id]));

      const name = (proposal.activity_data as Activity | undefined)?.name;
      if (name) addToast(t("detail.proposalApproved", { name, day: proposal.target_day }), "success");

      void refetchQueued()
        .catch((err) => {
          console.warn("[proposals] approved, but the page could not re-read the trip", err);
          router.refresh();
        });

      // Remove from recently approved after animation completes
      setTimeout(() => {
        setRecentlyApproved((prev) => {
          const next = new Set(prev);
          next.delete(proposal.id);
          return next;
        });
      }, 3000);
    }
  }, [addToast, refetchQueued, router, t]);

  return { recentlyApproved, handleProposalChange };
}
