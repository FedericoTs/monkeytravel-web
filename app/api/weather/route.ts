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

import { NextRequest, NextResponse } from "next/server";
import { apiGateway, CircuitOpenError } from "@/lib/api-gateway";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";

// Cache TTL: 7 days (historical weather data doesn't change)
const WEATHER_CACHE_DAYS = 7;

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
 * Get cached weather data from Supabase
 */
async function getCachedWeather(cacheKey: string): Promise<WeatherData | null> {
  try {
    const { data, error } = await supabase
      .from("geocode_cache") // Reuse geocode_cache table for weather data
      .select("*")
      .eq("address", `weather:${cacheKey}`)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !data) return null;

    // Update hit count (fire and forget)
    supabase
      .from("geocode_cache")
      .update({
        hit_count: (data.hit_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .then(() => {});

    return data.coordinates as unknown as WeatherData;
  } catch {
    return null;
  }
}

/**
 * Cache weather data in Supabase
 */
async function cacheWeather(cacheKey: string, weatherData: WeatherData, metadata: object): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + WEATHER_CACHE_DAYS * 24 * 60 * 60 * 1000);

    await supabase.from("geocode_cache").upsert(
      {
        address: `weather:${cacheKey}`,
        coordinates: weatherData as unknown as { lat: number; lng: number },
        metadata,
        cached_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        hit_count: 0,
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "address" }
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
      return NextResponse.json(
        { error: "Missing required parameters: latitude, longitude, startDate, endDate" },
        { status: 400 }
      );
    }

    // Check cache first (7-day TTL for historical weather data)
    const cacheKey = getWeatherCacheKey(latitude, longitude, startDate, endDate);
    const cachedWeather = await getCachedWeather(cacheKey);

    if (cachedWeather) {
      console.log(`[Weather API] Cache HIT for ${latitude},${longitude}`);
      return NextResponse.json({
        weather: cachedWeather,
        source: "open-meteo",
        cached: true,
        basedOn: `Cached historical data`,
      });
    }

    console.log(`[Weather API] Cache MISS for ${latitude},${longitude}`);

    // Get historical date range (same dates from previous year)
    const historicalDates = getHistoricalDateRange(startDate, endDate);

    // Fetch from Open-Meteo Historical API via API Gateway
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    url.searchParams.set("latitude", latitude);
    url.searchParams.set("longitude", longitude);
    url.searchParams.set("start_date", historicalDates.start);
    url.searchParams.set("end_date", historicalDates.end);
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,weathercode");
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
      console.error("[Weather API] Open-Meteo error:", response.status);
      return NextResponse.json(
        { error: "Failed to fetch weather data" },
        { status: 502 }
      );
    }

    if (!data.daily || !data.daily.time || data.daily.time.length === 0) {
      return NextResponse.json(
        { error: "No historical data available for this location and date range" },
        { status: 404 }
      );
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
      humidity: 60, // Default estimate
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

    return NextResponse.json({
      weather: weatherData,
      source: "open-meteo",
      cached: false,
      basedOn: `Historical data from ${historicalDates.start} to ${historicalDates.end}`,
    });
  } catch (error) {
    // Handle circuit breaker open state
    if (error instanceof CircuitOpenError) {
      console.warn("[Weather API] Circuit breaker open:", error.message);
      return NextResponse.json(
        { error: "Weather service temporarily unavailable" },
        { status: 503 }
      );
    }

    console.error("[Weather API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch weather data" },
      { status: 500 }
    );
  }
}
