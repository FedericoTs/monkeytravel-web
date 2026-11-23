/**
 * POST /api/trips/[id]/participants/[participantId]/fit — the owner fits in
 * what someone going doesn't want to miss
 *
 * Owner only. The participant's picks that the plan doesn't hold yet go in
 * where they fit, through the same question a new plan's must-dos get
 * (lib/ai/must-dos.ts), and each stop put in says whose pick it is. Written
 * onto the plan as it is stored by then (lib/trips/itinerary-cas.ts). The
 * answer holds the plan it was written onto, for Undo, and the version the
 * new one was written at, for the page to adopt.
 *
 * DELETE — after an Undo: the picks count as not fitted again, so the owner is
 * offered them again.
 */
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyTripOwnership } from "@/lib/api/auth";
import { errors, apiError, apiSuccess } from "@/lib/api/response-wrapper";
import type { RouteContext } from "@/lib/api/route-context";
import { isUuid } from "@/lib/utils/uuid";
import { readPicks } from "@/lib/participants/shared";
import { askForMustDos, missingMustDos, withMustDos } from "@/lib/ai/must-dos";
import { DEFAULT_LANGUAGE, tripLocale } from "@/lib/ai/language";
import { getTripDestination } from "@/lib/trips/destination";
import { casUpdateItinerary } from "@/lib/trips/itinerary-cas";
import { ensureActivityIds } from "@/lib/utils/activity-id";
import { GeminiCostMeter } from "@/lib/ai/gemini-cost";
import { blockedCall, checkApiAccess, logApiCall } from "@/lib/api-gateway";
import { checkUsageLimit, incrementUsage } from "@/lib/usage-limits";
import { captureServerEvent } from "@/lib/posthog/server";
import type { ItineraryDay } from "@/types";

type Ctx = RouteContext<{ id: string; participantId: string }>;

const ENDPOINT = "/api/trips/participants/fit";

/** The days with each stop that isn't one of `before`'s marked as `name`'s pick (none without a name). */
function markedAsPicks(days: ItineraryDay[], before: ItineraryDay[], name: string | null): ItineraryDay[] {
  if (!name) return days;
  const there = new Set(before.flatMap((d) => d.activities ?? []));
  return days.map((d) => ({ ...d, activities: (d.activities ?? []).map((a) => (there.has(a) ? a : { ...a, picked_by: name })) }));
}

export async function DELETE(_request: NextRequest, context: Ctx) {
  try {
    const { id, participantId } = await context.params;
    if (!id || !isUuid(id) || !participantId || !isUuid(participantId)) return errors.badRequest("Invalid id");
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return errors.unauthorized("Sign in required");
    const admin = createAdminClient();
    const { trip, errorResponse: ownerError } = await verifyTripOwnership(admin, id, auth.user.id);
    if (ownerError) return ownerError;
    const { error } = await admin.from("trip_participants").update({ picks_placed_at: null }).eq("id", participantId).eq("trip_id", trip.id);
    if (error) {
      console.error("[Fit picks] reset failed:", error);
      return errors.internal("Could not reset the must-dos", "FitPicks");
    }
    return apiSuccess({ reset: true });
  } catch (err) {
    console.error("[Fit picks] Unexpected error:", err);
    return errors.internal("Internal server error", "FitPicks");
  }
}

export async function POST(request: NextRequest, context: Ctx) {
  // What this request's model call costs (lib/ai/gemini-cost.ts).
  const geminiCost = new GeminiCostMeter();
  return geminiCost.run(() => fit(request, context, geminiCost));
}

async function fit(_request: NextRequest, context: Ctx, geminiCost: GeminiCostMeter) {
  const startTime = Date.now();
  try {
    const { id, participantId } = await context.params;
    if (!id || !isUuid(id) || !participantId || !isUuid(participantId)) return errors.badRequest("Invalid id");

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return errors.unauthorized("Sign in required");
    const user = auth.user;

    const admin = createAdminClient();
    const { trip, errorResponse: ownerError } = await verifyTripOwnership(
      admin,
      id,
      user.id,
      "id, user_id, title, trip_meta, itinerary, itinerary_version"
    );
    if (ownerError) return ownerError;

    // Picks come through the share link only, from someone still going.
    const { data: guest, error: guestError } = await admin
      .from("trip_participants")
      .select("id, display_name, picks, source, left_at")
      .eq("id", participantId)
      .eq("trip_id", trip.id)
      .maybeSingle();
    if (guestError) {
      console.error("[Fit picks] participant read failed:", guestError);
      return errors.internal("Could not read the must-dos", "FitPicks");
    }
    const picks = guest && !guest.left_at && guest.source !== "public" ? readPicks(guest.picks) : [];
    if (picks.length === 0) return errors.notFound("No must-dos to fit");
    const name = typeof guest!.display_name === "string" && guest!.display_name.trim() ? guest!.display_name.trim() : null;

    // Not noted, the plan stays as written and the picks are only offered again.
    const markPlaced = async () => {
      const { error } = await admin
        .from("trip_participants")
        .update({ picks_placed_at: new Date().toISOString() })
        .eq("id", participantId)
        .eq("trip_id", trip.id);
      if (error) console.error("[Fit picks] could not note the picks as fitted:", error);
    };

    const days = (Array.isArray(trip.itinerary) ? trip.itinerary : []) as ItineraryDay[];
    const missing = missingMustDos(picks, days);
    if (missing.length === 0) {
      await markPlaced();
      return apiSuccess({ added: [], notFitted: [], itinerary: null });
    }

    const access = await checkApiAccess("gemini");
    if (!access.allowed) {
      return blockedCall(access, {
        apiName: "gemini",
        endpoint: ENDPOINT,
        startTime,
        metadata: { user_id: user.id, trip_id: trip.id },
        disabled: "Fitting in must-dos is currently disabled",
      });
    }
    // The same monthly allowance as a regenerated day: it is a model call on the trip.
    const usage = await checkUsageLimit(user.id, "aiRegenerations", user.email);
    if (!usage.allowed) return errors.rateLimit(usage.message || "Monthly limit reached.", { usage, upgradeUrl: "/pricing" });

    const destination = getTripDestination(trip as { title?: string; trip_meta?: unknown });
    const language = tripLocale(trip.trip_meta) ?? DEFAULT_LANGUAGE;
    const { answer } = await askForMustDos(destination, days, missing, language);
    const log = (status: number, extra: Record<string, unknown> = {}) =>
      logApiCall({
        apiName: "gemini",
        endpoint: ENDPOINT,
        status,
        responseTimeMs: Date.now() - startTime,
        cacheHit: false,
        costUsd: geminiCost.usd,
        exactCost: true,
        metadata: { user_id: user.id, trip_id: trip.id, asked: missing.length, ...extra },
      });
    // No answer at all: the question failed or timed out, which isn't "it doesn't fit".
    if (!Array.isArray((answer as { added?: unknown }).added)) {
      await log(503, { not_asked: true });
      return apiError("Couldn't fit them in right now. Please try again.", { status: 503, code: "NOT_ASKED" });
    }

    // Placed on the plan as it is stored when written, recomputed there if a save landed meanwhile.
    let written = null as { previous: ItineraryDay[]; added: string[] } | null;
    const outcome = await casUpdateItinerary(supabase, {
      tripId: trip.id,
      ownerId: user.id,
      from: { itinerary: days, itinerary_version: Number(trip.itinerary_version ?? 0) },
      change: (row) => {
        const current = (Array.isArray(row.itinerary) ? row.itinerary : []) as ItineraryDay[];
        const placed = withMustDos(current, missing, answer);
        if (placed.added.length === 0) return null;
        written = { previous: current, added: placed.added };
        return { itinerary: ensureActivityIds(markedAsPicks(placed.days, current, name)) };
      },
    });

    if (outcome.status === "busy") {
      await log(409, { error: "busy" });
      return apiError("This trip is being edited right now. Please try again.", { status: 409, code: "ITINERARY_BUSY" });
    }
    if (outcome.status === "missing") {
      await log(404);
      return errors.notFound("Trip not found");
    }
    await markPlaced();
    await incrementUsage(user.id, "aiRegenerations", 1);
    const result = outcome.status === "written" ? written : null;
    const added = result?.added ?? [];
    await log(200, { added: added.length });
    captureServerEvent(user.id, "participant_picks_fitted", { trip_id: trip.id, asked: missing.length, added: added.length });
    if (outcome.status !== "written" || !result) {
      return apiSuccess({ added: [], notFitted: missing, itinerary: null });
    }
    return apiSuccess({
      added,
      notFitted: missing.filter((m) => !added.includes(m)),
      itinerary: outcome.itinerary,
      previousItinerary: result.previous,
      fromVersion: outcome.fromVersion,
      itineraryVersion: outcome.itineraryVersion,
    });
  } catch (err) {
    console.error("[Fit picks] Unexpected error:", err);
    return errors.internal("Internal server error", "FitPicks");
  }
}
