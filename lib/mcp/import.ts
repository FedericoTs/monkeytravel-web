/**
 * Turns an itinerary the ChatGPT MCP tool generated (mcp_itineraries) into
 * the input the trip persistence expects, so "Save to MonkeyTravel" creates
 * a real trip through the same path as the wizard's manual save.
 */
import type { GeneratedItinerary, ItineraryDay, TimeSlot, TripVibe } from "@/types";
import type { PersistInput, TripFormState } from "@/lib/trips/persistTrip";
import { addDaysISO } from "@/lib/ai/multi-city-core";
import type { MCPDay } from "./schema";

/** The columns of an mcp_itineraries row the import reads. */
export interface MCPItineraryRow {
  destination: string;
  travel_style: string | null;
  interests: string[] | null;
  budget: string | null;
  itinerary: MCPDay[];
}

/** Days ahead the trip is pencilled in, as the wizard's "I'm flexible" does. */
export const FLEXIBLE_START_OFFSET_DAYS = 21;

const BUDGET_TIERS: Record<string, TripFormState["budgetTier"]> = {
  budget: "budget",
  moderate: "balanced",
  luxury: "premium",
};

const STYLE_VIBES: Record<string, TripVibe> = {
  adventure: "adventure",
  relaxation: "wellness",
  cultural: "cultural",
  foodie: "foodie",
  romantic: "romantic",
};

const CLOCK = /^(\d{1,2}):(\d{2})$/;

function minutesOf(clock: string): number | null {
  const m = CLOCK.exec(clock.trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes < 24 * 60 && Number(m[2]) < 60 ? minutes : null;
}

function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * "09:00-11:30" → 09:00 for 150 minutes. A time without a readable end lasts
 * an hour; one without a readable start begins at `fallbackStart` (the
 * previous activity's end), so a day never stacks its activities on one minute.
 */
export function parseMcpTime(time: string | undefined, fallbackStart: number): { start: number; minutes: number } {
  const [from, to] = String(time ?? "").split(/\s*[-–]\s*/);
  const start = minutesOf(from ?? "") ?? fallbackStart;
  const end = to ? minutesOf(to) : null;
  return { start, minutes: end !== null && end > start ? end - start : 60 };
}

function timeSlotOf(start: number): TimeSlot {
  if (start < 12 * 60) return "morning";
  if (start < 18 * 60) return "afternoon";
  return "evening";
}

function importDay(day: MCPDay, index: number, startDate: string, destination: string): ItineraryDay {
  let cursor = 9 * 60;
  const activities = (day.activities ?? []).map((activity) => {
    const { start, minutes } = parseMcpTime(activity.time, cursor);
    cursor = start + minutes + 30;
    return {
      time_slot: timeSlotOf(start),
      start_time: clockOf(start),
      duration_minutes: minutes,
      name: activity.name,
      type: activity.type || "activity",
      description: activity.description ?? "",
      location: activity.location || destination,
      tips: activity.tip ? [activity.tip] : [],
      booking_required: false,
    };
  });
  return { day_number: index + 1, date: addDaysISO(startDate, index), title: day.theme, activities };
}

/**
 * The manual-save input for an MCP itinerary starting on `startDate`. The
 * text is English whatever the visitor's language: the MCP prompt writes it.
 */
export function mcpTripInput(row: MCPItineraryRow, startDate: string, locale: string): PersistInput {
  const days = row.itinerary.map((day, index) => importDay(day, index, startDate, row.destination));
  const vibe = STYLE_VIBES[row.travel_style ?? ""];
  const itinerary: GeneratedItinerary = {
    destination: { name: row.destination, country: "", description: "", best_for: [], weather_note: "" },
    days,
    language: "en",
    trip_summary: { total_estimated_cost: 0, currency: "USD", highlights: [], packing_suggestions: [] },
  };
  const formState: TripFormState = {
    destination: row.destination,
    startDate,
    endDate: addDaysISO(startDate, Math.max(days.length, 1) - 1),
    budgetTier: BUDGET_TIERS[row.budget ?? ""] ?? "balanced",
    pace: "moderate",
    vibes: vibe ? [vibe] : [],
    derivedInterests: row.interests ?? [],
    locale,
  };
  return { itinerary, formState };
}
