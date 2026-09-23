import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { isExploreUgcEnabled } from "@/lib/explore/flag";
import { captureServerEvent } from "@/lib/posthog/server";
import { runTripCounter } from "@/lib/explore/counters";
import { randomBytes } from "node:crypto";

/**
 * Trip-level Saves — POST = save to "for later", DELETE = unsave.
 *
 * Works for BOTH anonymous + authenticated visitors:
 *  - Auth → trip_saves row keyed by user_id (RLS-enforced).
 *  - Anon → trip_saves row keyed by saver_cookie_id (service-role
 *    bypass; RLS would otherwise reject an anon JWT writing on behalf
 *    of a cookie). The cookie is set on the response if missing.
 *
 * Why support anon: bookmarking is a low-friction first action, and
 * we want returning anon visitors to find their saved trips via the
 * cookie before they decide to sign up.
 *
 * Cookie spec: `mt_saver_cookie`, httpOnly, sameSite=lax, 1-year TTL,
 * 32-byte random hex. Opaque — no user identifier inside.
 */

type RouteCtx = { params: Promise<{ id: string }> };

const COOKIE_NAME = "mt_saver_cookie";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function generateCookieId(): string {
  return randomBytes(32).toString("hex");
}

/** Service-role client for anon writes (RLS would block the JWT-less path). */
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing for service client");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: NextRequest, { params }: RouteCtx) {
  if (!isExploreUgcEnabled()) return errors.notFound("Not Found");

  const { id: tripId } = await params;
  if (!tripId) return errors.badRequest("Trip id required");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Validate trip is publicly savable.
  const { data: trip, error: lookupErr } = await supabase
    .from("trips")
    .select("id, visibility, is_hidden")
    .eq("id", tripId)
    .single();
  if (lookupErr || !trip) return errors.notFound("Trip not found");
  if (trip.visibility !== "public" || trip.is_hidden) {
    return errors.notFound("Trip not found");
  }

  let cookieIdToSet: string | null = null;
  let insertErr: { code?: string } | null = null;

  if (user) {
    // Auth path — insert via RLS-respecting client.
    const r = await supabase
      .from("trip_saves")
      .insert({ trip_id: tripId, user_id: user.id });
    insertErr = r.error;
  } else {
    // Anon path — need cookie. Reuse existing or mint a new one.
    let cookieId = request.cookies.get(COOKIE_NAME)?.value;
    if (!cookieId) {
      cookieId = generateCookieId();
      cookieIdToSet = cookieId; // attach to response below
    }
    const r = await serviceClient()
      .from("trip_saves")
      .insert({ trip_id: tripId, saver_cookie_id: cookieId });
    insertErr = r.error;
  }

  if (insertErr) {
    if (insertErr.code === "23505") {
      // Duplicate save — idempotent. Return current count.
      const { data: cur } = await supabase
        .from("trips")
        .select("save_count")
        .eq("id", tripId)
        .single();
      const res = apiSuccess({ saved: true, count: cur?.save_count ?? 0 });
      return maybeSetCookie(res, cookieIdToSet);
    }
    return errors.internal("Failed to save trip", "trip_saves.insert");
  }

  // Only signed-in saves move the counter. An anonymous save is keyed by a
  // cookie the visitor controls: drop the cookie and the next request mints a
  // fresh one, so counting those would let anyone push any public trip's
  // save_count (and trending score) up without limit. They were never
  // counted in practice either: until 2026-09-23 this call ran on the
  // visitor's own client, and the anon role cannot execute the counter.
  let newCount: number | null = null;
  if (user) {
    newCount = await runTripCounter("increment_trip_save_count", tripId, "trip-save");
  } else {
    // The visitor sees their own save in the number next to the button they
    // just pressed; the stored count, which everyone else sees, leaves it out.
    const cur = await currentSaveCount(supabase, tripId);
    newCount = cur === null ? null : cur + 1;
  }

  void captureServerEvent(
    user?.id ?? "anon",
    "explore_trip_saved",
    { trip_id: tripId, is_anon: !user }
  );

  const res = apiSuccess({ saved: true, count: newCount ?? 1 });
  return maybeSetCookie(res, cookieIdToSet);
}

export async function DELETE(request: NextRequest, { params }: RouteCtx) {
  if (!isExploreUgcEnabled()) return errors.notFound("Not Found");

  const { id: tripId } = await params;
  if (!tripId) return errors.badRequest("Trip id required");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let deletedCount = 0;

  if (user) {
    const r = await supabase
      .from("trip_saves")
      .delete()
      .eq("trip_id", tripId)
      .eq("user_id", user.id)
      .select("id");
    if (r.error) return errors.internal("Failed to remove save", "trip_saves.delete");
    deletedCount = r.data?.length ?? 0;
  } else {
    const cookieId = request.cookies.get(COOKIE_NAME)?.value;
    if (cookieId) {
      const r = await serviceClient()
        .from("trip_saves")
        .delete()
        .eq("trip_id", tripId)
        .eq("saver_cookie_id", cookieId)
        .select("id");
      if (r.error) return errors.internal("Failed to remove save", "trip_saves.delete");
      deletedCount = r.data?.length ?? 0;
    }
  }

  // Mirror of POST: only a signed-in save was ever counted, so only a
  // signed-in unsave takes one off. Decrementing for an anonymous unsave
  // would subtract a save that someone signed in made.
  let count = 0;
  if (deletedCount > 0 && user) {
    const c = await runTripCounter("decrement_trip_save_count", tripId, "trip-unsave");
    count = c ?? 0;
  } else {
    count = (await currentSaveCount(supabase, tripId)) ?? 0;
  }

  return apiSuccess({ saved: false, count });
}

async function currentSaveCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripId: string
): Promise<number | null> {
  const { data: cur } = await supabase
    .from("trips")
    .select("save_count")
    .eq("id", tripId)
    .single();
  return cur?.save_count ?? null;
}

function maybeSetCookie(res: NextResponse, cookieIdToSet: string | null) {
  if (!cookieIdToSet) return res;
  res.cookies.set({
    name: COOKIE_NAME,
    value: cookieIdToSet,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}
