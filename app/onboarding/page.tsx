"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import {
  trackOnboardingStepViewed,
  trackOnboardingStepCompleted,
  trackOnboardingCompleted,
  trackOnboardingSkipped,
} from "@/lib/analytics";

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
  const redirectUrl = searchParams.get("redirect") || "/trips";

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [preferences, setPreferences] = useState<OnboardingPreferences>({
    travelStyles: [],
    dietaryPreferences: [],
    accessibilityNeeds: [],
    activeHoursStart: 8,  // 8 AM
    activeHoursEnd: 22,   // 10 PM
  });

  const hasTrackedStep = useRef<Set<number>>(new Set());

  // Check if user is authenticated
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
      }
    };
    checkAuth();
  }, [router]);

  // Track step viewed
  useEffect(() => {
    if (!hasTrackedStep.current.has(step)) {
      hasTrackedStep.current.add(step);
      trackOnboardingStepViewed({ step, stepName: STEP_NAMES[step] });
    }
  }, [step]);

  const updatePreferences = (key: keyof OnboardingPreferences, value: OnboardingPreferences[typeof key]) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
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
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
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

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push("/auth/login");
        return;
      }

      // Update user profile with preferences
      await supabase
        .from("users")
        .update({
          preferences: {
            travelStyles: preferences.travelStyles,
            dietaryPreferences: preferences.dietaryPreferences,
            accessibilityNeeds: preferences.accessibilityNeeds,
          },
          notification_settings: {
            dealAlerts: true,
            tripReminders: true,
            pushNotifications: true,
            emailNotifications: true,
            socialNotifications: true,
            marketingNotifications: false,
            // Store as quiet hours (inverse of active hours)
            quietHoursStart: preferences.activeHoursEnd,
            quietHoursEnd: preferences.activeHoursStart,
          },
          onboarding_completed: true,
        })
        .eq("id", user.id);

      // Redirect to intended destination
      router.push(redirectUrl);
    } catch (error) {
      console.error("Error saving preferences:", error);
      // Still redirect on error - preferences can be set later
      router.push(redirectUrl);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex flex-col">
      {/* Header */}
      <header className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Image
            src="/images/logo.png"
            alt="MonkeyTravel"
            width={40}
            height={40}
            className="rounded-lg"
          />
          <span className="font-bold text-xl text-[var(--primary)]">MonkeyTravel</span>
        </div>
        <button
          onClick={handleSkip}
          className="text-slate-500 hover:text-slate-700 text-sm font-medium"
        >
          Skip for now
        </button>
      </header>

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
                Saving...
              </>
            ) : step === TOTAL_STEPS ? (
              "Get Started"
            ) : (
              "Continue"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
