/**
 * GET /api/advisories/[country]
 *
 * Public, anonymous-cacheable endpoint that returns the normalized
 * TravelAdvisory for a given destination country, sourced from the
 * UK FCDO travel-advice API.
 *
 * Why a route (vs server-fetching directly inside the trip page)?
 *   - Client component (TripDetailClient) needs a way to pull the
 *     advisory after hydration without leaking the trip's full server
 *     props.
 *   - Lets us add response caching at the Vercel edge layer separately
 *     from the trip page, so a popular destination doesn't re-hit the
 *     FCDO API on every trip view.
 *   - Keeps the FCDO dependency on the server side — no client bundle
 *     pollution from the in-process cache map.
 *
 * The `country` segment is the destination country name (case-insensitive,
 * URL-decoded). Internally it's slug-mapped (see countryNameToFcdoSlug).
 * Unknown countries return 200 with `{ advisory: null }` — the UI hides
 * the banner in that case, which is the right default behavior.
 *
 * Cache-Control: 6h public — matches the in-process TTL in fcdo.ts and
 * gives the Vercel CDN room to share responses across users hitting the
 * same destination.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFcdoAdvisory } from "@/lib/advisories/fcdo";

interface RouteContext {
  params: Promise<{ country: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  let country: string;
  try {
    const params = await context.params;
    country = decodeURIComponent(params.country || "").trim();
  } catch {
    return NextResponse.json({ advisory: null }, { status: 400 });
  }
  if (!country) {
    return NextResponse.json({ advisory: null }, { status: 400 });
  }

  // Hard cap on input length so a malformed call can't make us slugify
  // something pathological.
  if (country.length > 100) {
    return NextResponse.json({ advisory: null }, { status: 400 });
  }

  try {
    const advisory = await getFcdoAdvisory(country);
    return NextResponse.json(
      { advisory },
      {
        headers: {
          // 6h public cache, 1h stale-while-revalidate. Aligns with FCDO's
          // own daily-ish update cadence — re-checks within 6h are wasted
          // even at the CDN.
          "Cache-Control":
            "public, max-age=21600, stale-while-revalidate=3600",
        },
      }
    );
  } catch (err) {
    // getFcdoAdvisory swallows its own errors, so this branch is defensive
    // only. Log + return null so the UI degrades silently.
    console.error("[advisories route] unexpected error", err);
    return NextResponse.json({ advisory: null });
  }
}
