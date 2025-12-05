/**
 * Locale and Internationalization Utilities
 *
 * Provides automatic locale detection and unit/currency conversion:
 * - Temperature: Celsius ↔ Fahrenheit (based on user locale)
 * - Distance: Metric ↔ Imperial (meters/km ↔ feet/yards/miles)
 * - Currency: Real-time conversion using Frankfurter API
 *
 * Usage:
 * 1. Wrap your app with <LocaleProvider> in layout.tsx
 * 2. Use the useLocale() hook in components
 *
 * Example:
 * ```tsx
 * import { useLocale } from "@/lib/locale";
 *
 * function MyComponent() {
 *   const { convertTemperature, convertDistance, convertCurrency } = useLocale();
 *
 *   return (
 *     <div>
 *       <p>Temperature: {convertTemperature(25)}</p>
 *       <p>Distance: {convertDistance(1500)}</p>
 *       <p>Price: {convertCurrency(100, "EUR").formatted}</p>
 *     </div>
 *   );
 * }
 * ```
 */

// Context and hooks
export {
  LocaleProvider,
  useLocale,
  useTemperature,
  useDistance,
  useCurrency,
} from "./context";

// Conversion utilities (for direct use without context)
export {
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  formatTemperature,
  formatTemperatureRange,
  metersToMiles,
  metersToFeet,
  metersToYards,
  metersToKm,
  formatDistance,
  formatWalkingTime,
  isWalkableDistance,
  formatAltitude,
} from "./conversions";

// Currency utilities
export {
  fetchExchangeRates,
  getExchangeRates,
  getCachedRates,
  convertCurrency,
  formatCurrencyValue,
  getCurrencySymbol,
  convertAndFormatCurrency,
  isCurrencySupported,
  parsePriceRange,
  parseCurrencyString,
  SUPPORTED_CURRENCIES,
} from "./currency";

// Types
export type {
  UnitSystem,
  TemperatureUnit,
  DistanceUnit,
  CurrencyCode,
  LocalePreferences,
  ExchangeRates,
  FormattedCurrency,
  LocaleContextValue,
} from "./types";

// Constants
export {
  IMPERIAL_COUNTRIES,
  FAHRENHEIT_COUNTRIES,
  CURRENCY_SYMBOLS,
  LOCALE_CURRENCY_MAP,
} from "./types";
