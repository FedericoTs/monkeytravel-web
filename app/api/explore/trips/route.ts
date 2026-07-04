import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { errors, apiSuccess } from "@/lib/api/response-wrapper";
import { isExploreUgcEnabled } from "@/lib/explore/flag";

/**
 * GET /api/explore/trips
 * Returns trending public trips with optional filters.
 *
 * **2026-05-25 (Week 1 of /explore UGC build)**: extended the response
 * to include author info + engagement counts (likes/saves/forks) +
 * Editor's Picks flag. NOTE: this GET is intentionally NOT gated by
 * EXPLORE_UGC_ENABLED — the existing /explore page (template/featured
 * trips) is already live + indexed and shouldn't 404 during the rollout
 * window. Only the WRITE endpoints (like/save/fork/publish/report) are
 * env-flag-gated.
 */
export async function GET(request: NextRequest) {
  // The `/explore` page is live and indexed — it ran on the LEGACY
  // schema (no like/save/fork/is_hidden/etc.) before the UGC build, and
  // it must keep working until BOTH the migration is applied AND the
  // env flag is set. So we branch the query shape on the flag:
  //   - flag OFF  → legacy SELECT, no new columns referenced. Safe even
  //                 if the migration hasn't been applied yet.
  //   - flag ON   → full SELECT with engagement/author/editors-pick
  //                 columns. Requires migration 20260525_explore_ugc_feed.
  // Migration: supabase/migrations/20260525_explore_ugc_feed.sql
  const ugcOn = isExploreUgcEnabled();

  try {
    const { searchParams } = new URL(request.url);

    // Parse filters
    const destination = searchParams.get("destination");
    const durationMin = searchParams.get("duration_min");
    const durationMax = searchParams.get("duration_max");
    const budgetTier = searchParams.get("budget");
    const tags = searchParams.get("tags")?.split(",").filter(Boolean);
    // 2026-05-28 — Tier 1.1 column is now live; we filter on the real
    // trips.travel_style column rather than parsing trip_meta JSONB.
    // Whitelist to avoid an arbitrary string flowing into the WHERE.
    const travelStyleParam = searchParams.get("travel_style");
    const travelStyle: "backpacker" | null =
      travelStyleParam === "backpacker" ? "backpacker" : null;
    // Bug-bounty 2026-05-24 P1: parseInt of arbitrary strings produces
    // NaN which then flowed into query.range(NaN, NaN) — undefined
    // Supabase behaviour. Clamp + default.
    const rawPage = parseInt(searchParams.get("page") || "1", 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawPerPage = parseInt(searchParams.get("per_page") || "12", 10);
    const perPage = Math.min(
      Number.isFinite(rawPerPage) && rawPerPage > 0 ? rawPerPage : 12,
      50
    );

    const supabase = await createClient();

    // Loose row shape: the new engagement/author/editors-pick fields
    // are optional because pre-migration they aren't in the SELECT.
    // Runtime fallbacks below (`|| 0`, `|| null`) handle missing values.
    type TripRow = {
      id: string;
      title: string;
      description: string | null;
      start_date: string;
      end_date: string;
      tags: string[] | null;
      cover_image_url: string | null;
      share_token: string;
      shared_at: string | null;
      public_slug: string | null;
      user_id: string | null;
      trending_score: number | null;
      view_count: number | null;
      template_copy_count: number | null;
      trip_meta: unknown;
      like_count?: number;
      save_count?: number;
      fork_count?: number;
      author_display_name?: string | null;
      author_note?: string | null;
      is_editors_pick?: boolean;
      travel_style?: "classic" | "backpacker" | null;
      // Joined from users — the author's public handle for the /creator link.
      // PostgREST embeds the related row under the relationship name.
      users?: { username: string | null } | null;
    };

    // Build query — column set depends on the flag (see top of handler).
    // The two literal SELECTs are kept side-by-side so Supabase's TS
    // plugin can parse each independently; we pick the right one at
    // runtime and cast to TripRow to bridge the union.
    const base = supabase
      .from("trips")
      .select(
        // 2026-05-29 FIX #188 — dropped `itinerary` + `budget` JSONB
        // from the SELECT: neither flowed through to the response
        // (itinerary was scanned only as a cover-image fallback, but
        // every published trip in prod already has cover_image_url
        // set — verified 7/7). `budget` had no consumer at all.
        // Wire format unchanged; payload ~10-20x lighter per row.
        // public_slug + user_id added 2026-07-03 for the indexable UGC
        // trip-page + creator-profile linking (card → /trip/{slug}, byline →
        // /creator/{username}). user_id feeds a batched, privacy-safe
        // username lookup below (never exposes email/payment handles).
        ugcOn
          ? "id, title, description, start_date, end_date, tags, cover_image_url, share_token, shared_at, public_slug, user_id, trending_score, view_count, template_copy_count, trip_meta, like_count, save_count, fork_count, author_display_name, author_note, is_editors_pick, travel_style"
          : "id, title, description, start_date, end_date, tags, cover_image_url, share_token, shared_at, public_slug, user_id, trending_score, view_count, template_copy_count, trip_meta",
        { count: "exact" }
      )
      .eq("visibility", "public")
      .not("share_token", "is", null)
      .not("submitted_to_trending_at", "is", null)
      .order("trending_score", { ascending: false })
      .order("shared_at", { ascending: false });

    // is_hidden column is only present post-migration. Apply the filter
    // only when the flag is on (post-migration). Pre-migration there's
    // nothing to hide anyway.
    let query = ugcOn ? base.eq("is_hidden", false) : base;

    // Apply filters
    if (destination) {
      // Day-5 backstop on top of Day-4 P1.2: PostgREST `.or()` syntax
      // uses comma as the clause separator. Backslash-escaping commas
      // inside a value (the old approach below) does NOT work — PostgREST
      // still parses them as separators and returns 400. Live logs caught
      // 5 such 400s for "Paris, France" / "Tokyo, Japan" / "Rome, Italy"
      // / "Barcelona, Spain" / "Parigi, Francia" — the /destinations/[slug]
      // page calls fetchExploreFeed({destination: cityName}) and cityName
      // is "City, Country" in the curated dataset.
      //
      // Fix: split on the first comma and only match against the city
      // portion. The country suffix doesn't add matching value (trips
      // typically have just "Paris" in title, not "Paris, France"), and
      // we still escape % + _ (the genuine ILIKE wildcards) plus parens
      // and colons (PostgREST operator syntax) for the rare city names
      // that include them.
      const cityOnly = destination.split(",")[0].trim();
      const escaped = cityOnly.replace(/[()%_:]/g, "\\$&");
      // `trip_meta->>destination` uses `->>` (text extraction). The earlier
      // single-arrow form returned JSONB and ILIKE could not apply →
      // 42883 → 500 on every /destinations/[slug] page (Day-4 P1.2).
      query = query.or(`title.ilike.%${escaped}%,trip_meta->>destination.ilike.%${escaped}%`);
    }

    if (durationMin) {
      // Filter by duration (end_date - start_date)
      // This requires raw SQL, so we'll filter post-fetch for simplicity
    }

    if (budgetTier) {
      query = query.eq("trip_meta->budget_tier", budgetTier);
    }

    if (tags && tags.length > 0) {
      query = query.contains("tags", tags);
    }

    // Travel style filter — only meaningful post-Tier-1.1 migration when
    // the column exists. The migration is applied in prod so this is
    // always safe; the column defaults to 'classic' for every old row.
    if (travelStyle === "backpacker" && ugcOn) {
      query = query.eq("travel_style", "backpacker");
    }

    // Pagination
    const start = (page - 1) * perPage;
    query = query.range(start, start + perPage - 1);

    const { data: trips, error, count } = await query;

    if (error) {
      console.error("[Explore] Query error:", error);
      return errors.internal("Failed to fetch trips", "Explore");
    }

    // Resolve author usernames in one batched, privacy-safe lookup so the
    // TripCard byline can deep-link to /creator/{username}. Uses the admin
    // client with an explicit column allowlist (username ONLY) — the RLS
    // server client can't reliably read other users' rows, and we must never
    // widen this to email / payment handles. Best-effort: on any failure the
    // byline simply renders as plain text (username stays undefined).
    const usernameByUserId = new Map<string, string>();
    try {
      const userIds = Array.from(
        new Set(
          ((trips ?? []) as unknown as TripRow[])
            .map((tr) => tr.user_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      if (userIds.length > 0) {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const admin = createAdminClient();
        const { data: userRows } = await admin
          .from("users")
          .select("id, username, privacy_settings")
          .in("id", userIds);
        for (const u of userRows ?? []) {
          const username = u.username as string | null;
          if (!username) continue;
          // Don't link to a private profile (it 404s) — leave username unset.
          const priv = (u.privacy_settings ?? {}) as Record<string, unknown>;
          if (String(priv.privateProfile ?? "") === "true") continue;
          usernameByUserId.set(u.id as string, username);
        }
      }
    } catch {
      // Non-fatal — byline degrades to plain text.
    }

    // Post-process trips to extract relevant info. Cast to the loose
    // TripRow because the SELECT shape depends on `ugcOn` at runtime —
    // Supabase's TS plugin can't infer a union across both branches.
    const processedTrips = ((trips ?? []) as unknown as TripRow[]).map((trip) => {
      const startDate = new Date(trip.start_date);
      const endDate = new Date(trip.end_date);
      const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      // 2026-05-29 FIX #188 — itinerary fallback scan removed along
      // with the JSONB column SELECT. Every published trip in prod has
      // cover_image_url set; TripCard renders a gradient placeholder
      // when null (TripCard.tsx L44-57).
      const coverImage = trip.cover_image_url;

      const meta = trip.trip_meta as Record<string, unknown> || {};

      return {
        id: trip.id,
        title: trip.title,
        description: trip.description,
        shareToken: trip.share_token,
        publicSlug: trip.public_slug ?? undefined,
        destination: meta.destination || trip.title,
        countryCode: meta.country_code as string || null,
        durationDays,
        coverImage,
        tags: trip.tags || [],
        budgetTier: meta.budget_tier || "balanced",
        trendingScore: trip.trending_score,
        viewCount: trip.view_count || 0,
        // copyCount kept for backward compat; forkCount is the new
        // primary signal for UGC.
        copyCount: trip.template_copy_count || 0,
        likeCount: trip.like_count || 0,
        saveCount: trip.save_count || 0,
        forkCount: trip.fork_count || 0,
        author: {
          displayName: trip.author_display_name || "Anonymous traveler",
          username: trip.user_id
            ? usernameByUserId.get(trip.user_id) ?? undefined
            : undefined,
        },
        authorNote: trip.author_note || null,
        isEditorsPick: !!trip.is_editors_pick,
        // Mirror the new column on the wire so TripCard can render the
        // "🎒 Backpacker" badge without re-fetching trip_meta.
        travelStyle: trip.travel_style ?? "classic",
        sharedAt: trip.shared_at,
      };
    });

    // Apply duration filter post-fetch if needed
    let filteredTrips = processedTrips;
    if (durationMin) {
      filteredTrips = filteredTrips.filter(t => t.durationDays >= parseInt(durationMin));
    }
    if (durationMax) {
      filteredTrips = filteredTrips.filter(t => t.durationDays <= parseInt(durationMax));
    }

    return apiSuccess({
      trips: filteredTrips,
      total: count || 0,
      page,
      perPage,
      totalPages: Math.ceil((count || 0) / perPage),
    });
  } catch (error) {
    console.error("[Explore] Unexpected error:", error);
    return errors.internal("Internal server error", "Explore");
  }
}
