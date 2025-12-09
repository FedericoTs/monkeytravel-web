"use client";

/**
 * Auth Event Tracker Component
 *
 * Tracks OAuth signup/login events that come from the auth callback.
 * The callback adds ?auth_event=signup_google or ?auth_event=login_google
 * to the URL, which this component reads and tracks.
 */

import { useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { trackSignup, trackLogin, setUserId } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";

export default function AuthEventTracker() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const authEvent = searchParams.get("auth_event");

    if (!authEvent) return;

    // Track the event
    const trackAuthEvent = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        setUserId(user.id);
      }

      if (authEvent === "signup_google") {
        trackSignup("google");
      } else if (authEvent === "login_google") {
        trackLogin("google");
      }

      // Clean up the URL by removing the auth_event parameter
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("auth_event");
      const newUrl = newParams.toString()
        ? `${pathname}?${newParams.toString()}`
        : pathname;

      // Replace the URL without triggering a navigation
      window.history.replaceState({}, "", newUrl);
    };

    trackAuthEvent();
  }, [searchParams, pathname, router]);

  // This component doesn't render anything
  return null;
}
