"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
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
 *
 * AUTH-SOURCE POST-MORTEM (2026-05-29, task #212):
 * This component lives in app/layout.tsx (root layout, locale-agnostic) while
 * AuthProvider lives in app/[locale]/layout.tsx — i.e. SessionTracker is a
 * SIBLING of {children}, not a descendant. Cycle-5 task #181 attempted to
 * consolidate it onto useAuth() from AuthProvider and the resulting
 * `useContext` returned undefined → useAuth() threw "must be used within
 * AuthProvider" → every SSR render 500'd (P0 incident 2026-05-29).
 *
 * The P0 patch swapped to useAuthOptional() which returns
 * `{user: null, loading: false}` outside the provider tree, restoring SSR but
 * silently breaking retention analytics: every logged-in user was tracked as
 * anonymous because `user` was always null here.
 *
 * Fix: revert to the pre-#181 pattern — SessionTracker makes its own
 * supabase.auth.getUser() call. We accept one extra round-trip; the
 * "consolidation" goal of #181 only applies to [locale]-subtree consumers
 * (Navbar, NotificationBell, etc.) — root-layout siblings cannot share
 * the provider's state by definition.
 */
export default function SessionTracker() {
  const hasTracked = useRef(false);

  useEffect(() => {
    // Only track once per page load
    if (hasTracked.current) return;
    hasTracked.current = true;

    const trackSession = async () => {
      // Fetch auth user directly — we cannot use useAuth() here, see docblock.
      const supabaseAuth = createClient();
      const {
        data: { user },
      } = await supabaseAuth.auth.getUser();
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
    // hasTracked.current guards against React-StrictMode double-fire in dev.
    // No external dependencies — getUser() is called inside trackSession.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // This component doesn't render anything
  return null;
}
