"use client";

// Unit systems used around the world
export type UnitSystem = "imperial" | "metric";

// Temperature unit types
export type TemperatureUnit = "celsius" | "fahrenheit";

// Distance unit types
export type DistanceUnit = "metric" | "imperial";

// Currency codes (ISO 4217)
export type CurrencyCode = string;

// User locale preferences - stored in localStorage
export interface LocalePreferences {
  locale: string; // e.g., "en-US", "es-ES"
  unitSystem: UnitSystem;
  temperatureUnit: TemperatureUnit;
  distanceUnit: DistanceUnit;
  preferredCurrency: CurrencyCode;
  detectedAt: number; // Timestamp of detection
  isManualOverride: boolean; // True if user manually set preferences
}

// Exchange rates response from Frankfurter API
export interface ExchangeRates {
  base: CurrencyCode;
  date: string;
  rates: Record<CurrencyCode, number>;
  fetchedAt: number; // Cache timestamp
}

// Formatted currency display
export interface FormattedCurrency {
  value: number;
  formatted: string;
  currency: CurrencyCode;
  originalValue: number;
  originalCurrency: CurrencyCode;
}

// Locale context value
export interface LocaleContextValue {
  // Current preferences
  preferences: LocalePreferences;

  // Exchange rates data
  exchangeRates: ExchangeRates | null;
  isLoadingRates: boolean;

  // Temperature conversion
  convertTemperature: (celsius: number, showUnit?: boolean) => string;

  // Distance conversion
  convertDistance: (meters: number, showUnit?: boolean) => string;

  // Currency conversion
  convertCurrency: (amount: number, fromCurrency: CurrencyCode) => FormattedCurrency;
  formatCurrency: (amount: number, currency: CurrencyCode) => string;

  // Update preferences
  setPreferredCurrency: (currency: CurrencyCode) => void;
  setTemperatureUnit: (unit: TemperatureUnit) => void;
  setDistanceUnit: (unit: DistanceUnit) => void;
  resetToAutoDetect: () => void;
}

// Countries using imperial system (US, Liberia, Myanmar)
export const IMPERIAL_COUNTRIES = ["US", "LR", "MM"];

// Countries that use Fahrenheit (US and some Caribbean nations)
export const FAHRENHEIT_COUNTRIES = [
  "US", // United States
  "BS", // Bahamas
  "BZ", // Belize
  "KY", // Cayman Islands
  "PW", // Palau
  "FM", // Micronesia
  "MH", // Marshall Islands
];

// Common currency symbols for display
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  AUD: "A$",
  CAD: "C$",
  CHF: "CHF",
  MXN: "MX$",
  BRL: "R$",
  INR: "₹",
  KRW: "₩",
  THB: "฿",
  VND: "₫",
  SGD: "S$",
  HKD: "HK$",
  NZD: "NZ$",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  PLN: "zł",
  CZK: "Kč",
  HUF: "Ft",
  TRY: "₺",
  ZAR: "R",
  AED: "د.إ",
  SAR: "ر.س",
  ILS: "₪",
  PHP: "₱",
  IDR: "Rp",
  MYR: "RM",
};

// Map locale to likely currency
export const LOCALE_CURRENCY_MAP: Record<string, CurrencyCode> = {
  "en-US": "USD",
  "en-GB": "GBP",
  "en-AU": "AUD",
  "en-CA": "CAD",
  "en-NZ": "NZD",
  "en-IE": "EUR",
  "de-DE": "EUR",
  "de-AT": "EUR",
  "fr-FR": "EUR",
  "fr-CA": "CAD",
  "es-ES": "EUR",
  "es-MX": "MXN",
  "es-AR": "ARS",
  "it-IT": "EUR",
  "pt-BR": "BRL",
  "pt-PT": "EUR",
  "nl-NL": "EUR",
  "ja-JP": "JPY",
  "zh-CN": "CNY",
  "zh-TW": "TWD",
  "ko-KR": "KRW",
  "ru-RU": "RUB",
  "pl-PL": "PLN",
  "sv-SE": "SEK",
  "nb-NO": "NOK",
  "da-DK": "DKK",
  "fi-FI": "EUR",
  "th-TH": "THB",
  "vi-VN": "VND",
  "id-ID": "IDR",
  "ms-MY": "MYR",
  "tr-TR": "TRY",
  "he-IL": "ILS",
  "ar-AE": "AED",
  "ar-SA": "SAR",
  "hi-IN": "INR",
  "cs-CZ": "CZK",
  "hu-HU": "HUF",
  "el-GR": "EUR",
  "ro-RO": "RON",
  "bg-BG": "BGN",
  "uk-UA": "UAH",
};
