/**
 * Currency conversion utilities using Frankfurter API
 * API: https://frankfurter.dev/ - Free, no API key required
 */

import type { CurrencyCode, ExchangeRates, FormattedCurrency } from "./types";
import { CURRENCY_SYMBOLS } from "./types";

// Frankfurter API endpoint
const FRANKFURTER_API = "https://api.frankfurter.dev/v1";

// Cache key for localStorage
const RATES_CACHE_KEY = "monkeytravel-exchange-rates";

// Cache duration: 1 hour (rates update daily around 16:00 CET)
const CACHE_DURATION_MS = 60 * 60 * 1000;

/**
 * Fetch latest exchange rates from Frankfurter API
 */
export async function fetchExchangeRates(baseCurrency: CurrencyCode = "EUR"): Promise<ExchangeRates> {
  try {
    const response = await fetch(`${FRANKFURTER_API}/latest?base=${baseCurrency}`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    const rates: ExchangeRates = {
      base: data.base,
      date: data.date,
      rates: data.rates,
      fetchedAt: Date.now(),
    };

    // Cache the rates
    try {
      localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(rates));
    } catch {
      // localStorage might not be available
    }

    return rates;
  } catch (error) {
    console.error("Failed to fetch exchange rates:", error);
    throw error;
  }
}

/**
 * Get cached exchange rates if still valid
 */
export function getCachedRates(): ExchangeRates | null {
  try {
    const cached = localStorage.getItem(RATES_CACHE_KEY);
    if (!cached) return null;

    const rates: ExchangeRates = JSON.parse(cached);

    // Check if cache is still valid
    if (Date.now() - rates.fetchedAt > CACHE_DURATION_MS) {
      return null;
    }

    return rates;
  } catch {
    return null;
  }
}

/**
 * Get exchange rates (from cache or fetch new)
 */
export async function getExchangeRates(baseCurrency: CurrencyCode = "EUR"): Promise<ExchangeRates> {
  const cached = getCachedRates();

  // If we have valid cached rates with the same base, use them
  if (cached && cached.base === baseCurrency) {
    return cached;
  }

  return fetchExchangeRates(baseCurrency);
}

/**
 * Convert currency amount using exchange rates
 */
export function convertCurrency(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates: ExchangeRates
): number {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  // If the base currency matches our from currency
  if (rates.base === fromCurrency) {
    const rate = rates.rates[toCurrency];
    if (rate) {
      return amount * rate;
    }
  }

  // If the base currency matches our to currency
  if (rates.base === toCurrency) {
    const rate = rates.rates[fromCurrency];
    if (rate) {
      return amount / rate;
    }
  }

  // Cross-rate calculation through base currency
  const fromRate = rates.rates[fromCurrency];
  const toRate = rates.rates[toCurrency];

  if (fromRate && toRate) {
    // Convert: fromCurrency -> base -> toCurrency
    const amountInBase = amount / fromRate;
    return amountInBase * toRate;
  }

  // Fallback: return original amount if conversion not possible
  console.warn(`Cannot convert ${fromCurrency} to ${toCurrency}`);
  return amount;
}

/**
 * Format currency for display using Intl.NumberFormat
 */
export function formatCurrencyValue(
  amount: number,
  currency: CurrencyCode,
  locale?: string
): string {
  try {
    const formatter = new Intl.NumberFormat(locale || "en-US", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return formatter.format(Math.round(amount));
  } catch {
    // Fallback if currency code is not supported
    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    return `${symbol}${Math.round(amount).toLocaleString()}`;
  }
}

/**
 * Get currency symbol for a currency code
 */
export function getCurrencySymbol(currency: CurrencyCode): string {
  return CURRENCY_SYMBOLS[currency] || currency;
}

/**
 * Convert and format currency with original reference
 */
export function convertAndFormatCurrency(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates: ExchangeRates | null,
  locale?: string
): FormattedCurrency {
  // If no rates available or same currency, return original
  if (!rates || fromCurrency === toCurrency) {
    return {
      value: amount,
      formatted: formatCurrencyValue(amount, fromCurrency, locale),
      currency: fromCurrency,
      originalValue: amount,
      originalCurrency: fromCurrency,
    };
  }

  const convertedValue = convertCurrency(amount, fromCurrency, toCurrency, rates);

  return {
    value: convertedValue,
    formatted: formatCurrencyValue(convertedValue, toCurrency, locale),
    currency: toCurrency,
    originalValue: amount,
    originalCurrency: fromCurrency,
  };
}

/**
 * List of supported currencies from Frankfurter API
 * (Based on European Central Bank reference rates)
 */
export const SUPPORTED_CURRENCIES: CurrencyCode[] = [
  "AUD", // Australian Dollar
  "BGN", // Bulgarian Lev
  "BRL", // Brazilian Real
  "CAD", // Canadian Dollar
  "CHF", // Swiss Franc
  "CNY", // Chinese Yuan
  "CZK", // Czech Koruna
  "DKK", // Danish Krone
  "EUR", // Euro
  "GBP", // British Pound
  "HKD", // Hong Kong Dollar
  "HUF", // Hungarian Forint
  "IDR", // Indonesian Rupiah
  "ILS", // Israeli Shekel
  "INR", // Indian Rupee
  "ISK", // Icelandic Krona
  "JPY", // Japanese Yen
  "KRW", // South Korean Won
  "MXN", // Mexican Peso
  "MYR", // Malaysian Ringgit
  "NOK", // Norwegian Krone
  "NZD", // New Zealand Dollar
  "PHP", // Philippine Peso
  "PLN", // Polish Zloty
  "RON", // Romanian Leu
  "SEK", // Swedish Krona
  "SGD", // Singapore Dollar
  "THB", // Thai Baht
  "TRY", // Turkish Lira
  "USD", // US Dollar
  "ZAR", // South African Rand
];

/**
 * Check if a currency is supported for conversion
 */
export function isCurrencySupported(currency: CurrencyCode): boolean {
  return SUPPORTED_CURRENCIES.includes(currency);
}

/**
 * Parse a currency string like "€50" or "50 EUR" to extract amount and currency
 */
export function parseCurrencyString(str: string): { amount: number; currency: CurrencyCode } | null {
  // Remove whitespace and common separators
  const cleaned = str.replace(/\s/g, "");

  // Try to match common patterns
  const patterns = [
    // Symbol prefix: $100, €50, £75
    /^([€$£¥₹])([\d,.]+)$/,
    // Code suffix: 100 USD, 50 EUR
    /^([\d,.]+)\s*([A-Z]{3})$/,
    // Code prefix: USD 100, EUR 50
    /^([A-Z]{3})\s*([\d,.]+)$/,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      // Determine which group is amount vs currency
      const [, g1, g2] = match;
      const isG1Currency = isNaN(Number(g1.replace(/,/g, "")));

      const currencyPart = isG1Currency ? g1 : g2;
      const amountPart = isG1Currency ? g2 : g1;

      // Map symbol to currency code
      const currencyMap: Record<string, CurrencyCode> = {
        "$": "USD",
        "€": "EUR",
        "£": "GBP",
        "¥": "JPY",
        "₹": "INR",
      };

      const currency = currencyMap[currencyPart] || currencyPart;
      const amount = parseFloat(amountPart.replace(/,/g, ""));

      if (!isNaN(amount)) {
        return { amount, currency };
      }
    }
  }

  return null;
}
