import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { updateSession } from "@/lib/supabase/middleware";
import { routing } from "@/lib/i18n/routing";
import { buildCspHeader, shouldEnforceCsp } from "@/lib/security/csp";
import { generateNonce } from "@/lib/security/nonce";

// Create the i18n middleware
const intlMiddleware = createIntlMiddleware(routing);

// AI training scrapers and content-resellers we don't want crawling the
// site. Each blocked request saves a function invocation + Supabase
// page_view write + bandwidth. Verified search engines (googlebot,
// bingbot, applebot, duckduckbot) are NOT in this list — we want their
// crawls. Update this list rather than touching middleware logic.
//
// Sourced from https://platform.openai.com/docs/bots and the public
// Common Crawl / Anthropic / Perplexity user-agent strings (2026-05).
// LOAD-BEARING ALLOWLIST: the Capacitor mobile shell ships with the UA
// suffix "MonkeyTravelApp/1.0" (see capacitor.config.ts → ios/android
// appendUserAgent). No pattern below matches it. If you add a new pattern
// later, sanity-check against `Mozilla/5.0 (iPhone; ...) ... MonkeyTravelApp/1.0`
// and `Mozilla/5.0 (Linux; Android ...) ... MonkeyTravelApp/1.0` — a
// regression here = the mobile app gets 403 on every request.
// E2E coverage: tests/e2e/mobile-webview.spec.ts
// 2026-07-12 GSC-audit decision: AI *citation/search* agents (ChatGPT-User,
// OAI-SearchBot, Claude-Web, PerplexityBot, Perplexity-User) removed from the
// block — they power in-answer recommendations, and our fastest-growing query
// cluster is "which AI is best for travel planning" asked inside those
// assistants; blocked assistants recommend competitors they CAN read.
// Model-TRAINING crawlers stay blocked. Keep in sync with app/robots.ts.
const BLOCKED_BOT_PATTERNS = [
  /GPTBot/i,
  /ClaudeBot/i,
  /anthropic-ai/i,
  /CCBot/i, // Common Crawl
  /Bytespider/i, // ByteDance/TikTok
  /Amazonbot/i,
  /FacebookBot/i,
  /Meta-ExternalAgent/i,
  /Google-Extended/i, // Google AI training (separate from googlebot)
  /Applebot-Extended/i, // Apple AI training (separate from Applebot)
  /Diffbot/i,
  /SemrushBot/i,
  /AhrefsBot/i,
  /MJ12bot/i,
  /DotBot/i,
];

function isBlockedBot(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return BLOCKED_BOT_PATTERNS.some((re) => re.test(userAgent));
}

// Posts deleted 2026-05-06 as part of the indexing-recovery work. We respond
// 410 Gone (not 404) so Google removes them from its index aggressively
// rather than periodically re-checking. Each appears at /blog/{slug} and
// /{locale}/blog/{slug} for es/it.
const GONE_BLOG_SLUGS = new Set([
  "pianificatore-viaggio-ai-2026",
  "us-tariffs-impact-travel-costs-2026",
  "trending-destinations-may-2026",
]);

function isGoneBlogPath(pathname: string): boolean {
  // Match /blog/{slug} or /{locale}/blog/{slug} (and trailing slash variants).
  const match = pathname.match(/^(?:\/(?:en|es|it|pt))?\/blog\/([^/?#]+)\/?$/);
  if (!match) return false;
  return GONE_BLOG_SLUGS.has(match[1]);
}

/**
 * UTM attribution cookie — first-touch wins.
 *
 * When a request arrives with `?utm_source=…`, persist it as
 * `mt_utm_source` cookie (60-day TTL) and `mt_utm_medium` /
 * `mt_utm_campaign` siblings. On subsequent signup the auth callback
 * reads these and stamps `users.acquisition_source` for partner
 * reporting (e.g. "how many users came from Hostelworld").
 *
 * First-touch (not last-touch): once the cookie is set, subsequent
 * UTM-tagged hits don't overwrite it. This matches the partnership
 * mental model — credit the first surface that captured the user.
 * Re-tagging would require explicit cookie clear.
 *
 * 60-day TTL because that's our typical "consider → sign up" window
 * for inspiration-led traffic. Tunable.
 */
const UTM_COOKIE_NAMES = {
  source: "mt_utm_source",
  medium: "mt_utm_medium",
  campaign: "mt_utm_campaign",
} as const;
const UTM_COOKIE_MAX_AGE_S = 60 * 24 * 60 * 60; // 60 days

function captureUtmCookies(request: NextRequest, response: NextResponse): void {
  const utm = request.nextUrl.searchParams.get("utm_source");
  if (!utm) return;
  // First-touch guard: if we already have a source cookie, leave it.
  if (request.cookies.get(UTM_COOKIE_NAMES.source)) return;
  // Whitelist + slice: never persist user-supplied data larger than 64
  // chars. Stops `?utm_source=<malicious-payload>` from bloating the
  // cookie or being reflected anywhere.
  const safe = (v: string | null) =>
    v ? v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) : null;
  const source = safe(utm);
  if (!source) return;
  const medium = safe(request.nextUrl.searchParams.get("utm_medium"));
  const campaign = safe(request.nextUrl.searchParams.get("utm_campaign"));
  const opts = {
    maxAge: UTM_COOKIE_MAX_AGE_S,
    path: "/",
    sameSite: "lax" as const,
    httpOnly: false, // analytics may need to read these client-side
    secure: process.env.NODE_ENV === "production",
  };
  response.cookies.set(UTM_COOKIE_NAMES.source, source, opts);
  if (medium) response.cookies.set(UTM_COOKIE_NAMES.medium, medium, opts);
  if (campaign) response.cookies.set(UTM_COOKIE_NAMES.campaign, campaign, opts);
}

export async function middleware(request: NextRequest) {
  // Block AI-training and SEO-spam bots BEFORE any other work runs.
  // Returns 403 with no body — saves bandwidth + downstream compute.
  // Real users and verified search bots (googlebot/bingbot/applebot)
  // pass through untouched.
  const userAgent = request.headers.get("user-agent");
  if (isBlockedBot(userAgent)) {
    return new NextResponse(null, {
      status: 403,
      headers: {
        "Cache-Control": "public, max-age=86400",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  // Generate a fresh per-request nonce for the nonce-based CSP. We attach
  // it to the request headers so server components / layouts can read it
  // via headers().get('x-nonce') and stamp it on inline <script> tags
  // (JSON-LD, etc.). The CSP response header is set at the bottom of the
  // middleware on whichever response we ultimately return.
  //
  // We compute the nonce even in dev (cheap — 16 random bytes) so the
  // request-header contract stays consistent, but the CSP itself is only
  // attached in production (see attachSecurityHeaders below). Without
  // that gate, React Fast Refresh + Turbopack's runtime would break on
  // first dev save.
  const nonce = generateNonce();
  // Mutating request.headers in middleware propagates to downstream
  // route handlers / RSC layouts via Next's edge runtime — this is the
  // documented pattern for forwarding request metadata.
  request.headers.set("x-nonce", nonce);

  /**
   * Attach the nonce-based CSP header to the response we're about to
   * return. Gated on shouldEnforceCsp() so dev / static asset paths are
   * untouched. Returns the same response for chaining.
   */
  const attachSecurityHeaders = (response: NextResponse): NextResponse => {
    if (!shouldEnforceCsp(request.nextUrl.pathname)) return response;
    response.headers.set("Content-Security-Policy", buildCspHeader(nonce));
    // Echo the nonce on the response too so Vercel's edge logging /
    // debugging surfaces can see which nonce was issued for this request.
    response.headers.set("x-nonce", nonce);
    return response;
  };

  // www → apex redirect is handled at the Vercel edge by a domain-level
  // 308 redirect (configured 2026-05-02). The redirect fires before this
  // middleware ever runs, so removing the previous in-code redirect saves
  // one edge-middleware invocation per www request.

  const { pathname } = request.nextUrl;

  // 410 Gone for deliberately-deleted blog posts. Tells Google to drop
  // these URLs from the index immediately (vs the slower 404 trickle).
  if (isGoneBlogPath(pathname)) {
    return attachSecurityHeaders(
      new NextResponse(
        `<!doctype html><html><head><title>Gone</title><meta name="robots" content="noindex"></head><body><h1>410 Gone</h1><p>This article has been retired. <a href="/blog">Browse the blog</a>.</p></body></html>`,
        {
          status: 410,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
            "X-Robots-Tag": "noindex",
          },
        }
      )
    );
  }

  // Skip i18n for API routes, static files, and special paths
  // .well-known/* serves Universal Links / Android App Links manifests —
  // Apple + Google fetch these unauthenticated and DO NOT follow locale
  // redirects, so they MUST bypass i18n entirely.
  const shouldSkipIntl =
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/.well-known/") ||
    // The "." catch skips static assets, but signed feedback tokens contain a
    // "." (payload.hmac) — exempt /feedback/ so the default-locale (no-prefix)
    // path still gets i18n routing instead of 404ing.
    (pathname.includes(".") && !pathname.startsWith("/feedback/")) ||
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/auth/signout");

  if (shouldSkipIntl) {
    // Just handle Supabase session for these routes
    return attachSecurityHeaders(await updateSession(request));
  }

  // Run i18n middleware first to handle locale routing
  const intlResponse = intlMiddleware(request);

  // If i18n middleware returned a redirect (3xx), follow it.
  // We DON'T capture UTMs on a redirect — the destination page will
  // receive the same querystring (next-intl preserves it) and we'll
  // capture there. Capturing on the redirect would double-fire on some
  // edge configurations.
  if (intlResponse.status >= 300 && intlResponse.status < 400) {
    return attachSecurityHeaders(intlResponse);
  }

  // Logged-in users skip the marketing homepage. PRESENCE check only — we look
  // for the Supabase auth cookie, NOT validate it (validation = a network call
  // we must not add to the hot path). A stale cookie sends them to /trips, where
  // the real auth guard bounces them to /auth/login if needed. Loop-safe:
  // /trips is never the homepage, so this only fires when the stripped path is
  // '/'. This is what lets the homepage render statically (Phase 1b).
  const strippedForHome = pathname.replace(/^\/(en|es|it|pt)/, '') || '/';
  if (strippedForHome === '/') {
    const hasSession = request.cookies
      .getAll()
      .some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));
    if (hasSession) {
      const tripsUrl = request.nextUrl.clone();
      tripsUrl.pathname = '/trips';
      return attachSecurityHeaders(NextResponse.redirect(tripsUrl));
    }
  }

  // First-touch UTM cookie capture (see captureUtmCookies docstring).
  captureUtmCookies(request, intlResponse);

  // Skip Supabase session refresh for public-only pages (saves serverless compute)
  // These pages never need auth state — no point refreshing tokens for anonymous visitors
  const strippedPath = pathname.replace(/^\/(en|es|it|pt)/, '') || '/';
  const isPublicOnly =
    strippedPath === '/' ||
    strippedPath.startsWith('/blog') ||
    strippedPath.startsWith('/destinations') ||
    strippedPath.startsWith('/privacy') ||
    strippedPath.startsWith('/terms') ||
    strippedPath.startsWith('/templates') ||
    strippedPath.startsWith('/feedback') ||
    strippedPath.startsWith('/free-ai-trip-planner') ||
    strippedPath.startsWith('/group-trip-planner') ||
    strippedPath.startsWith('/budget-trip-planner') ||
    strippedPath.startsWith('/family-trip-planner') ||
    strippedPath.startsWith('/ai-itinerary-generator');

  if (isPublicOnly) {
    return attachSecurityHeaders(intlResponse);
  }

  // For authenticated pages, chain Supabase session handling
  return attachSecurityHeaders(await updateSession(request, intlResponse));
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api routes (except protected ones)
     */
    // `manifest.json` and `sw.js` are STATIC files in public/. They were not
    // in the exclusion list because it only names image extensions, so every
    // fetch of them ran middleware — which calls updateSession (a Supabase
    // round-trip) and sets cookies. 2026-07-21 production logs: 344
    // middleware invocations/day for manifest.json alone, all of them for a
    // file that could have come straight off the CDN.
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|images|screenshots|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
