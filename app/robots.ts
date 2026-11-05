import { MetadataRoute } from "next";
import { locales, defaultLocale } from "@/i18n";
import { BLOCKED_BOT_AGENTS } from "@/lib/security/bots";
import { SITE_URL } from "@/lib/seo/canonical";

// Locale-aware disallow paths. Next.js's locale routing means every private
// surface ships at the un-prefixed (default-locale) path AND under every
// non-default locale prefix (/es/*, /it/*, /pt/*, …) — so each entry here is
// emitted once per locale. Derived from the canonical `locales` list (see
// expandLocales) so adding a locale never silently leaves its private surfaces
// crawlable. Wildcards (`/foo/*`) cover both index pages
// and any nested child; the trailing `*` is a glob, not a regex.
//
// CAUSALITY: keep in sync with app/[locale]/ — if a new private route is
// added (anything user-specific, auth-gated, or transactional), include it
// here so it doesn't leak into Google's index via internal links.
//
// Surfaces that already noindex at the page level are NOT disallowed here.
// A path-level disallow on a page with `<meta name="robots" content=
// "noindex">` means Google sees the URL via inbound links/sitemap but can't
// crawl to read the noindex meta, so it stays "Indexed, though blocked by
// robots.txt" forever. Left crawlable:
//   - /shared/<token>          (page.tsx: robots.index = false)
//   - /trips/<id>              (TripDetailClient + page.tsx: noindex)
//   - /saved                   (page-level noindex)
// Google crawls them → sees noindex → drops them from the index. Keep `/api/`,
// `/auth/`, `/admin/`, `/oauth/`, `/onboarding`, `/welcome`, `/unsubscribe`,
// `/invite/<token>`, `/join/<token>` blocked — those are write endpoints
// or one-time tokens we don't want Google fetching even for noindex.
const DISALLOW_PATHS = [
  "/api/",
  "/api/calendar/", // personalised .ics subscription URLs (Phase 1B) — already
                    // covered by /api/ above, listed for clarity since the
                    // tokens in these URLs are user-stable secrets.
  "/auth/",
  "/admin/",
  "/admin",
  "/oauth/",
  "/onboarding",
  "/welcome",
  "/unsubscribe",
  "/invite/",
  "/join/",
  "/profile/", // no page-level noindex; keep blocked
  "/profile",
  "/auth/reset-password", // legacy path; kept for clarity
];

// Explicitly indexable public pages — listed for clarity even though the
// default `Allow: /` covers them. This makes audit/diff reviews obvious.
const ALLOW_PATHS = [
  "/",
  "/blog",
  "/destinations",
  "/explore",
  "/backpacker",
  "/tools",
  "/privacy",
  "/terms",
  "/contact",
];

// The crawlers middleware.ts refuses with a 403 are also told so here, so the
// ones that honour robots.txt stop before they reach the function. Both read
// BLOCKED_BOT_AGENTS; middleware.ts explains which agents stay allowed and why.

// Build locale-aware patterns. Default locale (en) lives at the un-prefixed
// root, so `/auth/*` covers it; every non-default locale gets its own prefix
// (`/es/auth/*`, `/it/auth/*`, `/pt/auth/*`, …). Derived from the canonical
// `locales` array so a newly-added locale is covered automatically, never
// leaving its /api, /auth and /admin crawlable.
function expandLocales(path: string): string[] {
  return locales.map((l) => (l === defaultLocale ? path : `/${l}${path}`));
}

export default function robots(): MetadataRoute.Robots {

  const disallow = DISALLOW_PATHS.flatMap(expandLocales);
  // Share images are served under the disallowed /api/; the longer Allow wins,
  // so Googlebot-Image and link previews can fetch them.
  const allow = [...ALLOW_PATHS.flatMap(expandLocales), "/api/og/"];

  return {
    rules: [
      // Default rule — applies to googlebot, bingbot, applebot, duckduckbot,
      // and every other crawler not explicitly overridden below.
      {
        userAgent: "*",
        allow,
        disallow,
      },
      // AI scrapers — full-site disallow as polite-protocol opt-out.
      ...BLOCKED_BOT_AGENTS.map((agent) => ({
        userAgent: agent,
        disallow: "/",
      })),
    ],
    // Multiple sitemaps: the static-content sitemap plus the two DB-driven
    // UGC sitemaps (published trips + public creator profiles). Google reads
    // every Sitemap: line, so listing all three surfaces the UGC-SEO corpus.
    sitemap: [
      `${SITE_URL}/sitemap.xml`,
      `${SITE_URL}/sitemap-trips.xml`,
      `${SITE_URL}/sitemap-creators.xml`,
    ],
    host: SITE_URL,
  };
}
