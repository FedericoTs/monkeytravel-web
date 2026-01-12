"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import {
  getLocalOnboardingPreferences,
  clearLocalOnboardingPreferences,
} from "@/hooks/useOnboardingPreferences";
import Image from "next/image";

/**
 * Profile completion page for Google OAuth users who completed onboarding first.
 * Reads preferences from localStorage and updates the user's profile.
 */
export default function CompleteProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/trips/new";
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Setting up your personalized profile...");

  useEffect(() => {
    const completeProfile = async () => {
      const supabase = createClient();

      // Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        setStatus("error");
        setMessage("Authentication error. Redirecting to login...");
        setTimeout(() => router.push("/auth/login"), 2000);
        return;
      }

      // Get onboarding preferences from localStorage
      const localPrefs = getLocalOnboardingPreferences();

      if (localPrefs) {
        // Transfer preferences to database
        const preferences = {
          travelStyles: localPrefs.travelStyles,
          dietaryPreferences: localPrefs.dietaryPreferences,
          accessibilityNeeds: localPrefs.accessibilityNeeds,
        };

        const notificationSettings = {
          dealAlerts: true,
          tripReminders: true,
          pushNotifications: true,
          emailNotifications: true,
          socialNotifications: true,
          marketingNotifications: false,
          // Quiet hours are inverse of active hours
          quietHoursStart: localPrefs.activeHoursEnd,
          quietHoursEnd: localPrefs.activeHoursStart,
        };

        try {
          const { error: updateError } = await supabase
            .from("users")
            .update({
              preferences,
              notification_settings: notificationSettings,
              onboarding_completed: true,
              free_trips_remaining: 1,
            })
            .eq("id", user.id);

          if (updateError) {
            console.error("Error updating profile:", updateError);
            // Continue anyway - profile was created, just preferences may not be saved
          }

          // Clear localStorage now that data is transferred
          clearLocalOnboardingPreferences();

          setStatus("success");
          setMessage("Profile ready! Redirecting...");

          // Small delay for user to see success message
          setTimeout(() => {
            router.push(redirectUrl);
          }, 1000);
        } catch (error) {
          console.error("Error completing profile:", error);
          // Continue to redirect even if update failed
          clearLocalOnboardingPreferences();
          router.push(redirectUrl);
        }
      } else {
        // No local preferences - redirect immediately
        // The callback already set onboarding_completed and free_trips_remaining
        router.push(redirectUrl);
      }
    };

    completeProfile();
  }, [router, redirectUrl]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
      <div className="text-center max-w-md px-4">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Image
            src="/images/logo.png"
            alt="MonkeyTravel"
            width={64}
            height={64}
            className="rounded-2xl"
          />
        </div>

        {/* Status */}
        <div className="mb-6">
          {status === "loading" && (
            <div className="w-12 h-12 mx-auto border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          )}
          {status === "success" && (
            <div className="w-12 h-12 mx-auto bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {status === "error" && (
            <div className="w-12 h-12 mx-auto bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}
        </div>

        {/* Message */}
        <h1 className="text-xl font-semibold text-slate-900 mb-2">
          {status === "loading" ? "Finalizing Your Account" : status === "success" ? "All Set!" : "Oops!"}
        </h1>
        <p className="text-slate-500">{message}</p>

        {/* Progress dots */}
        {status === "loading" && (
          <div className="flex justify-center gap-1 mt-6">
            <div className="w-2 h-2 bg-[var(--primary)] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="w-2 h-2 bg-[var(--primary)] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="w-2 h-2 bg-[var(--primary)] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        )}
      </div>
    </div>
  );
}
