/**
 * Amadeus Utility Functions
 *
 * Helper functions for parsing, formatting, and transforming Amadeus data.
 */

import { MAJOR_AIRPORTS, AIRLINE_NAMES } from './types';

/**
 * Parse ISO 8601 duration string to minutes
 *
 * @param duration - ISO 8601 duration (e.g., "PT12H30M")
 * @returns Duration in minutes
 */
export function parseDuration(duration: string): number {
  if (!duration) return 0;

  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');

  return hours * 60 + minutes;
}

/**
 * Format duration from ISO 8601 to human-readable string
 *
 * @param duration - ISO 8601 duration (e.g., "PT12H30M")
 * @returns Formatted string (e.g., "12h 30m")
 */
export function formatDuration(duration: string): string {
  if (!duration) return '';

  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return duration;

  const hours = match[1] ? `${match[1]}h` : '';
  const minutes = match[2] ? `${match[2]}m` : '';

  return [hours, minutes].filter(Boolean).join(' ');
}

/**
 * Format duration from minutes to human-readable string
 *
 * @param minutes - Duration in minutes
 * @returns Formatted string (e.g., "12h 30m")
 */
export function formatMinutesToDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Format ISO datetime to localized time string
 *
 * @param datetime - ISO 8601 datetime string
 * @returns Formatted time (e.g., "14:30")
 */
export function formatTime(datetime: string): string {
  if (!datetime) return '';

  try {
    const date = new Date(datetime);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return datetime;
  }
}

/**
 * Format ISO datetime to localized date string
 *
 * @param datetime - ISO 8601 datetime string
 * @returns Formatted date (e.g., "Jun 15")
 */
export function formatDate(datetime: string): string {
  if (!datetime) return '';

  try {
    const date = new Date(datetime);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return datetime;
  }
}

/**
 * Format ISO datetime to full date and time
 *
 * @param datetime - ISO 8601 datetime string
 * @returns Formatted datetime (e.g., "Jun 15, 14:30")
 */
export function formatDateTime(datetime: string): string {
  if (!datetime) return '';

  try {
    const date = new Date(datetime);
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${dateStr}, ${timeStr}`;
  } catch {
    return datetime;
  }
}

/**
 * Format currency amount
 *
 * @param amount - Amount as string or number
 * @param currency - Currency code (e.g., "USD")
 * @returns Formatted currency string (e.g., "$1,234.56")
 */
export function formatCurrency(
  amount: string | number,
  currency: string = 'USD'
): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numAmount);
  } catch {
    return `${currency} ${numAmount.toFixed(2)}`;
  }
}

/**
 * Calculate number of nights between check-in and check-out dates
 *
 * @param checkIn - Check-in date (YYYY-MM-DD)
 * @param checkOut - Check-out date (YYYY-MM-DD)
 * @returns Number of nights
 */
export function calculateNights(checkIn: string, checkOut: string): number {
  try {
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diffTime = end.getTime() - start.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(1, diffDays);
  } catch {
    return 1;
  }
}

/**
 * Get IATA code for a city name
 *
 * @param cityName - City name
 * @returns IATA code or undefined
 */
export function getIATACode(cityName: string): string | undefined {
  // Normalize city name
  const normalized = cityName.trim();

  // Direct lookup
  if (MAJOR_AIRPORTS[normalized]) {
    return MAJOR_AIRPORTS[normalized];
  }

  // Case-insensitive lookup
  const lowerCityName = normalized.toLowerCase();
  for (const [city, code] of Object.entries(MAJOR_AIRPORTS)) {
    if (city.toLowerCase() === lowerCityName) {
      return code;
    }
  }

  // Partial match
  for (const [city, code] of Object.entries(MAJOR_AIRPORTS)) {
    if (
      city.toLowerCase().includes(lowerCityName) ||
      lowerCityName.includes(city.toLowerCase())
    ) {
      return code;
    }
  }

  return undefined;
}

/**
 * Get airline name from carrier code
 *
 * @param carrierCode - Two-letter carrier code (e.g., "AA")
 * @returns Airline name or the code if not found
 */
export function getAirlineName(carrierCode: string): string {
  return AIRLINE_NAMES[carrierCode] || carrierCode;
}

/**
 * Calculate layover duration between two segments
 *
 * @param arrivalTime - Arrival time of first segment (ISO datetime)
 * @param departureTime - Departure time of next segment (ISO datetime)
 * @returns Layover duration in minutes
 */
export function calculateLayover(
  arrivalTime: string,
  departureTime: string
): number {
  try {
    const arrival = new Date(arrivalTime);
    const departure = new Date(departureTime);
    return Math.round((departure.getTime() - arrival.getTime()) / (1000 * 60));
  } catch {
    return 0;
  }
}

/**
 * Format layover duration
 *
 * @param minutes - Layover in minutes
 * @returns Formatted string (e.g., "2h 30m layover")
 */
export function formatLayover(minutes: number): string {
  if (minutes <= 0) return '';

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins}m layover`;
  if (mins === 0) return `${hours}h layover`;
  return `${hours}h ${mins}m layover`;
}

/**
 * Check if a date string is valid
 *
 * @param dateStr - Date string to validate (YYYY-MM-DD)
 * @returns True if valid date
 */
export function isValidDate(dateStr: string): boolean {
  if (!dateStr) return false;

  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;

  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Check if a date is in the future
 *
 * @param dateStr - Date string to check (YYYY-MM-DD)
 * @returns True if date is in the future
 */
export function isFutureDate(dateStr: string): boolean {
  if (!isValidDate(dateStr)) return false;

  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return date >= today;
}

/**
 * Get tomorrow's date in YYYY-MM-DD format
 */
export function getTomorrowDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatDateToISO(tomorrow);
}

/**
 * Format Date object to YYYY-MM-DD string
 */
export function formatDateToISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Add days to a date string
 *
 * @param dateStr - Starting date (YYYY-MM-DD)
 * @param days - Number of days to add
 * @returns New date string
 */
export function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return formatDateToISO(date);
}

/**
 * Format stop count to human-readable string
 *
 * @param stops - Number of stops
 * @returns Formatted string (e.g., "Direct", "1 stop", "2 stops")
 */
export function formatStops(stops: number): string {
  if (stops === 0) return 'Direct';
  if (stops === 1) return '1 stop';
  return `${stops} stops`;
}

/**
 * Get cabin class display name
 *
 * @param cabinCode - Cabin class code
 * @returns Display name
 */
export function getCabinClassName(
  cabinCode: string
): string {
  const cabinNames: Record<string, string> = {
    ECONOMY: 'Economy',
    PREMIUM_ECONOMY: 'Premium Economy',
    BUSINESS: 'Business',
    FIRST: 'First Class',
  };
  return cabinNames[cabinCode] || cabinCode;
}

/**
 * Calculate price per person for a group booking
 *
 * @param totalPrice - Total price
 * @param travelers - Number of travelers
 * @returns Price per person
 */
export function calculatePricePerPerson(
  totalPrice: number,
  travelers: number
): number {
  return Math.round((totalPrice / travelers) * 100) / 100;
}

/**
 * Validate IATA code format
 *
 * @param code - Code to validate
 * @returns True if valid IATA code format
 */
export function isValidIATACode(code: string): boolean {
  return /^[A-Z]{3}$/i.test(code);
}

/**
 * Normalize IATA code (uppercase)
 *
 * @param code - Code to normalize
 * @returns Uppercase IATA code
 */
export function normalizeIATACode(code: string): string {
  return code.toUpperCase().trim();
}
