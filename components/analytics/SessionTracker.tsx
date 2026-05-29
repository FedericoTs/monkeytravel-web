"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthOptional } from "@/components/auth/AuthProvider";
import {
  trackSessionStart,
  trackUserReturn,
  setUserId,
  setUserPropertiesEnhanced,
} from "@/lib/analytics";
import { identifyUser, type PostHogUserProperties } from "@/lib/posthog";

const SESSION_STORAGE_KEY = "mt_last_visit";
const SESSION_COUNT_KEY = "mt_session_count";

/**
 * SessionTracker - Tracks user sessions and returns for retention analytics
 *
 * This component should be mounted in the root layout to track:
 * - Session start with user context
 * - User returns (how long since last visit)
 * - User properties for GA4 segmentation
 */
export default function SessionTracker() {
  const hasTracked = useRef(false);
  // Task #181 cleanup: read auth from the single AuthProvider rather than
  // firing our own getUser(). Wait for `authLoading` to flip false before
  // tracking — otherwise the requestIdleCallback path could race ahead and
  // emit an "anonymous session" event for users who are actually logged in.
  //
  // P0 fix 2026-05-29: this component is mounted in app/layout.tsx (root,
  // outside [locale]) while AuthProvider lives in app/[locale]/layout.tsx.
  // The plain useAuth() threw "must be used within AuthProvider" on every
  // SSR render, 500-ing the whole site. useAuthOptional returns the safe
  // default ({ user: null, loading: false }) when called outside the
  // provider, which lands SessionTracker on its "Anonymous session" branch
  // — same behaviour as the pre-#181 getUser()-returning-null path.
  const { user, loading: authLoading } = useAuthOptional();

  useEffect(() => {
    // Only track once per page load
    if (hasTracked.current) return;
    if (authLoading) return;
    hasTracked.current = true;

    const trackSession = async () => {
      // Calculate days since last visit
      const lastVisit = localStorage.getItem(SESSION_STORAGE_KEY);
      const sessionCount = parseInt(localStorage.getItem(SESSION_COUNT_KEY) || "0", 10) + 1;
      const now = Date.now();
      let daysSinceLastVisit = 0;

      if (lastVisit) {
        const lastVisitTime = parseInt(lastVisit, 10);
        daysSinceLastVisit = Math.floor((now - lastVisitTime) / (1000 * 60 * 60 * 24));
      }

      // Update localStorage
      localStorage.setItem(SESSION_STORAGE_KEY, now.toString());
      localStorage.setItem(SESSION_COUNT_KEY, sessionCount.toString());

      if (!user) {
        // Anonymous session
        trackSessionStart({
          isNewUser: sessionCount === 1,
          hasActiveTrip: false,
          tripsCount: 0,
          daysSinceSignup: 0,
        });
        return;
      }

      // Set user ID for cross-session tracking
      setUserId(user.id);

      const supabase = createClient();

      // Fetch all user data in parallel for better performance
      const [
        { data: userData },
        { count: tripsCount },
        { count: activeTripsCount },
        { data: betaAccess },
      ] = await Promise.all([
        // User profile data
        supabase
          .from("users")
          .select("created_at, onboarding_completed, subscription_tier, is_pro, referral_tier, preferred_language")
          .eq("id", user.id)
          .single(),
        // Total trips count
        supabase
          .from("trips")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id),
        // Active trips count
        supabase
          .from("trips")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "active"),
        // Beta access check
        supabase
          .from("user_tester_access")
          .select("id")
          .eq("user_id", user.id)
          .single(),
      ]);

      // Calculate account age
      const accountCreated = userData?.created_at ? new Date(userData.created_at) : new Date();
      const daysSinceSignup = Math.floor((now - accountCreated.getTime()) / (1000 * 60 * 60 * 24));

      // Determine user stage
      const trips = tripsCount || 0;
      const userStage = trips === 0
        ? "new"
        : trips === 1
          ? "activated"
          : trips < 5
            ? "engaged"
            : "power_user";

      // Track user return (if not first visit)
      if (sessionCount > 1) {
        trackUserReturn({
          daysSinceLastVisit,
          totalSessions: sessionCount,
          returnSource: "direct", // Could be enhanced with UTM tracking
        });
      }

      // Track session start with full context
      trackSessionStart({
        userId: user.id,
        isNewUser: daysSinceSignup === 0,
        hasActiveTrip: (activeTripsCount || 0) > 0,
        tripsCount: trips,
        daysSinceSignup,
      });

      // Set user properties for GA4 segmentation
      setUserPropertiesEnhanced({
        subscriptionTier: userData?.subscription_tier || "free",
        tripsCreated: trips,
        accountAgeDays: daysSinceSignup,
        onboardingCompleted: userData?.onboarding_completed ?? false,
        hasBetaAccess: !!betaAccess,
        referralSource: "organic", // Could be enhanced with UTM tracking
        userStage,
      });

      // Identify user in PostHog for feature flags and experiments
      const posthogProperties: PostHogUserProperties = {
        email: user.email,
        name: user.user_metadata?.display_name || user.user_metadata?.full_name,
        subscription_tier: (userData?.subscription_tier as "free" | "pro" | "premium") || "free",
        referral_tier: (userData?.referral_tier as 0 | 1 | 2 | 3) ?? 0,
        onboarding_completed: userData?.onboarding_completed ?? false,
        trips_created: trips,
        account_age_days: daysSinceSignup,
        has_beta_access: !!betaAccess,
        preferred_language: userData?.preferred_language || "en",
        user_stage: userStage as "new" | "activated" | "engaged" | "power_user",
      };
      identifyUser(user, posthogProperties);
    };

    // Defer to idle time so session tracking doesn't compete with initial paint
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(trackSession, { timeout: 5000 });
      return () => window.cancelIdleCallback(idleId);
    } else {
      // Fallback for Safari (no requestIdleCallback support)
      const timeoutId = setTimeout(trackSession, 5000);
      return () => clearTimeout(timeoutId);
    }
    // hasTracked guards re-fire — only the first post-auth-resolved render
    // schedules the work, so we intentionally re-run when authLoading flips.
  }, [authLoading, user]);

  // This component doesn't render anything
  return null;
}
