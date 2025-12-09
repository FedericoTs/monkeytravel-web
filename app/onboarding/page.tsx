"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import Link from "next/link";
import {
  trackOnboardingStepViewed,
  trackOnboardingStepCompleted,
  trackOnboardingCompleted,
  trackOnboardingSkipped,
} from "@/lib/analytics";
import {
  useOnboardingPreferences,
  type LocalOnboardingPreferences,
} from "@/hooks/useOnboardingPreferences";

// Step components
import TravelStyleStep from "@/components/onboarding/TravelStyleStep";
import DietaryStep from "@/components/onboarding/DietaryStep";
import AccessibilityStep from "@/components/onboarding/AccessibilityStep";
import ActiveHoursStep from "@/components/onboarding/ActiveHoursStep";

export interface OnboardingPreferences {
  travelStyles: string[];
  dietaryPreferences: string[];
  accessibilityNeeds: string[];
  activeHoursStart: number;
  activeHoursEnd: number;
}

const TOTAL_STEPS = 4;

const STEP_NAMES: Record<number, string> = {
  1: "travel_style",
  2: "dietary",
  3: "accessibility",
  4: "active_hours",
};

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get("redirect") || "/trips/new";

  // Use localStorage hook for anonymous persistence
  const {
    preferences: localPrefs,
    isLoaded,
    savePreferences,
    completeOnboarding,
    getPreferencesForDatabase,
  } = useOnboardingPreferences();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Local state synced with localStorage
  const [preferences, setPreferences] = useState<OnboardingPreferences>({
    travelStyles: [],
    dietaryPreferences: [],
    accessibilityNeeds: [],
    activeHoursStart: 8,
    activeHoursEnd: 22,
  });

  const hasTrackedStep = useRef<Set<number>>(new Set());

  // Check auth status (but don't redirect - allow anonymous)
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);
      setUserId(user?.id || null);
    };
    checkAuth();
  }, []);

  // Restore progress from localStorage when loaded
  useEffect(() => {
    if (isLoaded) {
      setPreferences({
        travelStyles: localPrefs.travelStyles,
        dietaryPreferences: localPrefs.dietaryPreferences,
        accessibilityNeeds: localPrefs.accessibilityNeeds,
        activeHoursStart: localPrefs.activeHoursStart,
        activeHoursEnd: localPrefs.activeHoursEnd,
      });
      setStep(localPrefs.currentStep);
    }
  }, [isLoaded, localPrefs]);

  // Track step viewed
  useEffect(() => {
    if (!hasTrackedStep.current.has(step)) {
      hasTrackedStep.current.add(step);
      trackOnboardingStepViewed({ step, stepName: STEP_NAMES[step] });
    }
  }, [step]);

  const updatePreferences = (key: keyof OnboardingPreferences, value: OnboardingPreferences[typeof key]) => {
    setPreferences(prev => {
      const updated = { ...prev, [key]: value };
      // Also save to localStorage for persistence
      savePreferences({ [key]: value });
      return updated;
    });
  };

  const getSelectionsForStep = (stepNum: number): string[] => {
    switch (stepNum) {
      case 1:
        return preferences.travelStyles;
      case 2:
        return preferences.dietaryPreferences;
      case 3:
        return preferences.accessibilityNeeds;
      case 4:
        return [`${preferences.activeHoursStart}-${preferences.activeHoursEnd}`];
      default:
        return [];
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS) {
      // Track step completion
      trackOnboardingStepCompleted({
        step,
        stepName: STEP_NAMES[step],
        selections: getSelectionsForStep(step),
      });
      const nextStep = step + 1;
      setStep(nextStep);
      // Save progress to localStorage
      savePreferences({ currentStep: nextStep });
    }
  };

  const handleBack = () => {
    if (step > 1) {
      const prevStep = step - 1;
      setStep(prevStep);
      savePreferences({ currentStep: prevStep });
    }
  };

  const handleSkip = () => {
    // Track skip
    trackOnboardingSkipped({ atStep: step });
    handleFinish(true);
  };

  const handleFinish = async (skipped = false) => {
    setLoading(true);

    // Track last step completion if not skipped
    if (!skipped && step === TOTAL_STEPS) {
      trackOnboardingStepCompleted({
        step,
        stepName: STEP_NAMES[step],
        selections: getSelectionsForStep(step),
      });
    }

    // Track onboarding completion
    trackOnboardingCompleted({
      totalSteps: TOTAL_STEPS,
      skipped,
      preferences: {
        travelStyles: preferences.travelStyles,
        dietaryPreferences: preferences.dietaryPreferences,
        accessibilityNeeds: preferences.accessibilityNeeds,
      },
    });

    // Mark as completed in localStorage
    completeOnboarding();

    // Check if user is authenticated
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      // AUTHENTICATED: Save directly to database
      try {
        const dbPrefs = getPreferencesForDatabase();
        await supabase
          .from("users")
          .update({
            preferences: dbPrefs.preferences,
            notification_settings: dbPrefs.notification_settings,
            onboarding_completed: true,
          })
          .eq("id", user.id);

        // Redirect to intended destination
        router.push(redirectUrl);
      } catch (error) {
        console.error("Error saving preferences:", error);
        router.push(redirectUrl);
      }
    } else {
      // NOT AUTHENTICATED: Redirect to signup
      // LocalStorage preferences will be consumed during signup
      router.push(`/auth/signup?redirect=${encodeURIComponent(redirectUrl)}&from=onboarding`);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <TravelStyleStep
            selected={preferences.travelStyles}
            onChange={(styles) => updatePreferences("travelStyles", styles)}
          />
        );
      case 2:
        return (
          <DietaryStep
            selected={preferences.dietaryPreferences}
            onChange={(diets) => updatePreferences("dietaryPreferences", diets)}
          />
        );
      case 3:
        return (
          <AccessibilityStep
            selected={preferences.accessibilityNeeds}
            onChange={(needs) => updatePreferences("accessibilityNeeds", needs)}
          />
        );
      case 4:
        return (
          <ActiveHoursStep
            startHour={preferences.activeHoursStart}
            endHour={preferences.activeHoursEnd}
            onStartChange={(hour) => updatePreferences("activeHoursStart", hour)}
            onEndChange={(hour) => updatePreferences("activeHoursEnd", hour)}
          />
        );
      default:
        return null;
    }
  };

  // Show loading while checking localStorage
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex flex-col">
      {/* Header */}
      <header className="p-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/images/logo.png"
            alt="MonkeyTravel"
            width={40}
            height={40}
            className="rounded-lg"
          />
          <span className="font-bold text-xl text-[var(--primary)]">MonkeyTravel</span>
        </Link>
        <button
          onClick={handleSkip}
          className="text-slate-500 hover:text-slate-700 text-sm font-medium group relative"
        >
          Skip for now
          {/* Tooltip explaining importance */}
          <span className="absolute right-0 top-full mt-2 w-48 p-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
            Your preferences help us create personalized, tailored itineraries just for you!
          </span>
        </button>
      </header>

      {/* Personalization value banner */}
      <div className="px-4">
        <div className="max-w-md mx-auto bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-sm text-amber-800">
              <strong>Personalize your experience:</strong> These preferences help our AI create itineraries perfectly tailored to your travel style.
            </p>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="px-4 py-2">
        <div className="max-w-md mx-auto flex items-center gap-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-1.5 rounded-full transition-all duration-300 ${
                i + 1 <= step ? "bg-[var(--primary)]" : "bg-slate-200"
              }`}
            />
          ))}
        </div>
        <div className="text-center text-sm text-slate-500 mt-2">
          Step {step} of {TOTAL_STEPS}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {renderStep()}
        </div>
      </main>

      {/* Navigation */}
      <div className="p-4 border-t border-slate-200 bg-white">
        <div className="max-w-md mx-auto flex items-center gap-3">
          {step > 1 && (
            <button
              onClick={handleBack}
              className="px-6 py-3 text-slate-600 font-medium rounded-xl hover:bg-slate-100 transition-colors"
            >
              Back
            </button>
          )}
          <button
            onClick={step === TOTAL_STEPS ? () => handleFinish(false) : handleNext}
            disabled={loading}
            className="flex-1 bg-[var(--primary)] text-white py-3 rounded-xl font-semibold hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {isAuthenticated ? "Saving..." : "Continuing..."}
              </>
            ) : step === TOTAL_STEPS ? (
              isAuthenticated ? "Save & Continue" : "Create Account"
            ) : (
              "Continue"
            )}
          </button>
        </div>

        {/* Already have account? */}
        {!isAuthenticated && (
          <div className="max-w-md mx-auto text-center mt-4">
            <p className="text-sm text-slate-500">
              Already have an account?{" "}
              <Link href="/auth/login" className="text-[var(--primary)] font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
