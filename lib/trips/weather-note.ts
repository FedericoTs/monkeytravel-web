/**
 * Turn the trip's weather prose into a condition word and an icon.
 *
 * IT USED TO PULL OUT THE TEMPERATURE. IT MUST NOT.
 * -------------------------------------------------
 * The source is `trip_meta.weather_note`, which is model-generated prose that
 * reads like data and is not. Measured across 279 trips it contradicts itself:
 * Kyoto in September appears as both "10-18°C" and "27-32°C" on two different
 * trips, and six round-number buckets cover 229 of them. A user was emailed
 * "10-18°C" for Los Angeles when the real forecast was 22-32°C.
 *
 * The hero chip once regex-extracted that figure and rendered it bare — no
 * label, no "~", no source — which is the most confident possible
 * presentation of an invented number. The emails were fixed by replacing it
 * with a real Open-Meteo forecast (lib/email/trip-forecast.ts); the trip
 * pages have no forecast wired up, so they show the condition only.
 *
 * The condition word survives on purpose. "Sunny" or "mild" is a vibe, not a
 * measurement — a reader cannot mistake it for a reading off an instrument,
 * and it is what the gradient and icon are chosen from anyway.
 */
export type WeatherConditionKey = "sunny" | "cloudy" | "rainy" | "cold" | "windy" | "pleasant" | "mild";

export function weatherCondition(weather: string): { conditionKey: WeatherConditionKey; icon: string; gradient: string } {
  const lowerWeather = weather.toLowerCase();

  // Determine condition and styling - Fresh Voyager theme colors
  if (lowerWeather.includes("sun") || lowerWeather.includes("clear") || lowerWeather.includes("warm") || lowerWeather.includes("hot")) {
    return { conditionKey: "sunny", icon: "☀️", gradient: "from-[#FF6B6B] to-[#FFB4B4]" };
  }
  if (lowerWeather.includes("cloud") || lowerWeather.includes("overcast")) {
    return { conditionKey: "cloudy", icon: "☁️", gradient: "from-slate-400 to-slate-500" };
  }
  if (lowerWeather.includes("rain") || lowerWeather.includes("shower")) {
    return { conditionKey: "rainy", icon: "🌧️", gradient: "from-[#00B4A6] to-[#008B80]" };
  }
  if (lowerWeather.includes("snow") || lowerWeather.includes("cold") || lowerWeather.includes("winter")) {
    return { conditionKey: "cold", icon: "❄️", gradient: "from-[#74B9FF] to-[#0984e3]" };
  }
  if (lowerWeather.includes("wind")) {
    return { conditionKey: "windy", icon: "💨", gradient: "from-slate-300 to-slate-500" };
  }
  if (lowerWeather.includes("mild") || lowerWeather.includes("pleasant")) {
    return { conditionKey: "pleasant", icon: "🌤️", gradient: "from-[#FFD93D] to-[#E5C235]" };
  }
  // Default
  return { conditionKey: "mild", icon: "🌤️", gradient: "from-[#00B4A6] to-[#55EFC4]" };
}
