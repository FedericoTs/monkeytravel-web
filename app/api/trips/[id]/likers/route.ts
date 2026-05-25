import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { isExploreUgcEnabled } from "@/lib/explore/flag";

/**
 * GET /api/trips/[id]/likers?cursor=...
 *
 * Paginated list of users who liked this trip. Used by the avatar
 * cluster's "+N more" modal on /explore + trip pages.
 *
 * Page size: 50. Cursor = ISO timestamp of last row's created_at.
 * Public — anyone can see the full list of likers on a public trip
 * (same policy as the cluster on the card).
 *
 * Only liker display_name + avatar_url surface. No email, no user_id.
 */

type RouteCtx = { params: Promise<{ id: string }> };

const PAGE_SIZE = 50;

export async function GET(request: NextRequest, { params }: RouteCtx) {
  if (!isExploreUgcEnabled()) return errors.notFound("Not Found");

  const { id: tripId } = await params;
  if (!tripId) return errors.badRequest("Trip id required");

  const cursor = request.nextUrl.searchParams.get("cursor");

  const supabase = await createClient();

  // Trip must be public + visible.
  const { data: trip } = await supabase
    .from("trips")
    .select("id, visibility, is_hidden")
    .eq("id", tripId)
    .single();
  if (!trip || trip.visibility !== "public" || trip.is_hidden) {
    return errors.notFound("Trip not found");
  }

  // Join trip_likes -> profiles for display_name + avatar.
  // We use a foreign-key reference in the select so Supabase joins
  // the rows in one round trip. If the project doesn't expose a
  // `profiles` table, swap to a function-level join via service role.
  let query = supabase
    .from("trip_likes")
    .select(
      `created_at,
       user:profiles!trip_likes_user_id_fkey(display_name, avatar_url)`
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (cursor) {
    // cursor is the created_at of the last row from the previous page.
    query = query.lt("created_at", cursor);
  }

  const { data: rows, error } = await query;
  if (error) {
    // If profiles join fails (different schema in deployed env), fall
    // back to a names-less response so the modal still opens.
    console.warn("[trip-likers] profile join failed:", error.message);
    const { data: fallback } = await supabase
      .from("trip_likes")
      .select("created_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE + 1);
    const items = (fallback ?? []).slice(0, PAGE_SIZE).map(() => ({
      displayName: "Anonymous traveler",
      avatarUrl: null as string | null,
    }));
    const hasMore = (fallback?.length ?? 0) > PAGE_SIZE;
    return apiSuccess({
      likers: items,
      nextCursor: hasMore ? fallback?.[PAGE_SIZE - 1].created_at : null,
    });
  }

  const items = (rows ?? []).slice(0, PAGE_SIZE).map((r) => {
    const u = Array.isArray(r.user) ? r.user[0] : r.user;
    return {
      displayName:
        (u as { display_name?: string } | null)?.display_name ??
        "Anonymous traveler",
      avatarUrl: (u as { avatar_url?: string | null } | null)?.avatar_url ?? null,
    };
  });
  const hasMore = (rows?.length ?? 0) > PAGE_SIZE;
  const nextCursor = hasMore ? rows?.[PAGE_SIZE - 1].created_at : null;

  return apiSuccess({ likers: items, nextCursor });
}
