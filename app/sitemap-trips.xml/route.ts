import { createAdminClient } from "@/lib/supabase/admin";

/**
 * /sitemap-trips.xml — every published community trip, across all 4 locales.
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

const SITE_URL = "https://monkeytravel.app";

// Locale set + prefixing. Mirrors lib/i18n/routing.ts (en unprefixed).
const LOCALES = ["en", "es", "it", "pt"] as const;
const DEFAULT_LOCALE = "en";
const localePrefix = (l: string) => (l === DEFAULT_LOCALE ? "" : `/${l}`);

// Revalidate hourly — new trips get published continuously; an hour-stale
// sitemap is an acceptable trade for not re-querying on every crawler hit.
export const revalidate = 3600;

// Single-urlset cap. The sitemaps.org limit is 50k URLs / 50MB per file. We
// emit 4 locale variants per trip, so ~11k trips fills a file. If published
// trip count ever approaches this, shard by paginating `.range()` here and
// splitting into /sitemap-trips-1.xml, -2.xml, … behind a sitemap index.
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
  }> = [];

  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("trips")
      // Published predicate: visibility='public' AND coalesce(is_hidden,false)
      // = false AND deleted_at IS NULL AND public_slug IS NOT NULL.
      .select("public_slug, updated_at, shared_at")
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
  for (const row of rows) {
    if (!row.public_slug) continue;
    const slug = row.public_slug;
    const lastmod = (row.updated_at || row.shared_at || "").slice(0, 10);
    const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";

    for (const locale of LOCALES) {
      const loc = `${SITE_URL}${localePrefix(locale)}/trip/${slug}`;
      urls.push(
        `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmodTag}\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
      );
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
