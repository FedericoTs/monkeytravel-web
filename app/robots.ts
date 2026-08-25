import { MetadataRoute } from "next";
import { locales, defaultLocale } from "@/i18n";

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
// 2026-06-01: GSC reported "Indexed, though blocked by robots.txt" on
// monkeytravel.app. Root cause: pages with `<meta name="robots" content=
// "noindex">` were ALSO listed here, so Google saw the URL via inbound
// links/sitemap but couldn't crawl to read the noindex meta — they got
// stuck "indexed" forever. Fixed by removing the path-level disallow for
// surfaces that already noindex at the page level:
//   - /shared/<token>          (page.tsx: robots.index = false)
//   - /trips/<id>              (TripDetailClient + page.tsx: noindex)
//   - /saved                   (page-level noindex)
//   - /profile, /profile/*     (page-level noindex)
// Google will now crawl → see noindex → drop from index. Keep `/api/`,
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

// AI TRAINING scrapers and content-resellers. These are *also* hard-blocked
// at the edge in middleware.ts (BLOCKED_BOT_PATTERNS). Listing them here adds
// a polite-protocol opt-out on top of the hard block, so crawlers that honor
// robots.txt skip even before they hit the function.
// Keep in sync with middleware.ts BLOCKED_BOT_PATTERNS.
//
// 2026-07-12 GSC-audit decision: AI *citation/search* agents are now ALLOWED
// (removed from this list): ChatGPT-User, OAI-SearchBot, Claude-Web,
// PerplexityBot, Perplexity-User. Our fastest-growing query cluster is
// "which AI is best for travel planning" — asked inside ChatGPT/Perplexity —
// and blocked assistants can't read or cite MonkeyTravel, so they recommend
// competitors they CAN read (Mindtrip, Layla).
//
// 2026-08-11 revision: GPTBot and ClaudeBot allowed too — they now feed the
// ChatGPT Search / Claude search retrieval indexes, not just training, and
// blocking them excluded us from those indexes entirely. CCBot,
// Google-Extended, Applebot-Extended and the SEO-tool crawlers stay blocked.
//
// 2026-08-21 correction: the line above used to call that group "pure-training
// opt-outs". CCBot and the SEO tools are; Google-Extended and
// Applebot-Extended are NOT. Google-Extended also gates Gemini app grounding
// (and Applebot-Extended, Apple Intelligence), so blocking them is a
// retrieval decision too — though it does NOT touch AI Overviews or AI Mode,
// which Googlebot serves under nosnippet / max-snippet / noindex.
// DECISION 2026-08-21: Google-Extended is now ALLOWED — grounding in the
// Gemini consumer app was judged worth more than the training opt-out, the
// same call already made for GPTBot and ClaudeBot. AI Overviews were never
// affected either way.
// DECISION 2026-08-25: Applebot-Extended is now ALLOWED too — the decision
// flagged above as "not yet made" is made. It gates Apple Intelligence
// grounding, so blocking it is a retrieval decision and not a pure training
// opt-out, which is exactly the reasoning already applied to GPTBot, ClaudeBot
// and Google-Extended. Note the cost is real and accepted: this also permits
// training use. Applebot (plain, the Siri/Spotlight search crawler) was never
// blocked. anthropic-ai stays blocked — it is a legacy training-only agent and
// ClaudeBot already covers Claude retrieval, which is what drives our
// claude.ai referrals.
// The full tradeoff lives in middleware.ts above BLOCKED_BOT_PATTERNS;
// keep both notes in sync. Source: docs/GEO-REMEDIATION-PLAN.md, Wave 5.
const BLOCKED_AI_AGENTS = [
  "anthropic-ai",
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "SemrushBot",
  "AhrefsBot",
];

// Build locale-aware patterns. Default locale (en) lives at the un-prefixed
// root, so `/auth/*` covers it; every non-default locale gets its own prefix
// (`/es/auth/*`, `/it/auth/*`, `/pt/auth/*`, …). Derived from the canonical
// `locales` array so a newly-added locale is covered automatically — the pt
// launch (2026-06-15) shipped before this was generalised and briefly left
// /pt/api, /pt/auth, /pt/admin crawlable.
function expandLocales(path: string): string[] {
  return locales.map((l) => (l === defaultLocale ? path : `/${l}${path}`));
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
    // Multiple sitemaps: the static-content sitemap plus the two DB-driven
    // UGC sitemaps (published trips + public creator profiles). Google reads
    // every Sitemap: line, so listing all three surfaces the UGC-SEO corpus.
    sitemap: [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap-trips.xml`,
      `${baseUrl}/sitemap-creators.xml`,
    ],
    host: baseUrl,
  };
}
