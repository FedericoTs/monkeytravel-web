"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { MyVote, VoteTally } from "@/components/trip/AnonymousActivityVoteBar";
import { useToast } from "@/components/ui/Toast";
import { hapticError, hapticMedium } from "@/lib/native/haptics";

interface VoteApiResponse {
  activity_id: string;
  up: number;
  down: number;
  myVote: MyVote;
}

interface VotesHydrationResponse {
  tallies: Record<string, VoteTally>;
  myVotes: Record<string, "up" | "down">;
}

/**
 * Voting on a shared trip's activities without an account: the tallies and this
 * viewer's votes, a vote and what it answers, and the one nudge after a guest's
 * first vote. Votes go through the share link, so with no `shareToken` nothing is
 * read.
 */
export function useSharedVotes({ shareToken, isOwner }: { shareToken?: string; isOwner?: boolean }) {
  const t = useTranslations("common");
  const { addToast } = useToast();
  // Anonymous vote state — see /api/shared/[token]/vote and /votes.
  // Tallies are keyed by activity.id (the per-activity id in the itinerary).
  // myVotes is the current viewer's own votes, resolved server-side via the
  // mt_anon_voter httpOnly cookie. hasDisplayName tracks whether the viewer
  // has already typed a name this session, so we only show the inline prompt once.
  const [voteTallies, setVoteTallies] = useState<Record<string, VoteTally>>({});
  const [myVotes, setMyVotes] = useState<Record<string, "up" | "down">>({});
  const [pendingVoteId, setPendingVoteId] = useState<string | null>(null);
  const [hasDisplayName, setHasDisplayName] = useState(false);

  // Hydrate vote tallies + this viewer's own votes on mount. One round-trip,
  // returns all activities at once (typical trip is <40 activities).
  useEffect(() => {
    if (!shareToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shared/${shareToken}/votes`, {
          method: "GET",
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const data = (await res.json()) as VotesHydrationResponse;
        if (cancelled) return;
        setVoteTallies(data.tallies ?? {});
        setMyVotes(data.myVotes ?? {});
        // If the viewer already has votes on record, they've already been
        // through the name flow at least once — don't prompt them again.
        if (data.myVotes && Object.keys(data.myVotes).length > 0) {
          setHasDisplayName(true);
        }
      } catch {
        // Non-fatal: page still works without vote hydration; the user just
        // sees zero counts until they click.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  // A guest's first vote is when the plan has been worth their time: the one
  // moment, once per visit, to say they can have a plan like it for a trip of
  // their own. Under that activity, never as a popup.
  const [afterVoteId, setAfterVoteId] = useState<string | null>(null);
  const afterVoteAsked = useRef(false);

  const handleVote = async ({
    activityId,
    voteType,
    displayName,
  }: {
    activityId: string;
    voteType: "up" | "down" | null;
    displayName?: string;
  }) => {
    setPendingVoteId(activityId);
    try {
      const res = await fetch(`/api/shared/${shareToken}/vote`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity_id: activityId,
          vote_type: voteType,
          ...(displayName ? { display_name: displayName } : {}),
        }),
      });
      if (!res.ok) {
        // Tell the user the vote didn't land. 429 is the vote route's 20/min
        // rate limit, so phrase it as a retry, not a failure; every other
        // status gets the generic vote-failed message. Pair toasts with
        // hapticError so Capacitor users feel the miss without needing to
        // look at the screen.
        if (res.status === 429) {
          addToast(t("shared.rateLimit"), "warning");
        } else {
          addToast(t("shared.voteFailed"), "error");
        }
        hapticError();
        return;
      }
      const data = (await res.json()) as VoteApiResponse;
      setVoteTallies((prev) => ({
        ...prev,
        [data.activity_id]: { up: data.up, down: data.down },
      }));
      setMyVotes((prev) => {
        const next = { ...prev };
        if (data.myVote === null) {
          delete next[data.activity_id];
        } else {
          next[data.activity_id] = data.myVote;
        }
        return next;
      });
      // Either we just collected a name, or the user skipped — either way
      // they've been through the prompt and shouldn't see it again.
      setHasDisplayName(true);
      if (!afterVoteAsked.current && data.myVote !== null && !isOwner) {
        afterVoteAsked.current = true;
        setAfterVoteId(data.activity_id);
      }
      // Capacitor-only haptic confirmation; a no-op on the web.
      hapticMedium();
    } catch {
      // Network failure (offline, DNS, CORS) — surface it instead of
      // silently dropping the click. Different copy from the 5xx case
      // so the user knows to check their connection first.
      addToast(t("shared.networkError"), "error");
      hapticError();
    } finally {
      setPendingVoteId(null);
    }
  };

  return {
    voteTallies,
    myVotes,
    pendingVoteId,
    hasDisplayName,
    afterVoteId,
    dismissAfterVote: () => setAfterVoteId(null),
    handleVote,
  };
}
