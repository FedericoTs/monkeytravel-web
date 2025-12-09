"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Onboarding preferences stored locally before signup.
 * Transferred to database on account creation.
 */
export interface LocalOnboardingPreferences {
  travelStyles: string[];
  dietaryPreferences: string[];
  accessibilityNeeds: string[];
  activeHoursStart: number;
  activeHoursEnd: number;
  currentStep: number;
  completedAt: string | null; // ISO timestamp when all steps completed
  savedAt: string; // For expiry check
}

const STORAGE_KEY = "monkeytravel-onboarding-preferences";
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const DEFAULT_PREFERENCES: LocalOnboardingPreferences = {
  travelStyles: [],
  dietaryPreferences: [],
  accessibilityNeeds: [],
  activeHoursStart: 8, // 8 AM
  activeHoursEnd: 22, // 10 PM
  currentStep: 1,
  completedAt: null,
  savedAt: new Date().toISOString(),
};

/**
 * Hook for managing onboarding preferences in localStorage.
 * Used for anonymous users before they create an account.
 */
export function useOnboardingPreferences() {
  const [preferences, setPreferences] = useState<LocalOnboardingPreferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preferences from localStorage on mount
  useEffect(() => {
    const loadPreferences = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed: LocalOnboardingPreferences = JSON.parse(stored);

          // Check expiry
          const savedAt = new Date(parsed.savedAt).getTime();
          const now = Date.now();

          if (now - savedAt > EXPIRY_MS) {
            // Expired - clear and use defaults
            localStorage.removeItem(STORAGE_KEY);
            setPreferences(DEFAULT_PREFERENCES);
          } else {
            setPreferences(parsed);
          }
        }
      } catch {
        // Invalid data - use defaults
        localStorage.removeItem(STORAGE_KEY);
      }
      setIsLoaded(true);
    };

    loadPreferences();
  }, []);

  // Save preferences to localStorage
  const savePreferences = useCallback((updates: Partial<LocalOnboardingPreferences>) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        ...updates,
        savedAt: new Date().toISOString(),
      };

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Storage full or blocked - continue without persistence
        console.warn("Failed to save onboarding preferences to localStorage");
      }

      return updated;
    });
  }, []);

  // Mark onboarding as completed
  const completeOnboarding = useCallback(() => {
    savePreferences({
      completedAt: new Date().toISOString(),
    });
  }, [savePreferences]);

  // Clear all preferences (after account creation)
  const clearPreferences = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore errors
    }
    setPreferences(DEFAULT_PREFERENCES);
  }, []);

  // Check if onboarding is completed
  const isCompleted = preferences.completedAt !== null;

  // Get preferences for database storage (without metadata)
  const getPreferencesForDatabase = useCallback(() => {
    return {
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
    };
  }, [preferences]);

  return {
    preferences,
    isLoaded,
    isCompleted,
    savePreferences,
    completeOnboarding,
    clearPreferences,
    getPreferencesForDatabase,
  };
}

/**
 * Static utility to check if localStorage has completed onboarding.
 * Used in signup flow to determine if preferences should be transferred.
 */
export function hasLocalOnboardingPreferences(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return false;

    const parsed: LocalOnboardingPreferences = JSON.parse(stored);

    // Check expiry
    const savedAt = new Date(parsed.savedAt).getTime();
    if (Date.now() - savedAt > EXPIRY_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }

    return parsed.completedAt !== null;
  } catch {
    return false;
  }
}

/**
 * Static utility to get localStorage preferences for signup flow.
 * Returns null if no valid preferences exist.
 */
export function getLocalOnboardingPreferences(): LocalOnboardingPreferences | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed: LocalOnboardingPreferences = JSON.parse(stored);

    // Check expiry
    const savedAt = new Date(parsed.savedAt).getTime();
    if (Date.now() - savedAt > EXPIRY_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Static utility to clear localStorage preferences.
 * Called after successful account creation.
 */
export function clearLocalOnboardingPreferences(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}
