"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type {
  LocalePreferences,
  LocaleContextValue,
  ExchangeRates,
  TemperatureUnit,
  DistanceUnit,
  CurrencyCode,
  FormattedCurrency,
} from "./types";
import {
  FAHRENHEIT_COUNTRIES,
  IMPERIAL_COUNTRIES,
  LOCALE_CURRENCY_MAP,
} from "./types";
import { formatTemperature, formatDistance } from "./conversions";
import {
  getExchangeRates,
  getCachedRates,
  convertAndFormatCurrency,
  formatCurrencyValue,
} from "./currency";

// Storage key for preferences
const PREFS_STORAGE_KEY = "monkeytravel-locale-prefs";

// Default preferences (metric system, EUR)
const DEFAULT_PREFERENCES: LocalePreferences = {
  locale: "en-US",
  unitSystem: "metric",
  temperatureUnit: "celsius",
  distanceUnit: "metric",
  preferredCurrency: "EUR",
  detectedAt: Date.now(),
  isManualOverride: false,
};

/**
 * Detect user's locale and preferences from browser
 */
function detectLocalePreferences(): LocalePreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES;
  }

  try {
    // Get browser locale
    const browserLocale =
      navigator.languages?.[0] || navigator.language || "en-US";

    // Extract country code from locale (e.g., "en-US" -> "US")
    const parts = browserLocale.split("-");
    const countryCode = parts.length > 1 ? parts[1].toUpperCase() : null;

    // Determine unit system based on country
    const usesImperial = countryCode
      ? IMPERIAL_COUNTRIES.includes(countryCode)
      : false;

    // Determine temperature unit based on country
    const usesFahrenheit = countryCode
      ? FAHRENHEIT_COUNTRIES.includes(countryCode)
      : false;

    // Determine preferred currency from locale
    const preferredCurrency =
      LOCALE_CURRENCY_MAP[browserLocale] ||
      LOCALE_CURRENCY_MAP[`en-${countryCode}`] ||
      "USD";

    return {
      locale: browserLocale,
      unitSystem: usesImperial ? "imperial" : "metric",
      temperatureUnit: usesFahrenheit ? "fahrenheit" : "celsius",
      distanceUnit: usesImperial ? "imperial" : "metric",
      preferredCurrency,
      detectedAt: Date.now(),
      isManualOverride: false,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Load saved preferences from localStorage
 */
function loadSavedPreferences(): LocalePreferences | null {
  if (typeof window === "undefined") return null;

  try {
    const saved = localStorage.getItem(PREFS_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // localStorage might not be available
  }
  return null;
}

/**
 * Save preferences to localStorage
 */
function savePreferences(prefs: LocalePreferences): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage might not be available
  }
}

// Create context with default values
const LocaleContext = createContext<LocaleContextValue | null>(null);

// Provider component props
interface LocaleProviderProps {
  children: React.ReactNode;
}

/**
 * LocaleProvider - Provides localization context to the app
 */
export function LocaleProvider({ children }: LocaleProviderProps) {
  // Initialize with default preferences (SSR-safe)
  const [preferences, setPreferences] =
    useState<LocalePreferences>(DEFAULT_PREFERENCES);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRates | null>(
    null
  );
  const [isLoadingRates, setIsLoadingRates] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize preferences on mount (client-side only)
  useEffect(() => {
    // First, check for saved preferences
    const saved = loadSavedPreferences();
    if (saved?.isManualOverride) {
      // User has manually set preferences, use those
      setPreferences(saved);
    } else {
      // Auto-detect from browser
      const detected = detectLocalePreferences();
      setPreferences(detected);
      savePreferences(detected);
    }
    setIsInitialized(true);
  }, []);

  // Load exchange rates on mount
  useEffect(() => {
    const loadRates = async () => {
      // First try cached rates
      const cached = getCachedRates();
      if (cached) {
        setExchangeRates(cached);
        return;
      }

      // Fetch new rates
      setIsLoadingRates(true);
      try {
        const rates = await getExchangeRates("EUR");
        setExchangeRates(rates);
      } catch (error) {
        console.error("Failed to load exchange rates:", error);
      } finally {
        setIsLoadingRates(false);
      }
    };

    if (isInitialized) {
      loadRates();
    }
  }, [isInitialized]);

  // Convert temperature from Celsius
  const convertTemperature = useCallback(
    (celsius: number, showUnit: boolean = true): string => {
      return formatTemperature(celsius, preferences.temperatureUnit, showUnit);
    },
    [preferences.temperatureUnit]
  );

  // Convert distance from meters
  const convertDistance = useCallback(
    (meters: number, showUnit: boolean = true): string => {
      return formatDistance(meters, preferences.distanceUnit, showUnit);
    },
    [preferences.distanceUnit]
  );

  // Convert currency
  const convertCurrency = useCallback(
    (amount: number, fromCurrency: CurrencyCode): FormattedCurrency => {
      return convertAndFormatCurrency(
        amount,
        fromCurrency,
        preferences.preferredCurrency,
        exchangeRates,
        preferences.locale
      );
    },
    [preferences.preferredCurrency, preferences.locale, exchangeRates]
  );

  // Format currency without conversion
  const formatCurrency = useCallback(
    (amount: number, currency: CurrencyCode): string => {
      return formatCurrencyValue(amount, currency, preferences.locale);
    },
    [preferences.locale]
  );

  // Set preferred currency
  const setPreferredCurrency = useCallback((currency: CurrencyCode) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        preferredCurrency: currency,
        isManualOverride: true,
      };
      savePreferences(updated);
      return updated;
    });
  }, []);

  // Set temperature unit
  const setTemperatureUnit = useCallback((unit: TemperatureUnit) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        temperatureUnit: unit,
        isManualOverride: true,
      };
      savePreferences(updated);
      return updated;
    });
  }, []);

  // Set distance unit
  const setDistanceUnit = useCallback((unit: DistanceUnit) => {
    setPreferences((prev) => {
      const updated = {
        ...prev,
        distanceUnit: unit,
        unitSystem: unit,
        isManualOverride: true,
      };
      savePreferences(updated);
      return updated;
    });
  }, []);

  // Reset to auto-detect
  const resetToAutoDetect = useCallback(() => {
    const detected = detectLocalePreferences();
    setPreferences(detected);
    savePreferences(detected);
  }, []);

  // Memoize context value
  const contextValue = useMemo<LocaleContextValue>(
    () => ({
      preferences,
      exchangeRates,
      isLoadingRates,
      convertTemperature,
      convertDistance,
      convertCurrency,
      formatCurrency,
      setPreferredCurrency,
      setTemperatureUnit,
      setDistanceUnit,
      resetToAutoDetect,
    }),
    [
      preferences,
      exchangeRates,
      isLoadingRates,
      convertTemperature,
      convertDistance,
      convertCurrency,
      formatCurrency,
      setPreferredCurrency,
      setTemperatureUnit,
      setDistanceUnit,
      resetToAutoDetect,
    ]
  );

  return (
    <LocaleContext.Provider value={contextValue}>
      {children}
    </LocaleContext.Provider>
  );
}

/**
 * Hook to use locale context
 */
export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);

  if (!context) {
    // Return default values if used outside provider (for SSR safety)
    return {
      preferences: DEFAULT_PREFERENCES,
      exchangeRates: null,
      isLoadingRates: false,
      convertTemperature: (c, show = true) => (show ? `${c}°C` : `${c}`),
      convertDistance: (m, show = true) =>
        show ? (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`) : `${m}`,
      convertCurrency: (amount, currency) => ({
        value: amount,
        formatted: `${currency} ${amount}`,
        currency,
        originalValue: amount,
        originalCurrency: currency,
      }),
      formatCurrency: (amount, currency) => `${currency} ${amount}`,
      setPreferredCurrency: () => {},
      setTemperatureUnit: () => {},
      setDistanceUnit: () => {},
      resetToAutoDetect: () => {},
    };
  }

  return context;
}

/**
 * Hook for just temperature conversion (lighter weight)
 */
export function useTemperature() {
  const { convertTemperature, preferences } = useLocale();
  return {
    convert: convertTemperature,
    unit: preferences.temperatureUnit,
  };
}

/**
 * Hook for just distance conversion (lighter weight)
 */
export function useDistance() {
  const { convertDistance, preferences } = useLocale();
  return {
    convert: convertDistance,
    unit: preferences.distanceUnit,
  };
}

/**
 * Hook for just currency conversion (lighter weight)
 */
export function useCurrency() {
  const { convertCurrency, formatCurrency, preferences, exchangeRates, isLoadingRates } =
    useLocale();
  return {
    convert: convertCurrency,
    format: formatCurrency,
    preferredCurrency: preferences.preferredCurrency,
    exchangeRates,
    isLoadingRates,
  };
}
