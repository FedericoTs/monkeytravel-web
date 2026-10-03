import { createAdminClient } from "@/lib/supabase/admin";
import { isTripIndexable, itineraryFingerprint, publicTripAlternates } from "@/lib/seo/public-trip";

/**
 * /sitemap-trips.xml — one URL per published community trip: the locale its
 * itinerary is written in (lib/seo/public-trip.ts). Trips below the page's
 * index threshold, and later copies of an identical itinerary, are left out.
 *
 * Kept OUT of the main `app/sitemap.ts` (which is a static-content sitemap)
 * because this set is DB-driven, high-cardinality, and grows continuously.
 * A dedicated route handler lets us stream a raw <urlset> with its own cache
 * cadence and — when the corpus outgrows a single file — shard without
 * touching the static sitemap.
 *
 * Referenced from `app/robots.ts` as an additional Sitemap: line so Google
 * discovers it.
 */

// Revalidate hourly — new trips get published continuously; an hour-stale
// sitemap is an acceptable trade for not re-querying on every crawler hit.
export const revalidate = 3600;

// Row cap. One URL per trip keeps the 50k-URL file limit far off; the real
// bound is reading every trip's itinerary JSON here. Shard (paginate
// `.range()` behind a sitemap index) before published trips approach this.
const MAX_TRIPS = 11000;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  let rows: Array<{
    public_slug: string | null;
    updated_at: string | null;
    shared_at: string | null;
    trip_meta: unknown;
    itinerary: unknown;
  }> = [];

  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("trips")
      // Published predicate: visibility='public' AND coalesce(is_hidden,false)
      // = false AND deleted_at IS NULL AND public_slug IS NOT NULL.
      .select("public_slug, updated_at, shared_at, trip_meta, itinerary")
      .eq("visibility", "public")
      .is("deleted_at", null)
      .not("public_slug", "is", null)
      .not("is_hidden", "is", true)
      .order("shared_at", { ascending: false, nullsFirst: false })
      .limit(MAX_TRIPS);
    rows = data ?? [];
  } catch {
    // Never 500 the sitemap — return an empty (but valid) urlset so crawlers
    // don't record a fetch error against the domain.
    rows = [];
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  // Oldest first, so an itinerary is listed under its first publication.
  for (const row of [...rows].reverse()) {
    if (!row.public_slug) continue;
    const days = Array.isArray(row.itinerary) ? row.itinerary : [];
    if (!isTripIndexable(days)) continue;
    const fingerprint = itineraryFingerprint(days);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const lastmod = (row.updated_at || row.shared_at || "").slice(0, 10);
    const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";
    const loc = publicTripAlternates(row.public_slug, row.trip_meta).canonical;
    urls.push(
      `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmodTag}\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
