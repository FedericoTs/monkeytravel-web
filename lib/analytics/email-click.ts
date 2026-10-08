import { after } from "next/server";
import { isAnalyticsBot } from "@/lib/analytics/bot-detection";
import { writesTelemetry } from "@/lib/analytics/telemetry-env";

/**
 * Clicks on reminder, digest, follow-up and finish-trip emails, whose links carry
 * `?slot=<queue slot>` (app/api/cron/scheduled-notifications) that nothing
 * read. The middleware records each counted view carrying a known slot as
 * funnel_events `email_clicked`, before any sign-in or share-link redirect.
 */

const EMAIL_SLOT_RE =
  /^(?:pack_early_14d|visa_check_7d|weather_3d|confirm_1d|morning_of|followup_(?:return_3d|next_21d|final_45d|dormant)|in_trip_day_(?:[2-9]|1\d|2[01])|finish_trip_1d)$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EmailClick {
  slot: string;
  /** Where the link opened: the owner's trip, a signed day link, a share link or the wizard. */
  page: "trip" | "day" | "shared" | "wizard" | "other";
  tripId: string | null;
}

/** The email a landing URL came from, or null when it carries no known slot. */
export function emailClickFromUrl(url: URL): EmailClick | null {
  const slot = url.searchParams.get("slot");
  if (!slot || !EMAIL_SLOT_RE.test(slot)) return null;
  const path = url.pathname.replace(/^\/(?:en|es|it|pt)(?=\/|$)/, "") || "/";
  const trip = path.match(/^\/trips\/([^/]+)\/?$/);
  if (trip && UUID_RE.test(trip[1])) return { slot, page: "trip", tripId: trip[1].toLowerCase() };
  const day = path.match(/^\/day\/([^/]+)\/\d{4}-\d{2}-\d{2}\/?$/);
  if (day && UUID_RE.test(day[1])) return { slot, page: "day", tripId: day[1].toLowerCase() };
  if (path === "/trips/new") return { slot, page: "wizard", tripId: null };
  if (path.startsWith("/shared/")) return { slot, page: "shared", tripId: null };
  return { slot, page: "other", tripId: null };
}

interface RequestLike {
  nextUrl: URL;
  headers: { get(name: string): string | null };
}

/**
 * Insert with the public key, handed to after() like the page_views row: its
 * policy only takes a null user_id, so `signed_in` says whether the click
 * carried a session. `navigate` is false for clients that send no fetch
 * metadata, such as mail link scanners.
 */
export function trackEmailClick(request: RequestLike, sessionId: string | null, userId?: string): void {
  const click = emailClickFromUrl(request.nextUrl);
  if (!click || !writesTelemetry(sessionId)) return;
  if (isAnalyticsBot(request.headers.get("user-agent"))) return;
  try {
    after(fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/funnel_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        event_type: "email_clicked",
        trip_id: click.tripId,
        session_id: sessionId,
        metadata: {
          slot: click.slot,
          page: click.page,
          signed_in: Boolean(userId),
          navigate: request.headers.get("sec-fetch-mode") === "navigate",
        },
      }),
    }).catch(() => {}));
  } catch {
    // Telemetry never breaks the response.
  }
}
