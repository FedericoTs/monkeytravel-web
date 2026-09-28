import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { updateSession, trackPageView } from "@/lib/supabase/middleware";
import { routing } from "@/lib/i18n/routing";
import {
  buildCspHeader,
  layoutInlineScriptHashes,
  shouldEnforceCsp,
  allowsThirdPartyFraming,
} from "@/lib/security/csp";
import { isStaticPagePath } from "@/lib/security/static-routes";
import { pageScriptHashes, PROBE_HEADER } from "@/lib/security/page-hashes";
import { generateNonce } from "@/lib/security/nonce";
import { isBlockedBotUserAgent } from "@/lib/security/bots";
import { unprefixedCallbackUrl } from "@/lib/auth/callback-url";

// Create the i18n middleware
const intlMiddleware = createIntlMiddleware(routing);

// User agents that get a 403 before any other work runs: training-only
// scrapers, content resellers and SEO-tool crawlers. None of them brings
// citation surface, and each blocked request saves a function invocation, a
// page_views write and bandwidth. The list is BLOCKED_BOT_AGENTS in
// lib/security/bots.ts, and robots.txt is generated from the same list.
//
// Deliberately NOT blocked:
//   - Search engines: Googlebot, Bingbot, Applebot (Siri/Spotlight), DuckDuckBot.
//   - AI citation/search agents: ChatGPT-User, OAI-SearchBot, Claude-Web,
//     PerplexityBot, Perplexity-User. People ask assistants which travel
//     planner to use, and an assistant that cannot read us recommends a
//     competitor it can read.
//   - GPTBot and ClaudeBot: they also build the retrieval indexes behind
//     ChatGPT Search and Claude's web search, and blocking them keeps the site
//     out of those indexes.
//   - Google-Extended and Applebot-Extended: besides training, they gate
//     grounding in the Gemini app and Vertex AI, and in Apple Intelligence.
//     That grounding is worth more to us than the training opt-out, so their
//     training use is accepted. Google-Extended does not affect AI Overviews
//     or AI Mode either way: Googlebot serves those, governed by nosnippet /
//     max-snippet / noindex.
//
// The Capacitor app appends "MonkeyTravelApp/1.0" to the WebView user agent
// (capacitor.config.ts). A pattern that matches an iPhone or Android WebView
// UA carrying that suffix 403s the app on every request, so check new
// names against both. lib/security/bots.vitest.ts and
// tests/e2e/mobile-webview.spec.ts cover this.

// Deleted blog posts, served 410 Gone rather than 404 so Google drops them
// from its index instead of re-checking them periodically.
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
 * First-touch UTM attribution. The first request carrying `?utm_source=` sets
 * mt_utm_source (plus mt_utm_medium / mt_utm_campaign) for 60 days, the usual
 * consider-to-signup window for inspiration-led traffic. Later UTM-tagged hits
 * never overwrite it, so a partner gets credit for the first surface that
 * captured the user. Signup copies it into users.acquisition_source.
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
  if (isBlockedBotUserAgent(userAgent)) {
    return new NextResponse(null, {
      status: 403,
      headers: {
        "Cache-Control": "public, max-age=86400",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  // This middleware reading a prerendered page back to hash its inline
  // scripts (lib/security/page-hashes.ts): serve it bare, no tracking.
  if (request.headers.get(PROBE_HEADER)) {
    return intlMiddleware(request);
  }

  // Prerendered pages are served from the CDN, so their CSP pins the inline
  // scripts of the served HTML by hash. Every other page renders per request
  // with a fresh nonce, which Next stamps on the scripts it emits. No CSP is
  // sent in dev, where it would break React Fast Refresh and Turbopack's
  // runtime.
  const { pathname } = request.nextUrl;
  const isStaticPage = isStaticPagePath(pathname);
  const nonce = generateNonce();

  /**
   * Adds X-Frame-Options (except on third-party-framable pages) and, where
   * shouldEnforceCsp() allows, the CSP to a response about to be returned.
   * Returns the same response for chaining.
   */
  const attachSecurityHeaders = async (response: NextResponse): Promise<NextResponse> => {
    // X-Frame-Options is set OUTSIDE the CSP gate on purpose: shouldEnforceCsp()
    // is false in dev, and clickjacking protection should not depend on
    // NODE_ENV. Omitted entirely on the pages BuildHop is allowed to frame —
    // XFO has no "allow this one origin" value (ALLOW-FROM is dead in every
    // modern browser), so the only way to let a third party frame a page is to
    // not send it and let frame-ancestors do the work.
    if (!allowsThirdPartyFraming(request.nextUrl.pathname)) {
      response.headers.set("X-Frame-Options", "SAMEORIGIN");
    }

    if (!shouldEnforceCsp(pathname)) return response;
    if (isStaticPage) {
      try {
        const hashes = await pageScriptHashes(request);
        if (hashes) {
          response.headers.set("Content-Security-Policy", buildCspHeader(pathname, { hashes }));
          return response;
        }
        // null: the path renders per request after all (a 404), so the nonce
        // policy below is the right one.
      } catch (err) {
        // The page could not be read back. A policy that blocks its scripts
        // would take the page down, so this response allows inline scripts
        // and the failure is logged; the next request probes again.
        console.error("[csp] could not hash the page's inline scripts:", err);
        response.headers.set("Content-Security-Policy", buildCspHeader(pathname, { unsafeInline: true }));
        return response;
      }
    }
    response.headers.set(
      "Content-Security-Policy",
      buildCspHeader(pathname, { nonce, hashes: await layoutInlineScriptHashes() })
    );
    // Echo the nonce on the response too so Vercel's edge logging /
    // debugging surfaces can see which nonce was issued for this request.
    response.headers.set("x-nonce", nonce);
    return response;
  };

  // www → apex is a Vercel domain-level 308 that fires before middleware runs,
  // so there is no redirect for it here: doing it in code would cost a
  // middleware invocation per www request.

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

  // Locale-stripped path, for the /feedback/ exemption in shouldSkipIntl.
  const pathNoLocale = pathname.replace(/^\/(en|es|it|pt)(?=\/|$)/, "") || "/";

  // /{locale}/auth/callback does not exist: the route is unprefixed and takes
  // the language as ?locale=. Redirect prefixed callback links, including ones
  // still sitting in inboxes, to the real route with every param kept so the
  // auth code is still redeemed (lib/auth/callback-url.ts).
  const callbackTarget = unprefixedCallbackUrl(new URL(request.url));
  if (callbackTarget) {
    const response = NextResponse.redirect(callbackTarget, 307);
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return attachSecurityHeaders(response);
  }

  // Skip i18n for API routes, static files and special paths. .well-known/*
  // serves the Universal Links / App Links manifests, which Apple and Google
  // fetch without following locale redirects, so it must bypass i18n.
  const shouldSkipIntl =
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/.well-known/") ||
    // The "." test skips static assets, but signed feedback tokens contain a
    // "." (payload.hmac), so /feedback/ is exempt and still gets i18n routing
    // instead of a 404. Test the locale-stripped path: skipping intlMiddleware
    // on /pt/feedback/<token> sets no locale, so the form renders in English
    // while the <title> (from params.locale) still looks localized.
    (pathname.includes(".") && !pathNoLocale.startsWith("/feedback/")) ||
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

  // Logged-in users skip the marketing homepage. PRESENCE check only: validating
  // the Supabase auth cookie is a network call that must stay off this hot path,
  // and a stale cookie lands on /trips, whose auth guard redirects to
  // /auth/login. Loop-safe, since it fires only when the stripped path is '/'.
  // Doing it here keeps auth-cookie reads out of the homepage render.
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
  // These pages never need auth state — no point refreshing tokens for anonymous visitors.
  // Every prerendered page is public by construction: it was built without a request.
  const strippedPath = pathname.replace(/^\/(en|es|it|pt)/, '') || '/';
  const isPublicOnly =
    isStaticPage ||
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
    // Page views are normally recorded inside updateSession(), which this
    // branch skips, so record them here. trackPageView() takes an optional
    // userId and makes no Supabase auth call, so the auth round-trip stays
    // skipped. Views land with user_id=null, the honest value on public pages.
    const { sessionId: publicSessionId, label: publicPageViewLabel } = trackPageView(request);
    intlResponse.headers.set("x-mt-pv", publicPageViewLabel);
    if (publicSessionId && !request.cookies.get("mt_session_id")) {
      intlResponse.cookies.set("mt_session_id", publicSessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
    }
    return attachSecurityHeaders(intlResponse);
  }

  // For authenticated pages, chain Supabase session handling
  return attachSecurityHeaders(await updateSession(request, intlResponse));
}

export const config = {
  matcher: [
    // Every path except Next internals (_next/static, _next/image), static
    // files (favicon.ico, manifest.json, sw.js, /images, /screenshots, /geo)
    // and image files by extension. API routes are matched. Keep static files
    // out: middleware runs updateSession (a Supabase round-trip) and sets
    // cookies, so a matched file costs an invocation instead of coming
    // straight off the CDN.
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|images|screenshots|geo|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
