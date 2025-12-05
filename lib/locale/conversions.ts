/**
 * Unit conversion utilities for temperature and distance
 */

import type { TemperatureUnit, DistanceUnit } from "./types";

// ============================================
// TEMPERATURE CONVERSIONS
// ============================================

/**
 * Convert Celsius to Fahrenheit
 */
export function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

/**
 * Convert Fahrenheit to Celsius
 */
export function fahrenheitToCelsius(fahrenheit: number): number {
  return Math.round(((fahrenheit - 32) * 5) / 9);
}

/**
 * Format temperature with unit symbol
 */
export function formatTemperature(
  celsius: number,
  unit: TemperatureUnit,
  showUnit: boolean = true
): string {
  if (unit === "fahrenheit") {
    const value = celsiusToFahrenheit(celsius);
    return showUnit ? `${value}°F` : `${value}`;
  }
  return showUnit ? `${celsius}°C` : `${celsius}`;
}

/**
 * Format temperature range with unit symbol
 */
export function formatTemperatureRange(
  minCelsius: number,
  maxCelsius: number,
  unit: TemperatureUnit
): string {
  if (unit === "fahrenheit") {
    const minF = celsiusToFahrenheit(minCelsius);
    const maxF = celsiusToFahrenheit(maxCelsius);
    return `${minF}°F – ${maxF}°F`;
  }
  return `${minCelsius}°C – ${maxCelsius}°C`;
}

// ============================================
// DISTANCE CONVERSIONS
// ============================================

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;
const METERS_PER_YARD = 0.9144;
const METERS_PER_KM = 1000;

/**
 * Convert meters to miles
 */
export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/**
 * Convert miles to meters
 */
export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

/**
 * Convert meters to feet
 */
export function metersToFeet(meters: number): number {
  return meters / METERS_PER_FOOT;
}

/**
 * Convert meters to yards
 */
export function metersToYards(meters: number): number {
  return meters / METERS_PER_YARD;
}

/**
 * Convert meters to kilometers
 */
export function metersToKm(meters: number): number {
  return meters / METERS_PER_KM;
}

/**
 * Format distance with appropriate unit based on system
 * - Metric: meters for < 1000m, km for >= 1000m
 * - Imperial: feet for < 500m, yards for 500m-1600m, miles for >= 1600m
 */
export function formatDistance(
  meters: number,
  unit: DistanceUnit,
  showUnit: boolean = true
): string {
  if (unit === "imperial") {
    if (meters < 500) {
      // Show feet for short distances
      const feet = Math.round(metersToFeet(meters));
      return showUnit ? `${feet} ft` : `${feet}`;
    } else if (meters < METERS_PER_MILE) {
      // Show yards for medium distances
      const yards = Math.round(metersToYards(meters));
      return showUnit ? `${yards} yd` : `${yards}`;
    } else {
      // Show miles for longer distances
      const miles = metersToMiles(meters);
      const formatted = miles < 10 ? miles.toFixed(1) : Math.round(miles).toString();
      return showUnit ? `${formatted} mi` : formatted;
    }
  }

  // Metric system
  if (meters < 1000) {
    return showUnit ? `${Math.round(meters)} m` : `${Math.round(meters)}`;
  } else {
    const km = metersToKm(meters);
    const formatted = km < 10 ? km.toFixed(1) : Math.round(km).toString();
    return showUnit ? `${formatted} km` : formatted;
  }
}

/**
 * Format walking time estimate based on distance
 * Assumes average walking speed of 5 km/h (3.1 mph)
 */
export function formatWalkingTime(meters: number): string {
  const WALKING_SPEED_KMH = 5;
  const hours = meters / 1000 / WALKING_SPEED_KMH;
  const minutes = Math.round(hours * 60);

  if (minutes < 1) {
    return "< 1 min";
  } else if (minutes < 60) {
    return `${minutes} min`;
  } else {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }
}

/**
 * Determine if the given distance is walkable (< 2km / 1.2 miles)
 */
export function isWalkableDistance(meters: number): boolean {
  return meters < 2000;
}

// ============================================
// ALTITUDE CONVERSIONS (bonus for future use)
// ============================================

/**
 * Convert meters to feet (for altitude)
 */
export function altitudeToFeet(meters: number): number {
  return Math.round(metersToFeet(meters));
}

/**
 * Format altitude with appropriate unit
 */
export function formatAltitude(
  meters: number,
  unit: DistanceUnit,
  showUnit: boolean = true
): string {
  if (unit === "imperial") {
    const feet = altitudeToFeet(meters);
    return showUnit ? `${feet.toLocaleString()} ft` : feet.toLocaleString();
  }
  return showUnit ? `${meters.toLocaleString()} m` : meters.toLocaleString();
}
