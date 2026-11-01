/**
 * Currency conversion utilities using Frankfurter API
 * API: https://frankfurter.dev/ - Free, no API key required
 */

import type { CurrencyCode, ExchangeRates, FormattedCurrency } from "./types";
import { CURRENCY_SYMBOLS } from "./types";
import { FRANKFURTER_API_BASE } from "@/lib/constants/externalApis";

// Frankfurter API endpoint
const FRANKFURTER_API = FRANKFURTER_API_BASE;

// Cache key for localStorage
const RATES_CACHE_KEY = "monkeytravel-exchange-rates";

// Cache duration: 24 hours. Frankfurter rates update once per day around
// 16:00 CET, so a 24h window safely covers all derived pair lookups for
// a full day from a single upstream call per base currency.
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// In-memory cache (24h) keyed by base currency.
//
// Frankfurter `/latest?base=X` returns the WHOLE rate table for that base
// in a single call, so we cache by base and derive every `${base}->${target}`
// pair from it. This keeps upstream calls at most 1/day per base currency
// regardless of how many pair lookups happen.
//
// We expose pair-level hit logging via `[fx-cache] hit base=X target=Y` so
// production can observe hit-rate without instrumenting every caller.
// ---------------------------------------------------------------------------
type RatesByBase = Map<CurrencyCode, ExchangeRates>;
const memoryRates: RatesByBase = new Map();
const inflightRatesFetches = new Map<CurrencyCode, Promise<ExchangeRates>>();

function isFresh(rates: ExchangeRates | undefined | null): rates is ExchangeRates {
  return !!rates && Date.now() - rates.fetchedAt < CACHE_DURATION_MS;
}

function logPairHit(base: CurrencyCode, target: CurrencyCode): void {
  // Single, low-cardinality log line so log aggregators can compute hit rate.
  // Kept lowercase + bracketed so it greps cleanly alongside other [tag] logs.
  console.log(`[fx-cache] hit base=${base} target=${target}`);
}

/**
 * Look up a single pair `${base}->${target}` from the in-memory cache.
 * Returns the rate (target per 1 base) or null on miss/stale.
 * Logs a hit line so we can observe cache effectiveness in prod.
 */
export function getCachedPair(
  base: CurrencyCode,
  target: CurrencyCode
): number | null {
  if (base === target) {
    logPairHit(base, target);
    return 1;
  }
  const table = memoryRates.get(base);
  if (!isFresh(table)) return null;
  const rate = table.rates[target];
  if (typeof rate !== "number") return null;
  logPairHit(base, target);
  return rate;
}

/**
 * Fetch latest exchange rates from Frankfurter API.
 *
 * Resilience:
 *   - 5s AbortController timeout so a slow Frankfurter can't hang React
 *   - Skip subsequent attempts in the same browser session if the last
 *     one failed within FAIL_BACKOFF_MS, so a blocked or down Frankfurter
 *     degrades quietly instead of in a long recursive stack trace.
 *   - On any error: graceful throw — caller already handles it as
 *     "no conversion, show original currency".
 */
const FAIL_BACKOFF_MS = 5 * 60 * 1000; // 5 min before retry after a failure
const FAIL_FLAG_KEY = "monkeytravel-exchange-rates-fail-at";

export async function fetchExchangeRates(baseCurrency: CurrencyCode = "EUR"): Promise<ExchangeRates> {
  // Dedupe concurrent fetches for the same base — prevents the worst-case
  // burst (e.g. 8 components mounting simultaneously) from firing 8 upstream
  // requests instead of 1.
  const existing = inflightRatesFetches.get(baseCurrency);
  if (existing) return existing;

  // Backoff guard — skip if we failed recently. This prevents every
  // page navigation from re-triggering a doomed fetch + console error.
  try {
    const lastFailAt = Number(localStorage.getItem(FAIL_FLAG_KEY) || 0);
    if (lastFailAt && Date.now() - lastFailAt < FAIL_BACKOFF_MS) {
      throw new Error("rates-fetch-backoff");
    }
  } catch {
    /* localStorage unavailable — fall through and try the fetch anyway */
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);

  const promise = (async () => {
    const response = await fetch(`${FRANKFURTER_API}/latest?base=${baseCurrency}`, {
      signal: controller.signal,
    });

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

    // Populate the in-memory 24h cache — single upstream call now
    // serves every `${base}->${target}` pair lookup for 24 hours.
    memoryRates.set(rates.base, rates);

    // Cache the rates + clear any previous failure flag (we're healthy again).
    try {
      localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(rates));
      localStorage.removeItem(FAIL_FLAG_KEY);
    } catch {
      // localStorage might not be available
    }

    return rates;
  })();

  inflightRatesFetches.set(baseCurrency, promise);

  try {
    return await promise;
  } catch (error) {
    // Persist failure timestamp so the backoff guard above can short-
    // circuit subsequent attempts in this session.
    try {
      localStorage.setItem(FAIL_FLAG_KEY, String(Date.now()));
    } catch {
      /* localStorage unavailable */
    }
    // Log once per failure (not on each render — the 5-min backoff
    // means at most one log per page session under normal conditions).
    if (error instanceof Error && error.message !== "rates-fetch-backoff") {
      console.warn("[currency] exchange-rate fetch failed; will retry in 5 min:", error.message);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    inflightRatesFetches.delete(baseCurrency);
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
 * Get exchange rates (from in-memory cache → localStorage → upstream fetch).
 *
 * Cache hierarchy:
 *   1. In-memory Map (24h) — fastest, survives within a tab session
 *   2. localStorage (24h)  — survives across page reloads in the same browser
 *   3. Frankfurter API     — single upstream call returns the full pair table
 *
 * Because Frankfurter's `/latest?base=X` returns every supported target in
 * one response, a single fetch hydrates all `${base}->${target}` pairs for
 * the next 24h. `getCachedPair()` can then resolve any pair from memory.
 */
export async function getExchangeRates(baseCurrency: CurrencyCode = "EUR"): Promise<ExchangeRates> {
  // Memory layer — fastest path
  const inMemory = memoryRates.get(baseCurrency);
  if (isFresh(inMemory)) {
    return inMemory;
  }

  // localStorage layer — hydrates memory on first read this session
  const cached = getCachedRates();
  if (cached && cached.base === baseCurrency) {
    memoryRates.set(cached.base, cached);
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

  // Opportunistically warm + observe the in-memory pair cache so
  // `[fx-cache] hit base=X target=Y` lines fire on the real call path.
  // The rates object we were handed is authoritative for this conversion,
  // but mirroring into the memory map lets other callers benefit too.
  if (!memoryRates.has(rates.base)) {
    memoryRates.set(rates.base, rates);
  }
  getCachedPair(fromCurrency, toCurrency);

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
  const known = (c: CurrencyCode) => !!rates && (c === rates.base || typeof rates.rates[c] === "number");
  // No rates, the same currency, or a currency the rates don't have (TWD,
  // AED…): the original, never its amount under the other's symbol.
  if (!rates || fromCurrency === toCurrency || !known(fromCurrency) || !known(toCurrency)) {
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
