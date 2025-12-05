/**
 * Weather API Client
 *
 * Pre-configured client for Open-Meteo API.
 * Free API, but tracked for analytics.
 */

import { apiGateway } from "../client";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1";

/**
 * Open-Meteo Weather API
 */
export const weatherApi = {
  /**
   * Get weather forecast
   */
  async getForecast(
    latitude: number,
    longitude: number,
    options: {
      userId?: string;
      forecastDays?: number;
      timezone?: string;
    } = {}
  ) {
    const url = new URL(`${OPEN_METEO_BASE}/forecast`);
    url.searchParams.set("latitude", latitude.toString());
    url.searchParams.set("longitude", longitude.toString());
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max"
    );
    url.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m"
    );
    url.searchParams.set("timezone", options.timezone || "auto");
    url.searchParams.set(
      "forecast_days",
      (options.forecastDays || 7).toString()
    );

    const { data } = await apiGateway.fetch<{
      current: {
        time: string;
        temperature_2m: number;
        relative_humidity_2m: number;
        weather_code: number;
        wind_speed_10m: number;
      };
      daily: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_sum: number[];
        wind_speed_10m_max: number[];
      };
    }>(
      url.toString(),
      { method: "GET" },
      {
        apiName: "open_meteo",
        endpoint: "/forecast",
        userId: options.userId,
        costOverride: 0, // Free API
        metadata: { latitude, longitude, forecastDays: options.forecastDays },
      }
    );

    return data;
  },

  /**
   * Get historical weather data
   */
  async getHistorical(
    latitude: number,
    longitude: number,
    startDate: string,
    endDate: string,
    options: {
      userId?: string;
      timezone?: string;
    } = {}
  ) {
    const url = new URL(`${OPEN_METEO_BASE}/archive`);
    url.searchParams.set("latitude", latitude.toString());
    url.searchParams.set("longitude", longitude.toString());
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum"
    );
    url.searchParams.set("timezone", options.timezone || "auto");

    const { data } = await apiGateway.fetch<{
      daily: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_sum: number[];
      };
    }>(
      url.toString(),
      { method: "GET" },
      {
        apiName: "open_meteo",
        endpoint: "/archive",
        userId: options.userId,
        costOverride: 0, // Free API
        metadata: { latitude, longitude, startDate, endDate },
      }
    );

    return data;
  },
};
