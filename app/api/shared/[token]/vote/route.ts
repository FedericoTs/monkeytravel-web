/**
 * POST /api/shared/[token]/vote
 *
 * Anonymous thumbs-up/down on a single activity in a shared trip. No auth
 * required — possession of the share token is sufficient. Voter identity is
 * a cookie-issued opaque id (mt_anon_voter); same browser revoting on the
 * same activity updates the existing row.
 *
 * Body: { activity_id, vote_type ('up'|'down'|null), display_name?, comment? }
 *   - vote_type === null removes the voter's vote on this activity.
 *
 * Returns: { up: number, down: number, myVote: 'up'|'down'|null }
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import { createAdminClient } from "@/lib/supabase/admin";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { createRateLimiter } from "@/lib/api/rate-limit";
import type { InviteTokenRouteContext } from "@/lib/api/route-context";

const COOKIE_NAME = "mt_anon_voter";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year — votes are durable

// Cookie-reset abuse guard: an attacker who curls in a loop with no cookie
// would get a fresh voter id minted on every request and ballot-stuff. We
// cap per-IP attempts well above honest usage (a real voter casts <5 votes
// in a session) so legit no-cookie first-time voters still go through.
const voteLimiter = createRateLimiter("shared-vote", 20, 60_000); // 20 votes/min/IP

// Bot UAs that should never hit this endpoint without a cookie — they're
// almost always abuse scripts. Honest browsers always send a UA and never
// match these prefixes.
const BOT_UA_REGEX = /^(curl|wget|python-requests|httpie|go-http-client|libwww-perl|scrapy)\b/i;

interface VoteRequestBody {
  activity_id?: unknown;
  vote_type?: unknown;
  display_name?: unknown;
  comment?: unknown;
}

function isUuid(token: string): boolean {
  // Loose check — Supabase will reject malformed uuids at query time anyway,
  // this just short-circuits obvious junk so we don't burn a roundtrip.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
}

export async function POST(request: NextRequest, context: InviteTokenRouteContext) {
  try {
    const { token } = await context.params;

    if (!token || !isUuid(token)) {
      return errors.badRequest("Invalid share token");
    }

    // Per-IP rate limit (20 votes/min). Honest voters cast a handful of
    // votes per session — this only bites scripted ballot-stuffers who
    // curl in a loop with no cookie to mint a fresh voter id every call.
    const { allowed } = voteLimiter.check(request);
    if (!allowed) {
      return errors.rateLimit("Too many votes. Please slow down.");
    }

    // Cookie-less requests from obvious scripting UAs are abuse. Honest
    // browsers always send a UA that doesn't match these. First-time
    // voters from real browsers (no cookie yet) still pass through.
    const existingCookie = (await cookies()).get(COOKIE_NAME)?.value;
    if (!existingCookie) {
      const ua = request.headers.get("user-agent") ?? "";
      if (!ua || BOT_UA_REGEX.test(ua)) {
        return errors.badRequest("Invalid request");
      }
    }

    const body = (await request.json().catch(() => null)) as VoteRequestBody | null;
    if (!body || typeof body !== "object") {
      return errors.badRequest("Invalid request body");
    }

    const { activity_id, vote_type, display_name, comment } = body;

    if (typeof activity_id !== "string" || activity_id.length === 0 || activity_id.length > 100) {
      return errors.badRequest("Invalid activity_id");
    }

    if (vote_type !== null && vote_type !== "up" && vote_type !== "down") {
      return errors.badRequest("Invalid vote_type — must be 'up', 'down', or null");
    }

    // Optional fields — trim and bound, but don't reject missing.
    const displayName =
      typeof display_name === "string" && display_name.trim().length > 0
        ? display_name.trim().slice(0, 60)
        : null;
    const commentText =
      typeof comment === "string" && comment.trim().length > 0
        ? comment.trim().slice(0, 500)
        : null;

    const supabase = createAdminClient();

    // Resolve token → trip. We need the trip id for the FK and to confirm the
    // share link is real (defends against random uuids in the URL bar).
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("share_token", token)
      .single();

    if (tripError || !trip) {
      return errors.notFound("Shared trip not found");
    }

    // Read or mint the voter cookie. httpOnly so the page can't read it —
    // forces all voter-identity logic through this route.
    const cookieStore = await cookies();
    let voterCookieId = cookieStore.get(COOKIE_NAME)?.value;
    let issuedCookie = false;
    if (!voterCookieId || voterCookieId.length < 10 || voterCookieId.length > 60) {
      voterCookieId = nanoid(21); // ~zero-collision over the projected user base
      issuedCookie = true;
    }

    if (vote_type === null) {
      // Remove existing vote (if any). No-op if not present.
      const { error: deleteError } = await supabase
        .from("anonymous_activity_votes")
        .delete()
        .eq("trip_id", trip.id)
        .eq("activity_id", activity_id)
        .eq("voter_cookie_id", voterCookieId);

      if (deleteError) {
        console.error("[Shared Vote] Delete failed:", deleteError);
        return errors.internal("Failed to remove vote", "SharedVote");
      }
    } else {
      // Upsert. The UNIQUE (trip_id, activity_id, voter_cookie_id) constraint
      // makes this a clean update-or-insert. We bump updated_at via trigger.
      //
      // Note: when display_name/comment are omitted on revote, we deliberately
      // preserve the existing values by only writing them when non-null.
      const upsertRow: Record<string, unknown> = {
        trip_id: trip.id,
        activity_id,
        share_token: token,
        voter_cookie_id: voterCookieId,
        vote_type,
      };
      if (displayName !== null) upsertRow.voter_display_name = displayName;
      if (commentText !== null) upsertRow.comment = commentText;

      const { error: upsertError } = await supabase
        .from("anonymous_activity_votes")
        .upsert(upsertRow, { onConflict: "trip_id,activity_id,voter_cookie_id" });

      if (upsertError) {
        console.error("[Shared Vote] Upsert failed:", upsertError);
        return errors.internal("Failed to save vote", "SharedVote");
      }
    }

    // Recompute tallies for this activity. Two-query approach: one to count
    // (cheap on the (trip_id, activity_id) index) and one to find this
    // voter's row. We could fold this into a single SELECT but it's not the
    // hot path — keep it readable.
    const { data: tallyRows, error: tallyError } = await supabase
      .from("anonymous_activity_votes")
      .select("vote_type, voter_cookie_id")
      .eq("trip_id", trip.id)
      .eq("activity_id", activity_id);

    if (tallyError) {
      console.error("[Shared Vote] Tally fetch failed:", tallyError);
      return errors.internal("Failed to read vote tallies", "SharedVote");
    }

    let up = 0;
    let down = 0;
    let myVote: "up" | "down" | null = null;
    for (const row of tallyRows ?? []) {
      if (row.vote_type === "up") up++;
      else if (row.vote_type === "down") down++;
      if (row.voter_cookie_id === voterCookieId) {
        myVote = row.vote_type as "up" | "down";
      }
    }

    // Set/refresh the voter cookie. Cookies.set on a route response persists
    // through the NextResponse layer (Next 15 cookies() API).
    if (issuedCookie) {
      cookieStore.set({
        name: COOKIE_NAME,
        value: voterCookieId,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: COOKIE_MAX_AGE_SECONDS,
        path: "/",
      });
    }

    return apiSuccess({ activity_id, up, down, myVote });
  } catch (error) {
    console.error("[Shared Vote] Unexpected error:", error);
    return errors.internal("Unexpected error", "SharedVote");
  }
}
