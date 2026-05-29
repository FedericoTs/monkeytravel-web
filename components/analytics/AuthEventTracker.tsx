"use client";

/**
 * Auth Event Tracker Component
 *
 * Tracks OAuth signup/login events that come from the auth callback.
 * The callback adds ?auth_event=signup_google or ?auth_event=login_google
 * to the URL, which this component reads and tracks.
 *
 * Task #207: also fires PostHog captureUserSignedUp/LoggedIn + identify()
 * + aliasAnonToUser() — the auth callback is server-side, so it cannot
 * call posthog-js directly. This client component is the bridge.
 */

import { useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { trackSignup, trackLogin, setUserId } from "@/lib/analytics";
import {
  captureUserSignedUp,
  captureUserLoggedIn,
} from "@/lib/posthog/events";
import {
  identify,
  aliasAnonToUser,
} from "@/lib/posthog/identify";
import { useAuth } from "@/components/auth/AuthProvider";

export default function AuthEventTracker() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  // Task #181 cleanup: pull the current user from the single AuthProvider
  // instead of firing our own getUser(). We still wait for `loading` to
  // resolve so signup_google attribution doesn't fire with userId=null
  // (the OAuth callback redirected us here precisely because a user just
  // appeared).
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    const authEvent = searchParams.get("auth_event");

    if (!authEvent) return;
    if (authLoading) return;

    if (user) {
      setUserId(user.id);
    }

    // GA4 + PostHog fire-and-forget. Never block the URL cleanup on
    // analytics — the SDKs may be lazy-loading or blocked by a privacy
    // extension; we don't want the user stuck on a URL with stale params.
    if (authEvent === "signup_google") {
      trackSignup("google");
      if (user) {
        // Stitch anon distinct_id → user.id BEFORE the signup event so
        // pre-signup activity (homepage view, wizard step views) merges
        // into the new user's PostHog profile.
        aliasAnonToUser(user.id).catch(() => {
          /* posthog not loaded — drop, alias will retry on next identify */
        });
        identify(user.id, {
          email: user.email,
          signupMethod: "oauth-google",
          locale,
        }).catch(() => {
          /* posthog not loaded — SessionTracker will identify on next session */
        });
        captureUserSignedUp({ method: "google" }).catch(() => {
          /* posthog not loaded — event dropped, GA4 still captured */
        });
      }
    } else if (authEvent === "login_google") {
      trackLogin("google");
      if (user) {
        aliasAnonToUser(user.id).catch(() => {
          /* posthog not loaded — drop */
        });
        identify(user.id, {
          email: user.email,
          locale,
        }).catch(() => {
          /* posthog not loaded — drop */
        });
        captureUserLoggedIn({ method: "google" }).catch(() => {
          /* posthog not loaded — drop */
        });
      }
    } else if (authEvent === "email_confirmed") {
      // PKCE flow — email link verified. This is the "returning user
      // clicked the magic-link in their inbox" path; treat as login.
      // (The email-signup form already fired captureUserSignedUp.)
      if (user) {
        identify(user.id, {
          email: user.email,
          locale,
        }).catch(() => {
          /* posthog not loaded — drop */
        });
        captureUserLoggedIn({ method: "email" }).catch(() => {
          /* posthog not loaded — drop */
        });
      }
    }
    // NOTE: signup_email is set by the email signup form on its redirect
    // to /welcome, but the form itself already fires captureUserSignedUp
    // + identify + alias BEFORE redirecting. We intentionally do NOT
    // re-fire here to avoid double-counting if AuthEventTracker is later
    // mounted on more routes. AuthProvider's identify-on-mount will
    // re-stitch identity if the SDK was still loading at signup-time.

    // Clean up the URL by removing the auth_event parameter
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.delete("auth_event");
    const newUrl = newParams.toString()
      ? `${pathname}?${newParams.toString()}`
      : pathname;

    // Replace the URL without triggering a navigation
    window.history.replaceState({}, "", newUrl);
  }, [searchParams, pathname, router, authLoading, user, locale]);

  // This component doesn't render anything
  return null;
}
