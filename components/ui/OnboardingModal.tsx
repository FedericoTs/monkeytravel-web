"use client";

import { useState, useEffect } from "react";
import { X, ChevronRight, ChevronLeft, Sparkles, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useOnboardingPreferences,
  hasLocalOnboardingPreferences,
} from "@/hooks/useOnboardingPreferences";

// Step components
import TravelStyleStep from "@/components/onboarding/TravelStyleStep";
import DietaryStep from "@/components/onboarding/DietaryStep";
import AccessibilityStep from "@/components/onboarding/AccessibilityStep";
import ActiveHoursStep from "@/components/onboarding/ActiveHoursStep";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void; // Called when onboarding is done, triggers signup
  destination?: string;
}

interface OnboardingPreferences {
  travelStyles: string[];
  dietaryPreferences: string[];
  accessibilityNeeds: string[];
  activeHoursStart: number;
  activeHoursEnd: number;
}

const TOTAL_STEPS = 4;

// Step title keys mapped to existing onboarding translation namespace
const STEP_KEYS: Record<number, { titleKey: string; subtitleKey: string }> = {
  1: { titleKey: "travelStyle.title", subtitleKey: "travelStyle.subtitle" },
  2: { titleKey: "dietary.title", subtitleKey: "dietary.subtitle" },
  3: { titleKey: "accessibility.title", subtitleKey: "accessibility.subtitle" },
  4: { titleKey: "activeHours.title", subtitleKey: "activeHours.subtitle" },
};

/**
 * Inline onboarding modal shown before signup.
 * Collects user preferences and saves to localStorage.
 * After completion, triggers the signup flow.
 */
export default function OnboardingModal({
  isOpen,
  onClose,
  onComplete,
  destination,
}: OnboardingModalProps) {
  const tOnboarding = useTranslations("common.onboarding");
  const tModal = useTranslations("common.onboarding.modal");

  // Use localStorage hook for persistence
  const {
    preferences: localPrefs,
    isLoaded,
    savePreferences,
    completeOnboarding,
  } = useOnboardingPreferences();

  const [step, setStep] = useState(1);
  const [preferences, setPreferences] = useState<OnboardingPreferences>({
    travelStyles: [],
    dietaryPreferences: [],
    accessibilityNeeds: [],
    activeHoursStart: 8,
    activeHoursEnd: 22,
  });

  // Restore progress from localStorage when loaded
  useEffect(() => {
    if (isLoaded && isOpen) {
      setPreferences({
        travelStyles: localPrefs.travelStyles,
        dietaryPreferences: localPrefs.dietaryPreferences,
        accessibilityNeeds: localPrefs.accessibilityNeeds,
        activeHoursStart: localPrefs.activeHoursStart,
        activeHoursEnd: localPrefs.activeHoursEnd,
      });
      // Start from saved step or step 1
      setStep(localPrefs.currentStep || 1);
    }
  }, [isLoaded, isOpen, localPrefs]);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen && !isLoaded) {
      setStep(1);
    }
  }, [isOpen, isLoaded]);

  if (!isOpen) return null;

  const updatePreferences = (
    key: keyof OnboardingPreferences,
    value: OnboardingPreferences[typeof key]
  ) => {
    setPreferences((prev) => {
      const updated = { ...prev, [key]: value };
      // Also save to localStorage for persistence
      savePreferences({ [key]: value });
      return updated;
    });
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS) {
      const nextStep = step + 1;
      setStep(nextStep);
      savePreferences({ currentStep: nextStep });
    } else {
      // Complete onboarding
      completeOnboarding();
      onComplete();
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
    // Skip to completion without filling preferences
    completeOnboarding();
    onComplete();
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return preferences.travelStyles.length > 0;
      case 2:
      case 3:
        return true; // Optional steps
      case 4:
        return true;
      default:
        return false;
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
            onChange={(prefs) => updatePreferences("dietaryPreferences", prefs)}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors z-10"
          aria-label={tModal("closeLabel")}
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        {/* Header */}
        <div className="bg-gradient-to-br from-[var(--primary)] to-[#0A3A5C] px-6 pt-6 pb-4 text-white">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{tModal("personalizeTrip")}</h2>
              {destination && (
                <p className="text-white/70 text-sm">{tModal("toDestination", { destination })}</p>
              )}
            </div>
          </div>

          {/* Progress indicator */}
          <div className="flex items-center gap-2 mt-4">
            {Array.from({ length: TOTAL_STEPS }).map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  idx + 1 <= step ? "bg-white" : "bg-white/30"
                }`}
              />
            ))}
          </div>
          <p className="text-white/70 text-xs mt-2">
            {tModal("stepOf", { step, total: TOTAL_STEPS })}
          </p>
        </div>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto p-6">{renderStep()}</div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 bg-gray-50">
          <div className="flex items-center justify-between">
            {/* Back button or skip */}
            {step > 1 ? (
              <button
                onClick={handleBack}
                className="flex items-center gap-1 px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                {tModal("back")}
              </button>
            ) : (
              <button
                onClick={handleSkip}
                className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm transition-colors"
              >
                {tModal("skipForNow")}
              </button>
            )}

            {/* Next/Complete button */}
            <button
              onClick={handleNext}
              disabled={step === 1 && !canProceed()}
              className="flex items-center gap-2 px-6 py-2.5 bg-[var(--primary)] text-white rounded-xl font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {step === TOTAL_STEPS ? (
                <>
                  <Check className="w-4 h-4" />
                  {tModal("createAccount")}
                </>
              ) : (
                <>
                  {tModal("next")}
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* Value proposition */}
          <p className="text-center text-xs text-slate-500 mt-3">
            {tModal("valueProposition")}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to check if onboarding is needed before generation
 */
export function useNeedsOnboarding(): boolean {
  // Check if user has already completed onboarding (in localStorage)
  return !hasLocalOnboardingPreferences();
}
