"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { hapticLight, hapticMedium, hapticError } from "@/lib/native/haptics";
import {
  captureExploreTripLiked,
  captureExploreTripSaved,
  captureExploreTripForked,
  type ExploreSurface,
} from "@/lib/posthog/events";

interface EngagementBarProps {
  tripId: string;
  /** Initial counts, server-rendered from the trip row. */
  likeCount: number;
  saveCount: number;
  forkCount: number;
  /** Whether the current viewer has already liked / saved this trip. */
  initialLiked?: boolean;
  initialSaved?: boolean;
  /** Auth state — drives the "sign in to like" prompt. */
  isAuthenticated: boolean;
  /** Owner state — drives the "you can't fork your own trip" hint. */
  isOwner?: boolean;
  /** Whether to show the Fork button (hidden on /trips/[id] owner views). */
  showFork?: boolean;
  /**
   * Where this bar is mounted. Drives funnel attribution in PostHog —
   * /explore feed-card vs /trips/[id] vs /shared/[token] have different
   * intent profiles. Defaults to `explore_feed` for backward compat.
   */
  surface?: ExploreSurface;
}

/**
 * Like + Save + Fork action bar for /trips/[id] + /shared/[token].
 *
 * Each action does an optimistic UI update and then reconciles with
 * the API response (count may bounce by ±1 if a concurrent action
 * lands). Errors revert + flash a toast (handled by global Sonner
 * provider in app/providers.tsx, already wired in the app).
 *
 * Like requires auth — anon clicks open the existing AuthPromptModal
 * pattern. Save works for both anon (cookie-keyed) and auth. Fork
 * always requires auth (it creates a new trip row owned by the user).
 */
export default function EngagementBar({
  tripId,
  likeCount,
  saveCount,
  forkCount,
  initialLiked = false,
  initialSaved = false,
  isAuthenticated,
  isOwner = false,
  showFork = true,
  surface = "explore_feed",
}: EngagementBarProps) {
  const router = useRouter();
  // i18n: every visible string (aria-labels + Fork button + owner hint)
  // shipped in English on /it /es. Keys already exist under the
  // share.explore.engagement namespace alongside PublishToggle.
  const t = useTranslations("common.share.explore.engagement");

  const [liked, setLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(likeCount);
  const [saved, setSaved] = useState(initialSaved);
  const [saves, setSaves] = useState(saveCount);
  const [forks, setForks] = useState(forkCount);
  const [busy, setBusy] = useState<"like" | "save" | "fork" | null>(null);
  const [, startTransition] = useTransition();

  const toggleLike = useCallback(async () => {
    if (!isAuthenticated) {
      void captureExploreTripLiked({
        trip_id: tripId,
        surface,
        required_auth: true,
      }).catch(() => {});
      // Send to signup with intent to return to this trip.
      const back = typeof window !== "undefined" ? window.location.pathname : "/";
      router.push(`/auth/signup?redirect=${encodeURIComponent(back)}`);
      return;
    }
    if (busy) return;
    setBusy("like");
    // Optimistic
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikes((n) => n + (wasLiked ? -1 : 1));
    try {
      const res = await fetch(`/api/trips/${tripId}/like`, {
        method: wasLiked ? "DELETE" : "POST",
      });
      if (!res.ok) throw new Error(`like failed: ${res.status}`);
      const data = await res.json();
      // Only fire the conversion event on the LIKE direction (not unlike).
      // Unlikes are a small fraction of clicks and would dirty the funnel
      // numerator if mixed in.
      if (!wasLiked) {
        void captureExploreTripLiked({
          trip_id: tripId,
          surface,
          required_auth: false,
        }).catch(() => {});
      }
      // Reconcile to server-of-truth.
      setLiked(!!data.liked);
      setLikes(typeof data.count === "number" ? data.count : likes);
      // Medium impact — like is a meaningful collaboration-loop
      // moment (the trip author gets a notification + a count bump).
      // Matches ProposalVoteButtons' "you committed something" model.
      hapticMedium();
    } catch (err) {
      console.error("[engagement] like failed:", err);
      setLiked(wasLiked); // revert
      setLikes((n) => n + (wasLiked ? 1 : -1));
      hapticError();
    } finally {
      setBusy(null);
    }
  }, [isAuthenticated, busy, liked, likes, tripId, router, surface]);

  const toggleSave = useCallback(async () => {
    if (busy) return;
    setBusy("save");
    const wasSaved = saved;
    setSaved(!wasSaved);
    setSaves((n) => n + (wasSaved ? -1 : 1));
    try {
      const res = await fetch(`/api/trips/${tripId}/save`, {
        method: wasSaved ? "DELETE" : "POST",
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      const data = await res.json();
      if (!wasSaved) {
        void captureExploreTripSaved({
          trip_id: tripId,
          surface,
          was_anon: !isAuthenticated,
        }).catch(() => {});
      }
      setSaved(!!data.saved);
      setSaves(typeof data.count === "number" ? data.count : saves);
      // Light impact — save is a low-stakes confirmation per the
      // haptics docblock ("Trip saved successfully" is the canonical
      // example). Anon users can save too, so we don't want to over-
      // signal commitment.
      hapticLight();
    } catch (err) {
      console.error("[engagement] save failed:", err);
      setSaved(wasSaved);
      setSaves((n) => n + (wasSaved ? 1 : -1));
      hapticError();
    } finally {
      setBusy(null);
    }
  }, [busy, saved, saves, tripId, surface, isAuthenticated]);

  const doFork = useCallback(async () => {
    if (!isAuthenticated) {
      void captureExploreTripForked({
        trip_id: tripId,
        surface,
        required_auth: true,
      }).catch(() => {});
      const back = typeof window !== "undefined" ? window.location.pathname : "/";
      router.push(`/auth/signup?redirect=${encodeURIComponent(back)}`);
      return;
    }
    if (busy) return;
    setBusy("fork");
    setForks((n) => n + 1); // optimistic
    try {
      const res = await fetch(`/api/trips/${tripId}/fork`, { method: "POST" });
      if (!res.ok) throw new Error(`fork failed: ${res.status}`);
      const data = await res.json();
      void captureExploreTripForked({
        trip_id: tripId,
        surface,
        required_auth: false,
      }).catch(() => {});
      // Medium impact — fork creates a new trip row owned by the user
      // and we're about to navigate away. The haptic fires before the
      // route transition so the user feels the commit before the
      // visual changes.
      hapticMedium();
      if (data?.redirectTo) {
        startTransition(() => router.push(data.redirectTo));
      }
    } catch (err) {
      console.error("[engagement] fork failed:", err);
      setForks((n) => Math.max(0, n - 1));
      hapticError();
    } finally {
      setBusy(null);
    }
  }, [isAuthenticated, busy, tripId, router, surface]);

  return (
    <div
      className="flex items-center gap-2 sm:gap-3"
      data-testid="engagement-bar"
      aria-label={t("barAriaLabel")}
    >
      <button
        onClick={toggleLike}
        disabled={busy === "like"}
        className={`group inline-flex items-center gap-1.5 px-3 py-2 rounded-full border text-sm font-medium transition-all ${
          liked
            ? "bg-rose-50 border-rose-200 text-rose-700"
            : "bg-white border-slate-200 text-slate-700 hover:border-rose-200 hover:text-rose-700"
        } disabled:opacity-60`}
        aria-pressed={liked}
        aria-label={liked ? t("likeAriaUnlike") : t("likeAriaLike")}
      >
        <svg
          className={`w-4 h-4 ${liked ? "fill-current" : ""}`}
          fill={liked ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={liked ? 0 : 2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 016.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z"
          />
        </svg>
        <span className="tabular-nums">{likes}</span>
      </button>

      <button
        onClick={toggleSave}
        disabled={busy === "save"}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full border text-sm font-medium transition-all ${
          saved
            ? "bg-amber-50 border-amber-200 text-amber-700"
            : "bg-white border-slate-200 text-slate-700 hover:border-amber-200 hover:text-amber-700"
        } disabled:opacity-60`}
        aria-pressed={saved}
        aria-label={saved ? t("saveAriaRemove") : t("saveAriaSave")}
      >
        <svg
          className={`w-4 h-4 ${saved ? "fill-current" : ""}`}
          fill={saved ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={saved ? 0 : 2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 4a2 2 0 012-2h10a2 2 0 012 2v18l-7-3.5L5 22V4z" />
        </svg>
        <span className="tabular-nums">{saves}</span>
      </button>

      {showFork && !isOwner && (
        <button
          onClick={doFork}
          disabled={busy === "fork"}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[var(--primary)] text-white text-sm font-semibold hover:opacity-90 transition-all shadow-sm disabled:opacity-60"
          aria-label={t("forkAriaLabel")}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7l4-4m0 0l4 4m-4-4v18" />
          </svg>
          {t("forkButton", { count: forks })}
        </button>
      )}

      {isOwner && (
        <span className="text-xs text-slate-500 ml-1" title={t("ownerForkTooltip")}>
          {t("forkedCount", { count: forks })}
        </span>
      )}
    </div>
  );
}
