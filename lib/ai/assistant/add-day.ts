import type { SupportedLanguage } from "@/lib/ai/language";
import type { AssistantRole } from "@/lib/ai/assistant-access";
import { computeExtendedEndDate, MAX_TRIP_DAYS, nextDateISO } from "@/lib/ai/assistant/structural";
import { regenerateSingleDay } from "@/lib/gemini";
import { placesToEatCheck } from "@/lib/places/places-to-eat";
import { dietsFrom } from "@/lib/trips/diet";
import { isTripVibe, type BudgetTier, type ItineraryDay, type StructuredAssistantResponse } from "@/types";

type AssistantAction = NonNullable<StructuredAssistantResponse["action"]>;

/**
 * The trip assistant's "add a day" (structural): ONE new day after the last
 * one ("can you add a day to travel to Voss"), proposed for the user's confirm,
 * that moves the trip's end date together with the itinerary on apply. The
 * edit engine handles it first; this runs when the engine can't.
 *
 * The outcome is the prepared day (`action`), a failure (`error`), or a
 * `note` for the reply when nothing is added (an editor asking, the 14-day cap,
 * a length the trip already has). `days` are the trip's days as the turn found
 * them: the new day follows the last, and is planned around them.
 */
export async function prepareAddDay(input: {
  days: ItineraryDay[];
  requestedTotal: number | undefined;
  role: AssistantRole;
  trip: { end_date: string | null; budget: unknown; tags: unknown; trip_meta: unknown };
  destination: string;
  message: string;
  language: SupportedLanguage;
  userId: string;
}): Promise<{ action?: AssistantAction; error?: string; note?: string }> {
  const { days, requestedTotal, role, trip, destination, message, language, userId } = input;
  const currentDayCount = days.length;

  if (role !== "owner") {
    // Adding a day moves the trip's end date, which stays with the owner
    // (lib/ai/assistant-access.ts): /apply would refuse the proposal, so
    // say so now instead of generating a day nobody can apply.
    return { note: `The user is an editor of this trip, not its owner. Only the trip owner can add days or change the trip's dates. NO change was made. Explain that kindly and suggest asking the trip owner to add the day.` };
  } else if (currentDayCount === 0) {
    return { error: "This trip has no itinerary days yet, so there is nothing to extend" };
  } else if (
    currentDayCount >= MAX_TRIP_DAYS ||
    (requestedTotal !== undefined && requestedTotal > MAX_TRIP_DAYS)
  ) {
    // HARD CAP — mirrors the generation-side 14-day limit
    // (lib/gemini.ts validateTripDuration). No action taken.
    return { note: `The user asked to extend the trip${requestedTotal ? ` to ${requestedTotal} days` : ""}, but trips are capped at ${MAX_TRIP_DAYS} days${currentDayCount >= MAX_TRIP_DAYS ? ` and this trip already has ${currentDayCount}` : ""}. NO change was made. Kindly explain the ${MAX_TRIP_DAYS}-day maximum and suggest alternatives (freeing up a lighter day, or planning the extra days as a second trip).` };
  } else if (requestedTotal !== undefined && requestedTotal <= currentDayCount) {
    return { note: `The user asked for a ${requestedTotal}-day trip but this trip already has ${currentDayCount} days. NO change was made. Explain that, and that removing days isn't supported from chat yet.` };
  } else {
    console.log(`[AI Assistant] Attempting to add Day ${currentDayCount + 1}`);
    try {
      const lastDay = days[currentDayCount - 1];
      const newDayNumber = (lastDay.day_number || currentDayCount) + 1;
      const newDate = nextDateISO([lastDay.date, trip.end_date]);
      if (!newDate) {
        throw new Error("Could not derive a date for the new day");
      }

      // Trip context mirrors /api/ai/regenerate-day: budget tier from
      // the budget column, vibes inferred from tags, travel style from
      // trip_meta (a backpacker trip must not grow a classic day).
      const budgetTier = (((trip.budget as { tier?: string } | null)?.tier ??
        "balanced") as BudgetTier);
      const tags = (trip.tags as string[] | null) ?? [];
      const vibes = tags.filter(isTripVibe);
      const tripMeta = (trip.trip_meta ?? {}) as { travel_style?: "classic" | "backpacker"; dietary?: unknown };

      // Reuses the single-day generation contract — day shape, activity
      // IDs via generateActivityId, coordinate backfill via
      // validateAndFixCoordinates all happen inside regenerateSingleDay
      // (lib/gemini.ts). The user's message steers the day's content
      // ("… a day to travel to Voss" → that's the theme).
      const newDay = await regenerateSingleDay({
        destination: lastDay.city || destination, // multi-city: stay in the last day's city
        dayNumber: newDayNumber,
        date: newDate,
        budgetTier,
        pace: "moderate",
        vibes,
        surroundingDays: days,
        instructions: message.slice(0, 500),
        travelStyle: tripMeta.travel_style === "backpacker" ? "backpacker" : "classic",
        profilePreferences: { dietaryPreferences: dietsFrom(tripMeta.dietary) },
        language,
        userId,
      });
      if (lastDay.city && !newDay.city) newDay.city = lastDay.city;
      // A diet trip's places to eat that Maps has as closed, or doesn't
      // have, replaced by open ones or left out (lib/places/places-to-eat.ts).
      await placesToEatCheck({
        destination,
        dietary: dietsFrom(tripMeta.dietary),
        budgetTier,
        travelStyle: tripMeta.travel_style === "backpacker" ? "backpacker" : "classic",
        language,
        userId,
      })
        ?.finish([newDay], days)
        .catch((checkErr) => console.error("[AI Assistant] places-to-eat check error:", checkErr));

      const newEndDate = computeExtendedEndDate(trip.end_date, newDate) ?? undefined;

      const action: AssistantAction = {
        type: "add_day",
        applied: false,
        dayNumber: newDayNumber,
        newDay,
        newEndDate,
      };
      console.log(`[AI Assistant] Prepared new Day ${newDayNumber} for confirmation`);
      return { action };
    } catch (err) {
      console.error("[AI Assistant] Failed to generate new day:", err);
      return { error: `Failed to generate the new day: ${err instanceof Error ? err.message : "Unknown error"}` };
    }
  }
}
