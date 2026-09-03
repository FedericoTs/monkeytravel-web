/**
 * Validation for anonymous (signed-out) trip sharing.
 *
 * Everything here runs on a payload posted by a caller with no account, which
 * lands in a JSONB column and is then rendered on a public page. So the rules
 * are deliberately strict and the failure mode is always "reject", never
 * "coerce and hope".
 *
 * Kept out of the route handler so it can be unit-tested directly — the route
 * is a thin shell around `validateAnonymousTripPayload`.
 */

import { generateActivityId } from "@/lib/utils/activity-id";

/** Mirrors the multi-city trip-length cap enforced elsewhere in the wizard. */
export const MAX_TRIP_DAYS = 21;

/** How long an unclaimed anonymous trip survives before the sweeper may remove it. */
export const CLAIM_WINDOW_DAYS = 30;

/**
 * Raw body cap. The itinerary is attacker-controlled JSON heading for JSONB;
 * without a ceiling a single request could park megabytes in the table.
 */
export const MAX_BODY_BYTES = 256 * 1024;

export interface AnonymousTripInput {
  title: string;
  description: string;
  destination: string;
  startDate: string;
  endDate: string;
  itinerary: unknown[];
  coverImageUrl: string | null;
}

export type ValidationResult =
  | { ok: true; value: AnonymousTripInput }
  | { ok: false; error: string };

export function isIsoDate(v: unknown): v is string {
  // Strict yyyy-mm-dd. Date.parse alone accepts far too much ("Tuesday").
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  // Round-trip guards against calendar-invalid dates that still parse, e.g.
  // 2026-02-31 rolling forward to March.
  return new Date(t).toISOString().slice(0, 10) === v;
}

function clamp(v: unknown, max: number, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
}

/**
 * Cover images are rendered into an <img src> on the public share page, so only
 * an absolute https URL is allowed through. A bad value is dropped rather than
 * rejected — the page falls back to a gradient, and losing the photo is not a
 * reason to refuse someone's share link.
 */
export function sanitizeCoverImageUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString().slice(0, 1000) : null;
  } catch {
    return null;
  }
}

export function validateAnonymousTripPayload(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body." };
  }
  const b = body as Record<string, unknown>;

  const title = clamp(b.title, 200);
  const destination = clamp(b.destination, 200);
  // Description is NOT NULL in the trips table, so it always needs a value;
  // fall back to the destination rather than failing the share.
  const description = clamp(b.description, 2000, destination || "Trip");

  if (!title) return { ok: false, error: "Missing trip title." };
  if (!destination) return { ok: false, error: "Missing trip destination." };

  if (!isIsoDate(b.startDate) || !isIsoDate(b.endDate)) {
    return { ok: false, error: "Invalid trip dates." };
  }
  const start = b.startDate as string;
  const end = b.endDate as string;
  if (Date.parse(end) < Date.parse(start)) {
    return { ok: false, error: "Trip ends before it starts." };
  }

  if (!Array.isArray(b.itinerary) || b.itinerary.length === 0) {
    return { ok: false, error: "Trip has no itinerary." };
  }
  if (b.itinerary.length > MAX_TRIP_DAYS) {
    return { ok: false, error: `Trips are limited to ${MAX_TRIP_DAYS} days.` };
  }

  return {
    ok: true,
    value: {
      title,
      description,
      destination,
      startDate: start,
      endDate: end,
      itinerary: withActivityIds(b.itinerary),
      coverImageUrl: sanitizeCoverImageUrl(b.coverImageUrl),
    },
  };
}

/**
 * Stamp every activity with a stable id BEFORE the itinerary is stored.
 *
 * WHY THIS IS NOT OPTIONAL
 * ------------------------
 * Stored without ids, the itinerary is rendered by /shared/[token], which
 * calls `ensureActivityIds` — and that mints a fresh random id for any
 * activity missing one. So the server render and the client hydration
 * disagree (a real hydration mismatch on that page), and worse, EVERY page
 * load invents a new id for the same activity. Votes are keyed on that id, so
 * a vote is written against something nobody will ever look up again.
 *
 * Measured 2026-09-03: 78.1% of activities on anonymous trips had no stored
 * id, and 13 of the 51 anonymous votes ever cast (25%) already point at an
 * activity id that exists nowhere in their trip.
 *
 * Deliberately NOT `ensureActivityIds` from lib/utils/activity-id: that helper
 * assumes a well-formed ItineraryDay[] and throws on a day with no
 * `activities` array. This input is attacker-controlled JSON that has passed
 * only a length check, and days without activities are explicitly accepted
 * here — so anything it does not recognise is passed through untouched rather
 * than coerced or rejected. An existing id is never replaced: overwriting one
 * would orphan the votes already cast against it.
 */
function withActivityIds(itinerary: unknown[]): unknown[] {
  return itinerary.map((day) => {
    if (!day || typeof day !== "object" || Array.isArray(day)) return day;
    const activities = (day as { activities?: unknown }).activities;
    if (!Array.isArray(activities)) return day;
    return {
      ...(day as Record<string, unknown>),
      activities: activities.map((activity) => {
        if (!activity || typeof activity !== "object" || Array.isArray(activity)) return activity;
        const existing = (activity as { id?: unknown }).id;
        if (typeof existing === "string" && existing.length > 0) return activity;
        return { ...(activity as Record<string, unknown>), id: generateActivityId() };
      }),
    };
  });
}

/** Expiry stamp for a freshly minted anonymous trip. */
export function claimExpiryFrom(now: Date): string {
  return new Date(now.getTime() + CLAIM_WINDOW_DAYS * 24 * 60 * 60_000).toISOString();
}
