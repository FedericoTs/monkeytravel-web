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

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type FunnelEventType =
  | "share_link_created"
  | "share_link_visited"
  | "vote_cast"
  | "plan_own_clicked"
  // 2026-09-02: an anonymous trip taken over by a signup (app/api/trips/claim).
  // The claim RPC also stamps trip_meta.claimed_at, so the count survives
  // funnel_events retention; this row carries the user for cohort joins.
  | "trip_claimed";

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

// The crawler / link-unfurler pattern lives with the visit classifier
// (share-visit-classifier.ts); re-exported here for existing imports.
export { CRAWLER_UA_RE } from "./share-visit-classifier";

/**
 * Record a recipient visit to /shared/[token] — funnel_events.share_link_visited.
 * The CALLER decides whether the render is a visit (classifySharedVisit in
 * share-visit-classifier.ts: a document navigation, not a crawler, not the
 * owner, on a trip that has an owner) and calls this only for "counted";
 * the same verdict gates the PostHog twin so the two counters stay
 * comparable. Before 2026-09-18 every render that passed the UA test was a
 * row: router fetches, owners and fleets on the demo trips included.
 *
 * `crewAsk` records how the link was framed (?vote=1 = the crew ask) as
 * metadata.crew_ask, so recipients per shared trip can be read by framing.
 */
export async function logSharedTripVisit(
  tripId: string,
  opts: { crewAsk: boolean } = { crewAsk: false }
): Promise<void> {
  try {
    const c = await cookies();
    const sessionId = c.get("mt_session_id")?.value ?? null;
    await logFunnelEventServer({
      event_type: "share_link_visited",
      trip_id: tripId,
      session_id: sessionId,
      metadata: { crew_ask: opts.crewAsk },
    });
  } catch {
    // never break the render
  }
}
