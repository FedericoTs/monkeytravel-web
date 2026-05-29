import { MetadataRoute } from "next";

// Locale-aware disallow paths. Next.js's locale routing means every private
// surface ships at the un-prefixed path AND at /es/* and /it/* — so each entry
// here gets emitted three times. Wildcards (`/foo/*`) cover both index pages
// and any nested child; the trailing `*` is a glob, not a regex.
//
// CAUSALITY: keep in sync with app/[locale]/ — if a new private route is
// added (anything user-specific, auth-gated, or transactional), include it
// here so it doesn't leak into Google's index via internal links.
const DISALLOW_PATHS = [
  "/api/",
  "/auth/",
  "/admin/",
  "/admin",
  "/oauth/",
  "/onboarding",
  "/welcome",
  "/profile/",
  "/profile",
  "/trips/",
  "/saved",
  "/shared/", // private trip shares — noindexed per cycle-3 finding
  "/unsubscribe",
  "/invite/",
  "/join/",
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

// AI training scrapers and content-resellers. These are *also* hard-blocked
// at the edge in middleware.ts (BLOCKED_BOT_PATTERNS). Listing them here adds
// a polite-protocol opt-out on top of the hard block, so crawlers that honor
// robots.txt skip even before they hit the function.
// Keep in sync with middleware.ts BLOCKED_BOT_PATTERNS.
const BLOCKED_AI_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "Google-Extended",
  "Applebot-Extended",
  "SemrushBot",
  "AhrefsBot",
];

// Build locale-aware disallow patterns. Default locale (en) lives at the
// un-prefixed root, so `/trips/*` covers it. `/es/trips/*` and `/it/trips/*`
// cover the localized variants — Next's next-intl middleware mounts every
// route under all three locale prefixes.
function expandLocales(path: string): string[] {
  // Already-rooted paths get prefixed by /es and /it.
  return [path, `/es${path}`, `/it${path}`];
}

export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://monkeytravel.app";

  const disallow = DISALLOW_PATHS.flatMap(expandLocales);
  const allow = ALLOW_PATHS.flatMap(expandLocales);

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
      ...BLOCKED_AI_AGENTS.map((agent) => ({
        userAgent: agent,
        disallow: "/",
      })),
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
