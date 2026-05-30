/**
 * POST /api/trips/[id]/activities/from-booking
 *
 * F2.simple — Companion endpoint to /api/trips/[id]/parse-confirmation.
 * Takes a ParsedBooking (from the preview modal) plus optional placement
 * hints and writes a new Activity into the trip's itinerary JSONB.
 *
 * Design notes:
 * - The trip's `itinerary` is a JSONB array of ItineraryDay objects.
 *   There is NO stable `day_id` in the schema — days are identified by
 *   1-based `day_number` (== array index + 1). The brief mentions
 *   `day_id?: string` for shape parity; we accept a string for it and
 *   also accept the more idiomatic `day_number` directly.
 * - When neither is provided, we infer the day from `parsed.startAt`
 *   against the trip's `start_date`. Falling outside the trip range
 *   clamps to Day 1 (early) or the last day (late) so the user never
 *   ends up with an orphaned booking.
 * - We do NOT block on missing coordinates. The map view falls back to
 *   destination-centroid coords elsewhere (see
 *   lib/gemini.ts:validateAndFixCoordinates) — booking activities can
 *   sit address-only until the user opens the map.
 * - Authorize: trip owner only. Mirrors parse-confirmation.
 *
 * Returns the inserted Activity plus the dayNumber it landed on, so the
 * UI can scroll/focus to it.
 */

import { NextRequest } from "next/server";
import { getAuthenticatedUser, verifyTripOwnership } from "@/lib/api/auth";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import {
  generateActivityId,
  determineTimeSlot,
} from "@/lib/utils/activity-id";
import type { TripRouteContext } from "@/lib/api/route-context";
import type { Activity, ItineraryDay, TimeSlot } from "@/types";
import type { ParsedBooking } from "@/lib/email-parse/extract";

const VALID_TIME_SLOTS: TimeSlot[] = ["morning", "afternoon", "evening"];

/**
 * Pure helper: given the trip's start date (YYYY-MM-DD) and the
 * booking's startAt ISO string, return the 1-based day number it falls
 * on. Clamps to [1, dayCount].
 *
 * Exported for unit testing.
 */
export function inferDayNumber(
  tripStartDate: string,
  bookingStartAt: string,
  dayCount: number
): number {
  if (dayCount <= 0) return 1;
  const start = new Date(tripStartDate);
  const bookingDate = new Date(bookingStartAt);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(bookingDate.getTime())
  ) {
    return 1;
  }
  // Use UTC date math to avoid timezone-edge surprises. Both Supabase
  // start_date and Gemini-derived startAt are normally local-time
  // strings, but we only care about *date* difference for day-bucketing.
  const startDay = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const bookingDay = Date.UTC(
    bookingDate.getUTCFullYear(),
    bookingDate.getUTCMonth(),
    bookingDate.getUTCDate()
  );
  const diffDays = Math.floor((bookingDay - startDay) / (24 * 60 * 60 * 1000));
  const dayNumber = diffDays + 1;
  if (dayNumber < 1) return 1;
  if (dayNumber > dayCount) return dayCount;
  return dayNumber;
}

/**
 * Pull HH:MM out of an ISO timestamp. Falls back to '09:00' so the
 * activity always renders in the timeline even if the email omitted
 * a time.
 */
function extractTimeOfDay(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "09:00";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Compute duration in minutes between startAt and endAt; sensible default
 * per booking kind when endAt missing.
 */
function computeDurationMinutes(
  startAt: string,
  endAt: string | undefined,
  kind: ParsedBooking["kind"]
): number {
  if (endAt) {
    const start = new Date(startAt).getTime();
    const end = new Date(endAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      // Cap at 1 day for sensible single-activity display. Hotel
      // multi-day stays are still represented as a single check-in
      // activity at this layer; multi-day spanning is a UI concern
      // (and a future-feature decision).
      return Math.min(60 * 24, Math.round((end - start) / (1000 * 60)));
    }
  }
  switch (kind) {
    case "flight":
      return 120; // 2h covers boarding + a short-haul flight; long-haul will overflow but render anyway.
    case "restaurant":
      return 90;
    case "hotel":
      return 30; // Just the check-in event.
    case "activity":
      return 120;
    default:
      return 60;
  }
}

/**
 * Map ParsedBooking.kind onto Activity.type. The Activity type field
 * accepts a wider vocabulary; we pick the closest pre-existing one so
 * downstream rendering (icons, ACTIVITY_TYPE_TIMING) keeps working.
 */
function mapKindToActivityType(kind: ParsedBooking["kind"]): Activity["type"] {
  switch (kind) {
    case "hotel":
      return "activity"; // No 'hotel' in the canonical list; 'activity' is the safe catch-all that renders without a missing-type glyph.
    case "flight":
      return "transport";
    case "restaurant":
      return "restaurant";
    case "activity":
      return "activity";
    default:
      return "activity";
  }
}

/**
 * Build the description shown in the activity card. Uses the email's
 * raw_excerpt + confirmation number so the user can audit what we
 * pulled in without re-pasting.
 */
function buildDescription(parsed: ParsedBooking): string {
  const parts: string[] = [];
  if (parsed.confirmationNumber) {
    parts.push(`Confirmation: ${parsed.confirmationNumber}`);
  }
  if (parsed.raw_excerpt) {
    parts.push(parsed.raw_excerpt);
  }
  return parts.join("\n\n") || `Booking added from email.`;
}

/**
 * Compose the Activity row from a ParsedBooking, deferring to caller-
 * provided time_slot if present.
 */
function buildActivityFromBooking(
  parsed: ParsedBooking,
  overrideTimeSlot?: TimeSlot
): Activity {
  const startTime = extractTimeOfDay(parsed.startAt);
  const timeSlot: TimeSlot =
    overrideTimeSlot && VALID_TIME_SLOTS.includes(overrideTimeSlot)
      ? overrideTimeSlot
      : determineTimeSlot(startTime);

  const locationLabel =
    [parsed.city, parsed.country].filter(Boolean).join(", ") ||
    parsed.address ||
    "";

  const activity: Activity = {
    id: generateActivityId(),
    time_slot: timeSlot,
    start_time: startTime,
    duration_minutes: computeDurationMinutes(
      parsed.startAt,
      parsed.endAt,
      parsed.kind
    ),
    name: parsed.name,
    type: mapKindToActivityType(parsed.kind),
    description: buildDescription(parsed),
    location: locationLabel,
    estimated_cost: {
      // Email parses don't carry a normalized cost — leave at 0 so the
      // user sees the booking but the trip's total estimate isn't
      // double-counted. The ExpenseLedger work (task #220) is the
      // proper home for real spend tracking.
      amount: 0,
      currency: "USD",
      tier: "moderate",
    },
    tips: [],
    booking_required: true,
  };
  if (parsed.address) activity.address = parsed.address;
  if (parsed.coordinates) activity.coordinates = parsed.coordinates;
  return activity;
}

export async function POST(request: NextRequest, context: TripRouteContext) {
  try {
    const { id: tripId } = await context.params;

    const { user, supabase, errorResponse } = await getAuthenticatedUser();
    if (errorResponse) return errorResponse;

    // Owner-only mirror of parse-confirmation. Collaborators don't add
    // bookings via this flow (per F2.simple brief).
    const { trip, errorResponse: tripError } = await verifyTripOwnership(
      supabase,
      tripId,
      user.id,
      "id, user_id, start_date, end_date, itinerary"
    );
    if (tripError) return tripError;

    // Parse body.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest("Invalid JSON body");
    }
    if (!body || typeof body !== "object") {
      return errors.badRequest("Body must be an object");
    }
    const { parsed, day_id, day_number, time_slot } = body as {
      parsed?: unknown;
      day_id?: unknown;
      day_number?: unknown;
      time_slot?: unknown;
    };

    if (!parsed || typeof parsed !== "object") {
      return errors.badRequest("Missing required field: parsed");
    }
    const p = parsed as Partial<ParsedBooking>;

    // Defensive validation — we trust the parse-confirmation endpoint
    // but this route is callable directly and shouldn't blow up if a
    // malformed payload arrives.
    if (typeof p.name !== "string" || !p.name.trim()) {
      return errors.badRequest("parsed.name is required");
    }
    if (typeof p.startAt !== "string" || !p.startAt.trim()) {
      return errors.badRequest("parsed.startAt is required");
    }
    if (
      typeof p.kind !== "string" ||
      !["hotel", "flight", "restaurant", "activity", "unknown"].includes(p.kind)
    ) {
      return errors.badRequest("parsed.kind is invalid");
    }

    // The current itinerary may be null/undefined for the rare case of
    // a trip created without an AI itinerary (e.g. forked-then-cleared).
    const currentItinerary: ItineraryDay[] = Array.isArray(trip.itinerary)
      ? (trip.itinerary as ItineraryDay[])
      : [];

    if (currentItinerary.length === 0) {
      return errors.badRequest(
        "Trip has no itinerary days to add the booking to. Generate the trip first."
      );
    }

    // Resolve target day. Priority: explicit day_number > day_id (treated
    // as a stringified day_number for forward compat) > infer from
    // startAt. Always clamp to [1, dayCount].
    let targetDay: number;
    if (typeof day_number === "number" && Number.isFinite(day_number)) {
      targetDay = Math.min(
        currentItinerary.length,
        Math.max(1, Math.floor(day_number))
      );
    } else if (typeof day_id === "string" && /^\d+$/.test(day_id)) {
      const parsedDay = parseInt(day_id, 10);
      targetDay = Math.min(
        currentItinerary.length,
        Math.max(1, parsedDay)
      );
    } else {
      targetDay = inferDayNumber(
        String(trip.start_date),
        p.startAt as string,
        currentItinerary.length
      );
    }

    const requestedSlot =
      typeof time_slot === "string" &&
      VALID_TIME_SLOTS.includes(time_slot as TimeSlot)
        ? (time_slot as TimeSlot)
        : undefined;

    const newActivity = buildActivityFromBooking(
      p as ParsedBooking,
      requestedSlot
    );

    // Append the new activity to the target day. We append (not
    // splice-by-time) so the user can manually reorder it after if
    // needed — the existing reorder/recalculate flow on the trip page
    // does the time-aware shuffle better than we could synchronously
    // here.
    const updatedItinerary = currentItinerary.map((day, idx) => {
      if (idx + 1 !== targetDay) return day;
      return {
        ...day,
        activities: [...(day.activities || []), newActivity],
      };
    });

    const { error: updateError } = await supabase
      .from("trips")
      .update({
        itinerary: updatedItinerary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tripId)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[from-booking] update failed", updateError);
      return errors.internal(
        "Failed to add booking to trip",
        "from-booking"
      );
    }

    return apiSuccess({
      success: true,
      activity: newActivity,
      dayNumber: targetDay,
    });
  } catch (error) {
    console.error("[from-booking] unexpected error", error);
    return errors.internal("Failed to add booking", "from-booking");
  }
}
