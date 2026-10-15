/**
 * POST /api/day/[tripId]/[date]/share — "Send to the group" on the signed day
 * page, opened from the owner's in-trip digest. Body: { s }, the day's send
 * key (lib/trips/day-link.ts). That key is the only access check: the owner
 * may be signed out on the phone they read the email on.
 *
 * Returns the trip's share link, opened on that day, and creates the link
 * first when the trip has none, as the owner's Share button would. It is
 * created only here, on the tap, never when the page is viewed, so a mail
 * scanner opening the email's link cannot share the trip.
 */
import { NextRequest, after } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { tripDayNumber, verifyDayLink } from "@/lib/trips/day-link";
import { buildShareUrl } from "@/lib/trips/share-url";
import { logFunnelEventServer } from "@/lib/analytics/funnel-events";
import { captureServerEvent } from "@/lib/posthog/server";
import { enrichTripByIdAdmin } from "@/lib/images/enrichTrip";

const BodySchema = z.object({ s: z.string().max(100) });

interface RouteContext {
  params: Promise<{ tripId: string; date: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { tripId, date } = await params;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errors.badRequest("Body must be valid JSON");
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return errors.badRequest("Missing send key");

  const check = verifyDayLink(tripId, date, parsed.data.s, Date.now(), "send");
  if (!check.ok) {
    return check.reason === "expired" ? errors.gone("This link has expired", "EXPIRED") : errors.forbidden("Invalid link");
  }

  const id = tripId.toLowerCase();
  const admin = createAdminClient();
  const { data: trip, error } = await admin
    .from("trips")
    .select("id, user_id, share_token, visibility, start_date, end_date")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return errors.internal("Failed to load the trip", "DaySend");
  const day = trip ? tripDayNumber(trip.start_date, trip.end_date, date) : null;
  if (!trip || !trip.user_id || day === null) return errors.notFound("This day isn't available");

  let token = (trip.share_token as string | null) ?? null;
  let isNew = false;
  if (!token) {
    // Only where there is still no token, so two taps (or this and the Share
    // button together) end with one link.
    const minted = randomUUID();
    const { data: updated, error: updateError } = await admin
      .from("trips")
      .update({
        share_token: minted,
        shared_at: new Date().toISOString(),
        visibility: trip.visibility === "public" ? "public" : "shared",
      })
      .eq("id", id)
      .is("share_token", null)
      .select("share_token");
    if (updateError) return errors.internal("Failed to create the link", "DaySend");
    if (updated && updated.length > 0) {
      token = minted;
      isNew = true;
    } else {
      const { data: current } = await admin.from("trips").select("share_token").eq("id", id).maybeSingle();
      token = (current?.share_token as string | null) ?? null;
    }
    if (!token) return errors.internal("Failed to create the link", "DaySend");
  }

  const ownerId = trip.user_id as string;
  if (isNew) {
    // As POST /api/trips/[id]/share does for a new link; telemetry never fails the send.
    after(async () => {
      await logFunnelEventServer({
        event_type: "share_link_created",
        trip_id: id,
        user_id: ownerId,
        metadata: { via: "day_digest" },
      });
      await captureServerEvent(ownerId, "crew_link_created", { tripId: id, via: "day_digest" }).catch(() => {});
      await enrichTripByIdAdmin(id, "share");
    });
  }

  const url = new URL(await buildShareUrl(ownerId, token));
  url.searchParams.set("day", String(day));
  return apiSuccess({ url: url.toString(), isNew });
}
