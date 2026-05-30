/**
 * Push a trip's activities into Google Calendar as discrete events.
 *
 * Phase 2 of calendar-export. Called from the OAuth callback after
 * a successful token exchange. Insert-only — Phase 2.5 will add
 * patch-or-insert reconciliation via `extendedProperties.private`.
 *
 * Event shape
 * -----------
 *   {
 *     summary: "<activity.name>",
 *     description: "<activity.description (capped)>\n\n<trip url>",
 *     location: "<activity.address || activity.location>",
 *     start: { dateTime: "<ISO>", timeZone: "<IANA or UTC>" },
 *     end:   { dateTime: "<ISO>", timeZone: "<IANA or UTC>" },
 *     extendedProperties: {
 *       private: {
 *         monkeytravel_trip_id: "<trip uuid>",
 *         monkeytravel_activity_id: "<deterministic id>",
 *       }
 *     }
 *   }
 *
 * Timezone
 * --------
 * For Phase 2 we use UTC — same call-out as `trip-to-events.ts`:
 * Apple/Google/Outlook render UTC-stamped events in the user's
 * local calendar tz when no source tz is asserted, which matches
 * how the iCal subscription feed behaves. Phase 2.5 will plumb the
 * destination IANA tz from Google Places.
 *
 * Idempotency
 * -----------
 * Per the PRD, deterministic activity ids in `extendedProperties.
 * private.monkeytravel_activity_id` let a future re-sync diff and
 * patch. Phase 2 itself is one-shot — re-running the OAuth dance
 * for the same trip will create duplicate events. That's an
 * accepted Phase 2 limitation; the success UX is "click connect →
 * see your events appear once" and we don't expose a re-sync
 * button yet.
 *
 * Failure modes
 * -------------
 * - Single event POST 4xx → record + count failure, keep going.
 *   Returns `status='partial'` if any failed but at least one
 *   succeeded; `status='failed'` if all failed.
 * - 401 / 403 → caller (callback route) should NOT retry; the
 *   token is rejected. We surface the upstream body in last_error
 *   for Sentry breadcrumb without logging the bearer token.
 */

import { tripToIcalEvents } from "./trip-to-events";
import type { IcalEvent } from "./ical";
import type { FeedTrip } from "./feed";

const CALENDAR_API =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Cap on description payload sent to Google. */
const MAX_DESCRIPTION_CHARS = 500;

export type SyncResult = {
  status: "ok" | "partial" | "failed";
  eventCount: number;
  attemptedCount: number;
  /** First non-OK upstream body (truncated) — handy for Sentry. */
  lastError?: string;
  /** The calendar id we wrote to. Stored in trip_calendar_syncs. */
  calendarId: string;
};

/**
 * Push every activity in `trip` to the user's primary Google
 * Calendar. `accessToken` is the freshly-exchanged bearer (we don't
 * refresh here — the callback hands us a live token).
 */
export async function syncTripToGoogle(opts: {
  trip: FeedTrip;
  accessToken: string;
}): Promise<SyncResult> {
  const events = tripToIcalEvents({
    id: opts.trip.id,
    title: opts.trip.title,
    itinerary: opts.trip.itinerary,
  });

  if (events.length === 0) {
    return {
      status: "ok",
      eventCount: 0,
      attemptedCount: 0,
      calendarId: "primary",
    };
  }

  let successCount = 0;
  let lastError: string | undefined;

  for (const ev of events) {
    try {
      const body = toGoogleEvent(ev, opts.trip.id);
      const res = await fetch(CALENDAR_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "<no body>");
        // Truncate so we don't blow row size on `last_error`.
        lastError = `${res.status} ${res.statusText} :: ${text.slice(0, 200)}`;
        continue;
      }
      successCount++;
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 200) : String(err);
    }
  }

  let status: SyncResult["status"];
  if (successCount === events.length) {
    status = "ok";
  } else if (successCount === 0) {
    status = "failed";
  } else {
    status = "partial";
  }

  return {
    status,
    eventCount: successCount,
    attemptedCount: events.length,
    lastError,
    calendarId: "primary",
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function toGoogleEvent(ev: IcalEvent, tripId: string) {
  // Reuse `ev.uid` as the stable activity id — it's already
  // `act-<tripId>-<dayIdx>-<actIdx>@monkeytravel.app`, perfect for
  // future patch-by-private-extended-property lookups.
  const activityId = ev.uid;

  const description =
    ev.description && ev.description.length > MAX_DESCRIPTION_CHARS
      ? ev.description.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd() + "…"
      : ev.description;

  // For Phase 2 we always emit a `timeZone` of UTC for the dateTime
  // form. Google requires the field when `dateTime` is used.
  const timeZone = ev.tzid ?? "UTC";

  return {
    summary: ev.summary,
    description,
    location: ev.location,
    start: { dateTime: ev.dtstart.toISOString(), timeZone },
    end: { dateTime: ev.dtend.toISOString(), timeZone },
    extendedProperties: {
      private: {
        monkeytravel_trip_id: tripId,
        monkeytravel_activity_id: activityId,
      },
    },
    // Source link surfaces on the Google event detail panel.
    source: {
      title: "MonkeyTravel",
      url: `https://monkeytravel.app/trips/${tripId}`,
    },
  };
}
