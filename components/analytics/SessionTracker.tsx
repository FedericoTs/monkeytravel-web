"use client";

import { useEffect, useRef } from "react";
import { hasSessionCookie } from "@/lib/supabase/session-cookie";
import { isNoRow } from "@/lib/supabase/no-row";
import {
  trackUserReturn,
  setUserId,
  setUserPropertiesEnhanced,
} from "@/lib/analytics";
import { forgetSignedOutPerson, identifyUser, type PostHogUserProperties } from "@/lib/posthog";
import { safeGet, safeSet } from "@/lib/safe-storage";
import { isSupportedLanguage } from "@/lib/ai/language";
import { logWriteError } from "@/lib/supabase/log-write-error";

const SESSION_STORAGE_KEY = "mt_last_visit";
// Away longer than this is a return: GA4 ends a session after 30 idle minutes too.
const RETURN_AFTER_MS = 30 * 60 * 1000;

/**
 * How long this browser had no page of the site in view, and marks it seen
 * now. Null on a first visit or when storage is blocked: a browser told to
 * keep nothing never reads as returning, and safe storage never throws, so
 * this cannot break the page it runs on.
 */
function markSeen(): number | null {
  const now = Date.now();
  const last = Number(safeGet(SESSION_STORAGE_KEY));
  safeSet(SESSION_STORAGE_KEY, String(now));
  return last > 0 ? now - last : null;
}

function reportReturn(away: number | null) {
  if (away !== null && away > RETURN_AFTER_MS) {
    trackUserReturn({ daysSinceLastVisit: Math.floor(away / (1000 * 60 * 60 * 24)) });
  }
}

/**
 * SessionTracker - Tracks returns and user properties for retention analytics
 *
 * This component should be mounted in the root layout to track:
 * - Returns: a signed-in person back after more than 30 minutes away
 * - User properties for GA4 segmentation
 *
 * GA4 counts sessions itself, with its own session_start, so this sends none.
 *
 * WHY IT READS THE USER ITSELF: this component lives in app/layout.tsx (root
 * layout, locale-agnostic) while AuthProvider lives in app/[locale]/layout.tsx,
 * so SessionTracker is a SIBLING of {children}, not a descendant. useAuth()
 * would throw here ("must be used within AuthProvider") and break every SSR
 * render; useAuthOptional() would see `user: null` and track every signed-in
 * user as anonymous. So it makes its own supabase.auth.getUser() call, one
 * extra round-trip.
 */
export default function SessionTracker() {
  const hasTracked = useRef(false);
  const signedIn = useRef(false);

  useEffect(() => {
    // Only track once per page load
    if (hasTracked.current) return;
    hasTracked.current = true;
    const awayOnArrival = markSeen();

    const trackSession = async () => {
      // Fetch auth user directly — we cannot use useAuth() here, see docblock.
      // Without a session cookie there is nobody to look up, so anonymous
      // visitors never download the Supabase client for this. A browser
      // PostHog still knows as a signed-in person has been signed out.
      if (!hasSessionCookie()) {
        forgetSignedOutPerson();
        return;
      }
      const supabase = await import("@/lib/supabase/client").then(({ createClient }) => createClient());
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;

      // Set user ID for cross-session tracking
      setUserId(user.id);

      // Fetch all user data in parallel for better performance
      const [userRead, tripsRead, betaRead] = await Promise.all([
        // User profile data
        supabase
          .from("users")
          .select("created_at, onboarding_completed, subscription_tier, is_pro, referral_tier, preferred_language")
          .eq("id", user.id)
          .single(),
        // Total trips count
        supabase
          .from("trips")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        // Beta access check. maybeSingle, not single: most users have no
        // tester row, and .single() turns that absence into a 406 error on
        // every tracked page load.
        supabase
          .from("user_tester_access")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      // Properties built from a refused read would overwrite the person's
      // real ones with defaults. The next page load tracks the session.
      const failed = [userRead, tripsRead, betaRead].find((r) => r.error && !isNoRow(r.error));
      if (failed) {
        console.error("[SessionTracker] read failed:", failed.error?.message);
        return;
      }
      const { data: userData } = userRead;

      // The language someone uses the app in is the one to write to them in,
      // whichever way they signed in. The column's default is English.
      const language = document.documentElement.lang;
      if (userData && isSupportedLanguage(language) && userData.preferred_language !== language) {
        logWriteError("session: preferred language", await supabase.from("users").update({ preferred_language: language }).eq("id", user.id));
      }

      const { count: tripsCount } = tripsRead;
      const { data: betaAccess } = betaRead;

      // Calculate account age
      const now = Date.now();
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

      signedIn.current = true;
      reportReturn(awayOnArrival);

      // Set user properties for GA4 segmentation
      setUserPropertiesEnhanced({
        subscriptionTier: userData?.subscription_tier || "free",
        tripsCreated: trips,
        accountAgeDays: daysSinceSignup,
        onboardingCompleted: userData?.onboarding_completed ?? false,
        hasBetaAccess: !!betaAccess,
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
  }, []);

  // A page in view keeps the mark fresh: without that, a tab opened after an
  // hour in another one would read as a return. Coming back to a page after
  // more than 30 minutes is one.
  useEffect(() => {
    const onVisibilityChange = () => {
      const away = markSeen();
      if (document.visibilityState === "visible" && signedIn.current) reportReturn(away);
    };
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") markSeen();
    }, 60 * 1000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // This component doesn't render anything
  return null;
}
