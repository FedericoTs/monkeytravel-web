"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  trackSessionStart,
  trackUserReturn,
  setUserId,
  setUserPropertiesEnhanced,
} from "@/lib/analytics";

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

  useEffect(() => {
    // Only track once per page load
    if (hasTracked.current) return;
    hasTracked.current = true;

    const trackSession = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

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

      // Fetch user data for context
      const { data: userData } = await supabase
        .from("users")
        .select("created_at, onboarding_completed, subscription_tier, is_pro")
        .eq("id", user.id)
        .single();

      const { count: tripsCount } = await supabase
        .from("trips")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      const { count: activeTripsCount } = await supabase
        .from("trips")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "active");

      // Check for beta access
      const { data: betaAccess } = await supabase
        .from("user_tester_access")
        .select("id")
        .eq("user_id", user.id)
        .single();

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
    };

    // Small delay to ensure the page is ready
    const timeoutId = setTimeout(trackSession, 100);
    return () => clearTimeout(timeoutId);
  }, []);

  // This component doesn't render anything
  return null;
}
