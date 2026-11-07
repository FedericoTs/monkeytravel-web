// app/api/funnel-event/route.ts
//
// UX10X Master Plan Phase 0.3 — endpoint for CLIENT-fired funnel events.
// Server-side loop events (share_link_created / share_link_visited /
// vote_cast) insert into funnel_events directly via the service-role helper
// (lib/analytics/funnel-events.ts); only the client-fired events need an
// HTTP endpoint: plan_own_clicked, fired from the /shared "plan your own"
// CTAs, and trip_card_shared, fired when the owner shares or downloads the
// trip card. Mirrors /api/wizard-event's composite IP+session rate limit and its
// anon-friendly insert (the funnel_events INSERT RLS policy enforces
// user_id IS NULL OR user_id = auth.uid(), so we pass auth.uid() when present
// and let the DB reject mismatches).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { errors } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import { writesTelemetry } from "@/lib/analytics/telemetry-env";
import { readJsonBody } from "@/lib/api/json-body";

// Which "plan your own" button on a trip page was pressed, so each can be read.
const PLAN_OWN_SURFACES = ["shared_footer", "public_footer", "public_top", "after_vote", "page_footer", "bottom_bar", "match"] as const;

const MATCH_SHARE_METHODS = ["native_image", "native_link", "whatsapp", "copy", "download"] as const;

// Only the client-fired events are accepted here; server events never POST.
const BodySchema = z.union([
  z.object({
    event_type: z.literal("plan_own_clicked"),
    trip_id: z.string().uuid().optional(),
    destination: z.string().trim().max(120).optional(),
    referral_code: z.string().trim().max(64).optional(),
    surface: z.enum(PLAN_OWN_SURFACES).optional(),
  }),
  z.object({
    event_type: z.literal("trip_card_shared"),
    trip_id: z.string().uuid(),
    format: z.enum(["story", "square"]),
    method: z.enum(["native_share", "download"]),
  }),
  // A "Where should I go?" result, which belongs to no trip.
  z.object({
    event_type: z.literal("trip_card_shared"),
    kind: z.literal("match"),
    method: z.enum(MATCH_SHARE_METHODS),
  }),
]);

function metadataOf(body: z.infer<typeof BodySchema>) {
  if (body.event_type === "plan_own_clicked") {
    return {
      destination: body.destination ?? null,
      referral_code: body.referral_code ?? null,
      ...(body.surface ? { surface: body.surface } : {}),
    };
  }
  return "kind" in body ? { kind: body.kind, method: body.method } : { format: body.format, method: body.method };
}

// Composite IP + session limiter, same shape as /api/wizard-event: the IP
// bucket catches cookie-rotation abuse, the session bucket catches a stuck
// client loop. Both Upstash-backed so state is consistent across Vercel
// instances. Generous IP ceiling for shared NAT (offices/cafes).
const ipLimiter = createRateLimiter("funnel-event-ip", 300, 60 * 1000);
const sessionLimiter = createRateLimiter("funnel-event-session", 60, 60 * 1000);

export async function POST(request: NextRequest) {
  const { body: raw, invalidBody } = await readJsonBody<unknown>(request);
  if (invalidBody) return invalidBody;

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return errors.badRequest("Invalid funnel event payload", {
      issues: parsed.error.issues,
    });
  }
  const body = parsed.data;

  const rawSession = request.cookies.get("mt_session_id")?.value;
  const sessionId = rawSession || "no_session";

  const ipCheck = await ipLimiter.check(request);
  if (!ipCheck.allowed) {
    return errors.rateLimit("Too many events from this IP");
  }
  const sessionCheck = await sessionLimiter.check(request, sessionId);
  if (!sessionCheck.allowed) {
    return errors.rateLimit("Too many events for this session");
  }

  // Previews, local dev and the CI e2e build write only tagged probes.
  if (!writesTelemetry(rawSession)) {
    return new NextResponse(null, { status: 204 });
  }

  // Optional auth — the /shared visitor is almost always anonymous.
  const supabase = await createClient();
  let userId: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  const { error } = await supabase.from("funnel_events").insert({
    event_type: body.event_type,
    trip_id: "trip_id" in body ? (body.trip_id ?? null) : null,
    session_id: rawSession ?? null,
    user_id: userId,
    metadata: metadataOf(body),
  });

  if (error) {
    // Non-fatal for the client (it's already navigating), but surface to
    // Sentry/Vercel so a broken insert path doesn't fail silently.
    console.error("[FunnelEvent] insert failed:", error);
    return errors.internal("Failed to record funnel event", "funnel-event");
  }

  return new NextResponse(null, { status: 204 });
}
