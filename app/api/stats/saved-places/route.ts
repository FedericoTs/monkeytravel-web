import { getSavedPlaces } from "@/lib/stats/public-stats";

/**
 * The places counted for "saved in N trips" on activity cards. Built with the
 * deployment and regenerated every six hours, as often as the cache row it
 * reads; every visitor gets the same file, so the CDN serves it.
 */
export const revalidate = 21600;

export async function GET() {
  const places = await getSavedPlaces();
  return Response.json(
    { places },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400" } },
  );
}
