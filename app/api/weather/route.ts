/**
 * Weather API Route
 *
 * Fetches weather data from Open-Meteo API for accurate climate information.
 * Uses historical data for the same dates from the previous year to provide
 * realistic weather expectations for trip planning.
 *
 * Open-Meteo is free, requires no API key, and provides high-quality data.
 *
 * Now routed through API Gateway for:
 * - Automatic logging and analytics
 * - Retry with exponential backoff
 * - Circuit breaker protection
 *
 * CACHING: Uses Supabase cache for 7-day TTL since historical weather doesn't change
 */

import { NextRequest } from "next/server";
import { apiGateway, CircuitOpenError } from "@/lib/api-gateway";
import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";

// Lazy service-role client for the RLS-locked weather_cache table. The weather
// route runs server-side only, so a service-role client is the correct caller
// (anon must not write arbitrary cache rows). Memoized so we don't construct a
// new client on every request.
let _weatherAdmin: ReturnType<typeof createAdminClient> | null = null;
function getWeatherAdmin() {
  if (!_weatherAdmin) _weatherAdmin = createAdminClient();
  return _weatherAdmin;
}

// Cache TTL: 30 days (historical weather data doesn't change)
// Extended from 7 days - same dates from previous year are static
const WEATHER_CACHE_DAYS = 30;

interface WeatherData {
  temperature: {
    min: number;
    max: number;
    avg: number;
  };
  precipitation: {
    totalMm: number;
    rainyDays: number;
  };
  conditions: string;
  humidity: number;
  icon: string;
}

interface OpenMeteoHistoricalResponse {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    temperature_2m_mean: number[];
    precipitation_sum: number[];
    relative_humidity_2m_mean?: number[];
    weathercode?: number[];
  };
}

// Map WMO weather codes to conditions and icons
function getWeatherCondition(code: number): { condition: string; icon: string } {
  if (code === 0) return { condition: "Clear sky", icon: "☀️" };
  if (code <= 3) return { condition: "Partly cloudy", icon: "⛅" };
  if (code <= 48) return { condition: "Foggy", icon: "🌫️" };
  if (code <= 57) return { condition: "Drizzle", icon: "🌦️" };
  if (code <= 67) return { condition: "Rainy", icon: "🌧️" };
  if (code <= 77) return { condition: "Snowy", icon: "🌨️" };
  if (code <= 82) return { condition: "Rain showers", icon: "🌧️" };
  if (code <= 86) return { condition: "Snow showers", icon: "🌨️" };
  if (code <= 99) return { condition: "Thunderstorm", icon: "⛈️" };
  return { condition: "Variable", icon: "🌤️" };
}

// Calculate date range for historical lookup (same dates, previous year)
function getHistoricalDateRange(startDate: string, endDate: string): { start: string; end: string } {
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Go back one year
  start.setFullYear(start.getFullYear() - 1);
  end.setFullYear(end.getFullYear() - 1);

  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

/**
 * Generate cache key for weather data
 * Rounds coordinates to 2 decimal places (~1km accuracy) to improve cache hits
 */
function getWeatherCacheKey(lat: string, lng: string, startDate: string, endDate: string): string {
  const roundedLat = parseFloat(lat).toFixed(2);
  const roundedLng = parseFloat(lng).toFixed(2);
  const key = `weather:${roundedLat},${roundedLng}:${startDate}:${endDate}`;
  return crypto.createHash("md5").update(key).digest("hex");
}

/**
 * Type guard to validate weather data structure from cache
 */
function isValidWeatherData(data: unknown): data is WeatherData {
  if (typeof data !== "object" || data === null) return false;
  const w = data as Record<string, unknown>;

  // Check required fields exist and have correct types
  if (typeof w.temperature !== "object" || w.temperature === null) return false;
  if (typeof w.precipitation !== "object" || w.precipitation === null) return false;
  if (typeof w.conditions !== "string") return false;
  if (typeof w.humidity !== "number") return false;
  if (typeof w.icon !== "string") return false;

  const temp = w.temperature as Record<string, unknown>;
  if (typeof temp.min !== "number" || typeof temp.max !== "number" || typeof temp.avg !== "number") {
    return false;
  }

  const precip = w.precipitation as Record<string, unknown>;
  if (typeof precip.totalMm !== "number" || typeof precip.rainyDays !== "number") {
    return false;
  }

  return true;
}

/**
 * Get cached weather data from the dedicated weather_cache table.
 */
async function getCachedWeather(cacheKey: string): Promise<WeatherData | null> {
  try {
    const admin = getWeatherAdmin();
    const { data, error } = await admin
      .from("weather_cache")
      .select("weather, hit_count")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data || !isValidWeatherData(data.weather)) return null;

    // Update hit count (fire and forget)
    admin
      .from("weather_cache")
      .update({
        hit_count: (data.hit_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("cache_key", cacheKey)
      .then(() => {});

    return data.weather;
  } catch {
    return null;
  }
}

/**
 * Cache weather data in the dedicated weather_cache table.
 */
async function cacheWeather(cacheKey: string, weatherData: WeatherData, requestMetadata: object): Promise<void> {
  try {
    const admin = getWeatherAdmin();
    const expiresAt = new Date(Date.now() + WEATHER_CACHE_DAYS * 24 * 60 * 60 * 1000);

    await admin.from("weather_cache").upsert(
      {
        cache_key: cacheKey,
        weather: weatherData,
        request_metadata: requestMetadata,
        cached_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" }
    );
  } catch (error) {
    console.error("[Weather Cache] Save error:", error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const latitude = searchParams.get("latitude");
    const longitude = searchParams.get("longitude");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!latitude || !longitude || !startDate || !endDate) {
      return errors.badRequest("Missing required parameters: latitude, longitude, startDate, endDate");
    }

    // Edge CDN cache headers — only set when no Authorization header is present.
    // Historical weather data is static and identical per (lat/lng/dates) tuple,
    // so we can safely offload most hits to the CDN edge for a full day.
    // Responses with user-specific auth must NOT be cached publicly.
    const hasAuthHeader = request.headers.has("authorization");
    const edgeCacheHeaders: Record<string, string> | undefined = hasAuthHeader
      ? undefined
      : { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400" };

    // Check cache first (7-day TTL for historical weather data)
    const cacheKey = getWeatherCacheKey(latitude, longitude, startDate, endDate);
    const cachedWeather = await getCachedWeather(cacheKey);

    if (cachedWeather) {
      console.log(`[Weather] Cache HIT for ${latitude},${longitude}`);
      return apiSuccess(
        {
          weather: cachedWeather,
          source: "open-meteo",
          cached: true,
          basedOn: `Cached historical data`,
        },
        edgeCacheHeaders ? { headers: edgeCacheHeaders } : undefined
      );
    }

    console.log(`[Weather] Cache MISS for ${latitude},${longitude}`);

    // Get historical date range (same dates from previous year)
    const historicalDates = getHistoricalDateRange(startDate, endDate);

    // Fetch from Open-Meteo Historical API via API Gateway
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    url.searchParams.set("latitude", latitude);
    url.searchParams.set("longitude", longitude);
    url.searchParams.set("start_date", historicalDates.start);
    url.searchParams.set("end_date", historicalDates.end);
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,weathercode,relative_humidity_2m_mean");
    url.searchParams.set("timezone", "auto");

    const { response, data } = await apiGateway.fetch<OpenMeteoHistoricalResponse>(
      url.toString(),
      {
        method: "GET",
        headers: { "Accept": "application/json" },
      },
      {
        apiName: "open_meteo",
        endpoint: "/archive",
        costOverride: 0, // Free API
        metadata: {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          startDate: historicalDates.start,
          endDate: historicalDates.end,
        },
      }
    );

    if (!response.ok) {
      console.error("[Weather] Open-Meteo error:", response.status);
      return errors.internal("Failed to fetch weather data", "Weather");
    }

    if (!data.daily || !data.daily.time || data.daily.time.length === 0) {
      return errors.notFound("No historical data available for this location and date range");
    }

    // Calculate aggregates
    const temps = data.daily.temperature_2m_mean.filter((t) => t !== null);
    const maxTemps = data.daily.temperature_2m_max.filter((t) => t !== null);
    const minTemps = data.daily.temperature_2m_min.filter((t) => t !== null);
    const precipitation = data.daily.precipitation_sum.filter((p) => p !== null);
    const weatherCodes = data.daily.weathercode || [];

    const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : 20;
    const maxTemp = maxTemps.length > 0 ? Math.max(...maxTemps) : avgTemp + 5;
    const minTemp = minTemps.length > 0 ? Math.min(...minTemps) : avgTemp - 5;
    const totalPrecip = precipitation.reduce((a, b) => a + b, 0);
    const rainyDays = precipitation.filter((p) => p > 1).length;

    // Get most common weather condition
    const weatherCodeCounts = weatherCodes.reduce((acc, code) => {
      if (code !== null) {
        acc[code] = (acc[code] || 0) + 1;
      }
      return acc;
    }, {} as Record<number, number>);

    const mostCommonCode = Object.entries(weatherCodeCounts).sort(
      ([, a], [, b]) => b - a
    )[0];
    const { condition, icon } = getWeatherCondition(
      mostCommonCode ? parseInt(mostCommonCode[0]) : 0
    );

    // Build condition description
    let conditionDescription = condition;
    if (rainyDays > data.daily.time.length * 0.5) {
      conditionDescription = "Frequent rain expected";
    } else if (rainyDays > data.daily.time.length * 0.3) {
      conditionDescription = "Occasional rain possible";
    } else if (avgTemp > 30) {
      conditionDescription = "Hot and mostly dry";
    } else if (avgTemp < 5) {
      conditionDescription = "Cold, possible snow";
    } else if (avgTemp > 20) {
      conditionDescription = "Warm and pleasant";
    } else if (avgTemp > 10) {
      conditionDescription = "Mild temperatures";
    } else {
      conditionDescription = "Cool weather expected";
    }

    // Calculate average humidity from real data, fallback to 60%
    const humidityValues = (data.daily.relative_humidity_2m_mean || []).filter(
      (h): h is number => h !== null && h !== undefined
    );
    const avgHumidity =
      humidityValues.length > 0
        ? Math.round(humidityValues.reduce((a, b) => a + b, 0) / humidityValues.length)
        : 60;

    const weatherData: WeatherData = {
      temperature: {
        min: Math.round(minTemp),
        max: Math.round(maxTemp),
        avg: Math.round(avgTemp),
      },
      precipitation: {
        totalMm: Math.round(totalPrecip),
        rainyDays,
      },
      conditions: conditionDescription,
      humidity: avgHumidity,
      icon,
    };

    // Cache the result for future requests (7-day TTL)
    await cacheWeather(cacheKey, weatherData, {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      startDate,
      endDate,
      historicalDates,
    });

    return apiSuccess(
      {
        weather: weatherData,
        source: "open-meteo",
        cached: false,
        basedOn: `Historical data from ${historicalDates.start} to ${historicalDates.end}`,
      },
      edgeCacheHeaders ? { headers: edgeCacheHeaders } : undefined
    );
  } catch (error) {
    // Handle circuit breaker open state
    if (error instanceof CircuitOpenError) {
      console.warn("[Weather] Circuit breaker open:", error.message);
      return errors.serviceUnavailable("Weather service temporarily unavailable");
    }

    console.error("[Weather] Error:", error);
    return errors.internal("Failed to fetch weather data", "Weather");
  }
}
