import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { updateSession } from "@/lib/supabase/middleware";
import { routing } from "@/lib/i18n/routing";

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
const BLOCKED_BOT_PATTERNS = [
  /GPTBot/i,
  /ChatGPT-User/i,
  /OAI-SearchBot/i,
  /ClaudeBot/i,
  /Claude-Web/i,
  /anthropic-ai/i,
  /PerplexityBot/i,
  /Perplexity-User/i,
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

  // www → apex redirect is handled at the Vercel edge by a domain-level
  // 308 redirect (configured 2026-05-02). The redirect fires before this
  // middleware ever runs, so removing the previous in-code redirect saves
  // one edge-middleware invocation per www request.

  const { pathname } = request.nextUrl;

  // Skip i18n for API routes, static files, and special paths
  const shouldSkipIntl =
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/admin") ||
    pathname.includes(".") ||
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/auth/signout");

  if (shouldSkipIntl) {
    // Just handle Supabase session for these routes
    return await updateSession(request);
  }

  // Run i18n middleware first to handle locale routing
  const intlResponse = intlMiddleware(request);

  // If i18n middleware returned a redirect (3xx), follow it
  if (intlResponse.status >= 300 && intlResponse.status < 400) {
    return intlResponse;
  }

  // Skip Supabase session refresh for public-only pages (saves serverless compute)
  // These pages never need auth state — no point refreshing tokens for anonymous visitors
  const strippedPath = pathname.replace(/^\/(en|es|it)/, '') || '/';
  const isPublicOnly =
    strippedPath === '/' ||
    strippedPath.startsWith('/blog') ||
    strippedPath.startsWith('/destinations') ||
    strippedPath.startsWith('/privacy') ||
    strippedPath.startsWith('/terms') ||
    strippedPath.startsWith('/templates') ||
    strippedPath.startsWith('/free-ai-trip-planner') ||
    strippedPath.startsWith('/group-trip-planner') ||
    strippedPath.startsWith('/budget-trip-planner') ||
    strippedPath.startsWith('/family-trip-planner') ||
    strippedPath.startsWith('/ai-itinerary-generator');

  if (isPublicOnly) {
    return intlResponse;
  }

  // For authenticated pages, chain Supabase session handling
  return await updateSession(request, intlResponse);
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
    "/((?!_next/static|_next/image|favicon.ico|images|screenshots|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
