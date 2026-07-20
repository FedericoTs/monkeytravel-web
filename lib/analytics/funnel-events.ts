// lib/analytics/funnel-events.ts
//
// UX10X Master Plan Phase 0.3 — server-side writes into the funnel_events
// sink (the crew/share loop). Kept separate from wizard_step_events, which
// tracks the pre-generation wizard funnel; funnel_events tracks what happens
// to a trip AFTER it exists (share created/visited, votes, plan-own clicks).
//
// Every writer here is FIRE-AND-FORGET and swallows all errors — telemetry
// must never break the share/vote/render path it is attached to. Callers
// should `void logFunnelEventServer(...)` (do not await).
//
// Writes use the service-role admin client, so they bypass RLS and do not
// depend on the anon INSERT policy (that policy is only for the one
// client-fired event, plan_own_clicked, added in PR2c).

import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type FunnelEventType =
  | "share_link_created"
  | "share_link_visited"
  | "vote_cast"
  | "plan_own_clicked";

export interface FunnelEventInput {
  event_type: FunnelEventType;
  trip_id?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  anon_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Generic fire-and-forget funnel_events insert (service-role). */
export async function logFunnelEventServer(
  input: FunnelEventInput
): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from("funnel_events").insert({
      event_type: input.event_type,
      trip_id: input.trip_id ?? null,
      session_id: input.session_id ?? null,
      user_id: input.user_id ?? null,
      anon_id: input.anon_id ?? null,
      metadata: input.metadata ?? null,
    });
  } catch {
    // never break the caller
  }
}

// Obvious crawlers / link-unfurlers only. Deliberately does NOT match
// "whatsapp"/"telegram" — a human tapping a shared link opens it in the app's
// in-app browser with a normal Chrome/Safari UA; the "WhatsApp"/"TelegramBot"
// UA is the preview crawler. We accept a little unfurl inflation rather than
// risk dropping the exact humans (chat-app openers) the crew loop targets.
// Exported so the shared page's crew_link_visited PostHog capture applies the
// SAME filter — keeps the two visit counters comparable.
export const CRAWLER_UA_RE =
  /(bot\b|crawl|spider|slurp|facebookexternalhit|bingpreview|headless|python-requests|curl\/|wget|lighthouse|monitoring|uptime)/i;

/**
 * Record a real human visit to /shared/[token]. Fired from the shared page's
 * server render (once per render, AFTER the notFound guard). Skips crawlers so
 * the share-visit funnel isn't inflated by link-preview bots.
 */
export async function logSharedTripVisit(tripId: string): Promise<void> {
  try {
    const h = await headers();
    const ua = h.get("user-agent") || "";
    if (CRAWLER_UA_RE.test(ua)) return;
    const c = await cookies();
    const sessionId = c.get("mt_session_id")?.value ?? null;
    await logFunnelEventServer({
      event_type: "share_link_visited",
      trip_id: tripId,
      session_id: sessionId,
    });
  } catch {
    // never break the render
  }
}
