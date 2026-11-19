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
import { FAHRENHEIT_COUNTRIES, IMPERIAL_COUNTRIES } from "./types";
import { currencyForCountry, currencyForLocale, followsCountry } from "./currency-guess";
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

    // The currency the locale points to: its region's, or its language's (lib/locale/currency-guess.ts).
    const preferredCurrency = currencyForLocale(browserLocale);

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

// The country a visitor is in, as the server sees it (app/api/locale/country), kept a day.
const COUNTRY_STORAGE_KEY = "monkeytravel-visitor-country";
const COUNTRY_KEPT_MS = 24 * 60 * 60 * 1000;

/** The country kept from an earlier look while it is fresh (null: none found), or undefined when there is none to use. */
function keptCountry(): string | null | undefined {
  try {
    const kept = JSON.parse(localStorage.getItem(COUNTRY_STORAGE_KEY) ?? "null") as { country?: unknown; at?: unknown } | null;
    if (!kept || typeof kept.at !== "number" || Date.now() - kept.at >= COUNTRY_KEPT_MS) return undefined;
    return typeof kept.country === "string" ? kept.country : null;
  } catch {
    return undefined;
  }
}

/** Asks the server which country the visitor is in, and keeps the answer a day. Null when it can't tell. */
async function lookUpCountry(): Promise<string | null> {
  let country: string | null = null;
  try {
    const response = await fetch("/api/locale/country", { cache: "no-store" });
    const answer = response.ok ? ((await response.json()) as { country?: unknown }).country : null;
    country = typeof answer === "string" && /^[A-Z]{2}$/.test(answer) ? answer : null;
  } catch {
    return null;
  }
  try {
    localStorage.setItem(COUNTRY_STORAGE_KEY, JSON.stringify({ country, at: Date.now() }));
  } catch {
    // localStorage might not be available
  }
  return country;
}

/**
 * Detected preferences with the currency of the country the visitor is in, where the browser's language
 * says little about it (lib/locale/currency-guess.ts followsCountry) and the rates convert that currency.
 */
function withCountryCurrency(prefs: LocalePreferences, country: string | null): LocalePreferences {
  const currency = followsCountry(prefs.locale) ? currencyForCountry(country) : null;
  return currency && currency !== prefs.preferredCurrency ? { ...prefs, preferredCurrency: currency } : prefs;
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
    let alive = true;
    // First, check for saved preferences
    const saved = loadSavedPreferences();
    if (saved?.isManualOverride) {
      // User has manually set preferences, use those
      setPreferences(saved);
    } else {
      // Auto-detect from browser, with the country the visitor is in where the language says little of it.
      const detected = detectLocalePreferences();
      const kept = keptCountry();
      const shown = kept === undefined ? detected : withCountryCurrency(detected, kept);
      setPreferences(shown);
      savePreferences(shown);
      if (kept === undefined && followsCountry(detected.locale)) {
        void lookUpCountry().then((country) => {
          const located = withCountryCurrency(detected, country);
          // A currency chosen meanwhile stays.
          if (!alive || located === detected || loadSavedPreferences()?.isManualOverride) return;
          setPreferences(located);
          savePreferences(located);
        });
      }
    }
    setIsInitialized(true);
    return () => {
      alive = false;
    };
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
