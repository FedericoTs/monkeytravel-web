import { createAdminClient } from "@/lib/supabase/admin";

/**
 * /sitemap-creators.xml — every public creator profile, across all 4 locales.
 *
 * A "creator" qualifies when they have ≥1 published trip AND their profile is
 * not private (privacy_settings->>'privateProfile' !== 'true'). Same
 * rationale as sitemap-trips.xml for living outside the static app/sitemap.ts.
 *
 * Referenced from `app/robots.ts`.
 */

const SITE_URL = "https://monkeytravel.app";

const LOCALES = ["en", "es", "it", "pt"] as const;
const DEFAULT_LOCALE = "en";
const localePrefix = (l: string) => (l === DEFAULT_LOCALE ? "" : `/${l}`);

export const revalidate = 3600;

// Cap: 4 locale variants per creator, so ~11k creators fills a 50k-URL file.
const MAX_CREATORS = 11000;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  let creators: Array<{ username: string; lastmod: string }> = [];

  try {
    const supabase = createAdminClient();

    // 1. Distinct user_ids that own at least one published trip, with the
    //    freshest shared_at per owner as the lastmod signal.
    const { data: tripRows } = await supabase
      .from("trips")
      .select("user_id, shared_at, updated_at")
      .eq("visibility", "public")
      .is("deleted_at", null)
      .not("public_slug", "is", null)
      .not("is_hidden", "is", true)
      .order("shared_at", { ascending: false, nullsFirst: false });

    const latestByUser = new Map<string, string>();
    for (const r of tripRows ?? []) {
      const uid = r.user_id as string | null;
      if (!uid) continue;
      const stamp = ((r.shared_at || r.updated_at || "") as string).slice(0, 10);
      if (!latestByUser.has(uid)) latestByUser.set(uid, stamp);
    }

    const userIds = Array.from(latestByUser.keys()).slice(0, MAX_CREATORS);

    if (userIds.length > 0) {
      // 2. Resolve those users — public-safe allowlist only — and drop
      //    private profiles + username-less rows.
      const { data: userRows } = await supabase
        .from("users")
        .select("id, username, privacy_settings")
        .in("id", userIds);

      for (const u of userRows ?? []) {
        const username = u.username as string | null;
        if (!username) continue;
        const priv = (u.privacy_settings ?? {}) as Record<string, unknown>;
        if (String(priv.privateProfile ?? "") === "true") continue;
        creators.push({
          username,
          lastmod: latestByUser.get(u.id as string) ?? "",
        });
      }
    }
  } catch {
    creators = [];
  }

  const urls: string[] = [];
  for (const creator of creators) {
    const lastmodTag = creator.lastmod
      ? `\n    <lastmod>${creator.lastmod}</lastmod>`
      : "";
    for (const locale of LOCALES) {
      const loc = `${SITE_URL}${localePrefix(locale)}/creator/${creator.username}`;
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
