import type { NextResponse } from "next/server";
import { isLockedActivity, lockedActivityNames } from "@/lib/ai/anchors-core";
import { ASSISTANT_DATES_OWNER_ONLY_MESSAGE, type AssistantRole } from "@/lib/ai/assistant-access";
import { ASSISTANT_ERROR_CODES as CODES } from "@/lib/ai/assistant/error-message";
import {
  addDaysISO,
  computeExtendedEndDate,
  MAX_TRIP_DAYS,
  maxTripDays,
  nextDateISO,
} from "@/lib/ai/assistant/structural";
import { apiError, errors } from "@/lib/api/response-wrapper";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import type { Activity, ItineraryDay } from "@/types";

export interface ApplyChangeRequest {
  tripId: string;
  /**
   * The conversation this confirmation belongs to, so the transcript can be
   * annotated once the write succeeds. Optional: an older client that does not
   * send it still applies the change, it just leaves history unannotated.
   */
  conversationId?: string;
  changeType: "replace" | "add" | "remove" | "adjust_duration" | "add_day" | "apply_draft" | "shift_days";
  oldActivity?: Activity;
  newActivity?: Activity;
  dayNumber: number;
  // For adjust_duration
  activity?: { id: string; name: string; type: string };
  oldDuration?: number;
  newDuration?: number;
  // For add_day (structural — transcript: "can you add a day to travel to
  // Voss"): the fully generated day proposed in preview.
  day?: ItineraryDay;
  // For apply_draft (structural — users pasting whole multi-day drafts):
  // the revised replacement days, persisted in ONE write. Days past the
  // trip's end are the assistant adding days (owner only).
  days?: ItineraryDay[];
  // For shift_days (P2 Stage C — the cancelled-flight primitive): every day
  // from `dayNumber` onward moves this many days LATER (1-7). The resulting
  // calendar hole before `dayNumber` is the point — extra free days where
  // the traveller currently is. start_date moves too when dayNumber === 1.
  shiftByDays?: number;
}

const CHANGE_TYPES: ReadonlySet<string> = new Set<ApplyChangeRequest["changeType"]>([
  "replace",
  "add",
  "remove",
  "adjust_duration",
  "add_day",
  "apply_draft",
  "shift_days",
]);

/** What is wrong with a change's fields, seen before the trip is read; null when nothing is. */
export function invalidChange(change: ApplyChangeRequest): string | null {
  const { tripId, changeType, dayNumber, oldActivity, newActivity, activity, newDuration, day, days, shiftByDays } = change;
  // A type check, not `!dayNumber`: 0 is not missing, it is a day the trip does
  // not have, and applyChange says so.
  if (!tripId || !changeType || typeof dayNumber !== "number") {
    return "Missing required fields: tripId, changeType, dayNumber";
  }
  if (!CHANGE_TYPES.has(changeType)) return "Unknown changeType";
  if ((changeType === "replace" || changeType === "add") && !newActivity) {
    return "Missing newActivity for replace/add operation";
  }
  if ((changeType === "replace" || changeType === "remove") && !oldActivity) {
    return "Missing oldActivity for replace/remove operation";
  }
  if (changeType === "adjust_duration" && (!activity || newDuration === undefined)) {
    return "Missing activity or newDuration for adjust_duration operation";
  }
  if (changeType === "add_day" && (!day || !Array.isArray(day.activities) || day.activities.length === 0)) {
    return "Missing day (with activities) for add_day operation";
  }
  if (changeType === "apply_draft" && (!Array.isArray(days) || days.length === 0)) {
    return "Missing days for apply_draft operation";
  }
  if (
    changeType === "shift_days" &&
    (typeof shiftByDays !== "number" || !Number.isInteger(shiftByDays) || shiftByDays < 1 || shiftByDays > 7)
  ) {
    return "shiftByDays must be an integer between 1 and 7";
  }
  return null;
}

/** A change made: the trip's days as they now stand, and what the write and the reply need besides. */
export interface AppliedChange {
  days: ItineraryDay[];
  /** The trip's dates, when the change moved them: they go in the same write as the days. */
  newEndDate: string | null;
  newStartDate: string | null;
  /** The day to name and show. */
  dayNumber: number;
  /** How many days changed, for a change across several. */
  dayCount?: number;
  /** What to name it in the badge. */
  name: string;
}

interface TripDates {
  startDate: string | undefined;
  endDate: string | undefined;
}

/** What one kind of change did to the days it was given, beyond the days themselves. */
type Made = { refused?: undefined } & Partial<Omit<AppliedChange, "days">>;
type Outcome = { refused: NextResponse } | Made;

const notInDay = (): Outcome => ({
  refused: apiError("Activity not found in itinerary", { status: 404, code: CODES.outdated }),
});
const activityIndex = (day: ItineraryDay, target: { id?: string; name: string }) =>
  day.activities.findIndex((a) => a.id === target.id || a.name === target.name);

function replaceActivity(day: ItineraryDay, oldActivity: Activity, newActivity: Activity): Outcome {
  const index = Math.max(0, activityIndex(day, oldActivity));
  // Preserve original time slot and start time
  newActivity.start_time = day.activities[index].start_time;
  newActivity.time_slot = day.activities[index].time_slot;
  day.activities[index] = newActivity;
  console.log(`[AI Assistant Apply] Replaced "${oldActivity.name}" with "${newActivity.name}"`);
  return {};
}

function addActivity(day: ItineraryDay, newActivity: Activity, dayNumber: number): Outcome {
  day.activities.push(newActivity);
  day.activities.sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
  console.log(`[AI Assistant Apply] Added "${newActivity.name}" to Day ${dayNumber}`);
  return {};
}

function removeActivity(day: ItineraryDay, oldActivity: Activity, dayNumber: number): Outcome {
  const index = activityIndex(day, oldActivity);
  if (index === -1) return notInDay();
  day.activities.splice(index, 1);
  console.log(`[AI Assistant Apply] Removed "${oldActivity.name}" from Day ${dayNumber}`);
  return {};
}

/** The new duration, and everything after it on the day starting that much later or earlier. */
function adjustDuration(
  day: ItineraryDay,
  activity: { id: string; name: string },
  oldDuration: number | undefined,
  newDuration: number
): Outcome {
  const index = activityIndex(day, activity);
  if (index === -1) return notInDay();
  day.activities[index].duration_minutes = newDuration;
  for (let i = index + 1; i < day.activities.length; i++) {
    const previous = day.activities[i - 1];
    const [hours, mins] = (previous.start_time || "09:00").split(":").map(Number);
    const end = hours * 60 + mins + (previous.duration_minutes || 60);
    day.activities[i].start_time = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  }
  console.log(`[AI Assistant Apply] Adjusted "${activity.name}" duration from ${oldDuration || "unknown"}min to ${newDuration}min`);
  return {};
}

/**
 * Every day from dayNumber to the end, `shiftByDays` days later. day_numbers
 * stay 1..N ordinals; only dates (and the trip window) move. The calendar gap
 * this opens before dayNumber is deliberate.
 */
function shiftDays(days: ItineraryDay[], dayNumber: number, shiftByDays: number, trip: TripDates): Outcome {
  let shifted = 0;
  for (let i = dayNumber - 1; i < days.length; i++) {
    const newDate = addDaysISO(days[i].date, shiftByDays);
    if (newDate) {
      days[i].date = newDate;
      shifted++;
    }
  }
  if (shifted === 0) {
    return { refused: errors.badRequest("None of the affected days have a parseable date to shift") };
  }
  const lastDay = days[days.length - 1];
  // The fallback through the shifted last day covers rows with a mangled end_date.
  const newEndDate = addDaysISO(trip.endDate, shiftByDays) ?? computeExtendedEndDate(trip.endDate, lastDay.date);
  console.log(`[AI Assistant Apply] Shifted days ${dayNumber}-${lastDay.day_number} by +${shiftByDays}d, end_date → ${newEndDate ?? "unchanged"}`);
  return {
    newEndDate,
    // Whole-trip shift ("our outbound flight moved"): the start moves too.
    newStartDate: dayNumber === 1 ? addDaysISO(trip.startDate, shiftByDays) : null,
    dayCount: shifted,
    name: `Day ${dayNumber}–${lastDay.day_number} +${shiftByDays}d`,
  };
}

/**
 * One new day after the last. Checked against the STORED trip, not the preview:
 * the 14-day maximum must hold even if the trip grew since, and the number and
 * date are worked out here so a stale preview can't append a duplicate day or a
 * gap in the dates.
 */
function addDay(days: ItineraryDay[], day: ItineraryDay, trip: TripDates): Outcome {
  if (days.length >= MAX_TRIP_DAYS) {
    return {
      refused: errors.badRequest(`Trip is already at the ${MAX_TRIP_DAYS}-day maximum`, { code: CODES.tooManyDays, max: MAX_TRIP_DAYS }),
    };
  }
  const lastDay = days[days.length - 1];
  const appended: ItineraryDay = { ...day, day_number: (lastDay?.day_number ?? days.length) + 1 };
  const recomputedDate = nextDateISO([lastDay?.date, trip.endDate]);
  if (recomputedDate) appended.date = recomputedDate;
  if (lastDay?.city && !appended.city) appended.city = lastDay.city;
  days.push(appended);
  const newEndDate = computeExtendedEndDate(trip.endDate, appended.date);
  console.log(`[AI Assistant Apply] Appending Day ${appended.day_number} (${appended.date}), end_date → ${newEndDate ?? "unchanged"}`);
  return {
    newEndDate,
    dayNumber: appended.day_number,
    // Badge name: the day's theme reads best ("Day 12 added · Fjord day");
    // fall back to the first activity so it never says "Schedule".
    name: appended.theme || appended.activities[0]?.name,
  };
}

/**
 * Replaces matching days in place; days the draft didn't cover stay untouched.
 * Days past the end are new days the assistant added ("aggiungi altri 7
 * giorni"), which move the end date and so stay with the owner.
 */
function applyDraft(days: ItineraryDay[], revisedDays: ItineraryDay[], trip: TripDates, role: AssistantRole): Outcome {
  const indexByNumber = new Map(days.map((d, i) => [d.day_number, i] as const));
  const lastNumber = days[days.length - 1]?.day_number ?? days.length;
  const appended: ItineraryDay[] = [];
  let firstChanged: number | undefined;
  let updated = 0;
  for (const revised of revisedDays) {
    const idx = indexByNumber.get(revised?.day_number);
    if (idx === undefined) {
      if (revised?.day_number > lastNumber && Array.isArray(revised.activities) && revised.activities.length > 0) {
        appended.push(revised);
      }
      continue; // unknown day: skip
    }
    // Identity fields stay pinned to the stored day (defense in depth — the
    // assistant route already pins them, see structural.ts).
    days[idx] = { ...revised, day_number: days[idx].day_number, date: days[idx].date, city: days[idx].city };
    if (updated === 0) firstChanged = days[idx].day_number;
    updated++;
  }

  let newEndDate: string | null = null;
  if (appended.length > 0) {
    if (role !== "owner") {
      return { refused: errors.forbidden(ASSISTANT_DATES_OWNER_ONLY_MESSAGE, CODES.datesOwnerOnly) };
    }
    const cap = maxTripDays(days);
    if (days.length + appended.length > cap) {
      return { refused: errors.badRequest(`Trips can have at most ${cap} days`, { code: CODES.tooManyDays, max: cap }) };
    }
    // Numbered and dated from the STORED last day, as addDay does, so a stale
    // preview can't leave a gap or a duplicate day.
    for (const day of appended.sort((a, b) => a.day_number - b.day_number)) {
      const last = days[days.length - 1];
      const date = nextDateISO([last?.date, trip.endDate]);
      const city = day.city || last?.city;
      days.push({
        ...day,
        day_number: (last?.day_number ?? days.length) + 1,
        ...(date ? { date } : {}),
        ...(city ? { city } : {}),
      });
    }
    if (updated === 0) firstChanged = lastNumber + 1;
    newEndDate = computeExtendedEndDate(trip.endDate, days[days.length - 1].date);
    updated += appended.length;
  }
  if (updated === 0) {
    return { refused: errors.badRequest("None of the revised days matched the trip", { code: CODES.outdated }) };
  }
  console.log(
    `[AI Assistant Apply] Applied draft revision to ${updated} day(s)${appended.length ? `, ${appended.length} added, end_date → ${newEndDate ?? "unchanged"}` : ""}`,
  );
  return { newEndDate, dayNumber: firstChanged, dayCount: updated };
}

/**
 * A refusal when the change would touch a fixed plan. This is what persists, and
 * it can be called directly, so it enforces the rule itself rather than trusting
 * the proposal step. Fixed plans stay the user's: removable by hand in the
 * fixed-plans panel, never by the AI.
 */
function fixedPlanRefusal(change: ApplyChangeRequest, days: ItineraryDay[]): NextResponse | null {
  const { changeType, oldActivity, activity, dayNumber } = change;
  const dayIndex = dayNumber - 1;
  const target =
    changeType === "replace" || changeType === "remove"
      ? oldActivity
      : changeType === "adjust_duration"
        ? activity
        : undefined;

  if (target) {
    const held = days[dayIndex]?.activities.find((a) => a.id === target.id || a.name === target.name);
    if (isLockedActivity(held)) {
      return errors.badRequest(
        `"${held?.name}" is a fixed plan and can't be changed here. Edit it in the trip's fixed plans instead.`,
        { code: CODES.locked, names: [held?.name].filter(Boolean) }
      );
    }
    return null;
  }
  if (changeType === "apply_draft") {
    // Only the days being replaced: the assistant's multi-day edits leave a day
    // with a fixed plan alone, and so may this write.
    const replacing = new Set((change.days ?? []).map((d) => d?.day_number));
    const locked = days.filter((d) => replacing.has(d.day_number)).flatMap((d) => lockedActivityNames(d));
    if (locked.length > 0) {
      return errors.badRequest(
        `Days built around fixed plans (${locked.slice(0, 3).join(", ")}) can't be rewritten.`,
        { code: CODES.locked, names: locked }
      );
    }
  }
  if (changeType === "shift_days") {
    // Shifting dates would silently move date-pinned commitments (a booked
    // flight, a wedding) to days they don't belong to.
    const locked = days.slice(dayIndex).flatMap((d) => lockedActivityNames(d));
    if (locked.length > 0) {
      return errors.badRequest(
        `Days ${dayNumber} onward include fixed plans (${locked.slice(0, 3).join(", ")}) whose dates can't be moved.`,
        { code: CODES.locked, names: locked }
      );
    }
  }
  return null;
}

function make(change: ApplyChangeRequest, days: ItineraryDay[], trip: TripDates, role: AssistantRole): Outcome {
  const { changeType, dayNumber, oldActivity, newActivity, activity, oldDuration, newDuration, day, shiftByDays } = change;
  const onDay = days[dayNumber - 1];
  if (changeType === "replace" && oldActivity && newActivity) return replaceActivity(onDay, oldActivity, newActivity);
  if (changeType === "add" && newActivity) return addActivity(onDay, newActivity, dayNumber);
  if (changeType === "remove" && oldActivity) return removeActivity(onDay, oldActivity, dayNumber);
  if (changeType === "adjust_duration" && activity && newDuration !== undefined) {
    return adjustDuration(onDay, activity, oldDuration, newDuration);
  }
  if (changeType === "shift_days" && typeof shiftByDays === "number") return shiftDays(days, dayNumber, shiftByDays, trip);
  if (changeType === "add_day" && day) return addDay(days, day, trip);
  if (changeType === "apply_draft" && change.days) return applyDraft(days, change.days, trip, role);
  // invalidChange lets through only what is made above. Going on would save the
  // unchanged trip and report a success.
  throw new Error(`No way to make this ${changeType} change`);
}

/**
 * The trip's days with the change made, or the refusal to answer with. Works on
 * a copy of `itinerary`. Nothing is written here: the route writes the result.
 */
export function applyChange(
  change: ApplyChangeRequest,
  trip: TripDates & { itinerary: ItineraryDay[] },
  role: AssistantRole
): { refused: NextResponse; applied?: undefined } | { refused?: undefined; applied: AppliedChange } {
  const { changeType, dayNumber, newActivity, activity } = change;
  const dayIndex = dayNumber - 1;

  // add_day APPENDS: its dayNumber sits one past the current end by design, so
  // an in-range check would always reject it. Nor does it apply to apply_draft:
  // its days are matched one by one, and the page sends the first changed day,
  // which is a new day when days are added.
  if (changeType !== "add_day" && changeType !== "apply_draft" && (dayIndex < 0 || dayIndex >= trip.itinerary.length)) {
    return { refused: errors.badRequest("Invalid day number", { code: CODES.outdated }) };
  }

  const days: ItineraryDay[] = JSON.parse(JSON.stringify(trip.itinerary));
  const fixedPlan = fixedPlanRefusal(change, days);

  const made = make(change, days, trip, role);
  if (made.refused) return { refused: made.refused };

  return {
    applied: {
      // Every activity needs an id for drag and edit: the assistant route
      // stamps them, but this can be called directly.
      days: changeType === "add_day" || changeType === "apply_draft" ? ensureActivityIds(days) : days,
      newEndDate: made.newEndDate ?? null,
      newStartDate: made.newStartDate ?? null,
      dayNumber: made.dayNumber ?? dayNumber,
      ...(made.dayCount !== undefined ? { dayCount: made.dayCount } : {}),
      name: made.name || newActivity?.name || activity?.name || "Schedule",
    },
  };
}
