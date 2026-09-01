import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { geolocation } from "@vercel/functions";
import { SUPABASE_AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import { isAnalyticsBot } from "@/lib/analytics/bot-detection";

// Track page views with geo data (non-blocking).
// Returns the session_id that was used (so the caller can set the cookie on
// the response when this was a brand-new session).
//
// **2026-05-30 fix**: previously read `request.cookies.get("session_id")` but
// NOTHING in the codebase ever SET that cookie — so 100% of inserts had
// session_id=null. GSC + Supabase analytics couldn't count unique sessions.
// Now generates a UUID on first visit and the caller persists it as a cookie.
export function trackPageView(request: NextRequest, userId?: string): string | null {
  // Skip tracking for API routes, static assets, and admin pages
  const path = request.nextUrl.pathname;
  if (
    path.startsWith("/api/") ||
    path.startsWith("/_next/") ||
    path.startsWith("/admin") ||
    path.includes(".")
  ) {
    return null;
  }

  // **2026-06-07 fix**: skip Next.js Link prefetch requests. The
  // BottomNav (task #270) holds 4 always-visible Links; Next prefetches
  // every visible Link on mount and again on hover. Each prefetch
  // hits middleware, which was firing a page_views POST — david
  // cassoni's session showed 15 page-view rows in 30s across 4 paths
  // with sub-100ms gaps and the SAME referrer (impossible for human
  // taps). Funnels and "top landings" charts went wildly off.
  //
  // Next sets `next-router-prefetch: 1` for App-Router prefetches and
  // `purpose: prefetch` for older Pages-Router-style; we check both
  // so future-Next changes and any partner crawler that copies the
  // standard purpose header both get filtered.
  if (
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("sec-purpose")?.includes("prefetch")
  ) {
    return null;
  }

  // **2026-06-04 fix**: dev environment was POSTing to the prod page_views
  // table because middleware ran against prod Supabase from `npm run dev`.
  // Over 30 days this leaked 2,765 spurious views from 5 localhost sessions
  // (17% of total traffic) and one template alone took 1,726 ghost views
  // from a single dev tab in a refresh loop. VERCEL_ENV is only set on
  // Vercel deployments ('production' | 'preview' | 'development'), so a
  // missing/non-production value catches both local dev and preview builds.
  if (process.env.VERCEL_ENV !== "production") {
    return null;
  }

  // Read existing session_id or mint a fresh one for first-time visitors.
  // crypto.randomUUID() is available on the Edge runtime that powers
  // Next.js middleware — no polyfill needed.
  const existingSessionId = request.cookies.get("mt_session_id")?.value;
  const sessionId = existingSessionId || crypto.randomUUID();

  try {
    // Get geo data from Vercel's geolocation
    const geo = geolocation(request);

    const pageView = {
      path,
      referrer: request.headers.get("referer") || null,
      country: geo.country || null,  // ISO country code (US, IT, DE, etc.)
      country_code: geo.country || null,  // Same as country for grouping
      city: geo.city || null,
      region: geo.countryRegion || null,  // State/province code (TX, CA, etc.)
      latitude: geo.latitude ? parseFloat(geo.latitude) : null,
      longitude: geo.longitude ? parseFloat(geo.longitude) : null,
      user_agent: request.headers.get("user-agent") || null,
      user_id: userId || null,
      session_id: sessionId,
      // Classified at WRITE time so the aggregates can filter on a boolean
      // instead of re-implementing the signature list in SQL. Rows are still
      // recorded, not dropped: knowing how much crawler load we carry is
      // useful, and discarding it would be a one-way door. See
      // lib/analytics/bot-detection.ts.
      is_bot: isAnalyticsBot(request.headers.get("user-agent")),
    };

    // Fire and forget - don't await to avoid blocking the response
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/page_views`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(pageView),
    }).catch(() => {
      // Silently ignore errors to not impact user experience
    });
  } catch {
    // Silently ignore errors
  }

  return sessionId;
}

/**
 * The `sub` claim (the user id) out of a Supabase access token, decoded
 * locally without verifying the signature.
 *
 * Deliberately unverified: the only callers are a redirect decision that the
 * destination page re-validates, and page-view attribution. Never use this to
 * make an authorization decision — /admin calls getUser() for that.
 *
 * Takes the token from getSession() rather than parsing cookies directly, so
 * this does not depend on @supabase/ssr's cookie name, chunking or encoding.
 */
function subjectFromAccessToken(accessToken: string | undefined): string | null {
  if (!accessToken) return null;
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = JSON.parse(json)?.sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

export async function updateSession(request: NextRequest, baseResponse?: NextResponse) {
  // Use the base response if provided (from chained middleware), otherwise create new
  let supabaseResponse = baseResponse || NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Adds `Secure` to the auth cookie. This is the path that rewrites the
      // session on every refresh, so without it the token loses the attribute
      // again on the next request even if it was set correctly at login.
      cookieOptions: SUPABASE_AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Only create new response if we don't have a base response
          // This preserves the intl middleware's headers/rewrites
          if (!baseResponse) {
            supabaseResponse = NextResponse.next({
              request,
            });
          }
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // ONE network auth verification per request, not two.
  //
  // This used to call getUser(), which is a round trip to Supabase Auth. Every
  // page that needs identity then calls getUser() AGAIN in its own Server
  // Component (app/[locale]/trips/page.tsx:32, profile/page.tsx:27,
  // saved/page.tsx:133, trips/[id]/page.tsx:70), so a signed-in request paid
  // the same verification twice, serially. Measured on production: a request
  // carrying a session cookie was ~138ms slower than an anonymous control,
  // interleaved, n=6. Supabase is in us-west-1 and these functions run in
  // iad1, so that is mostly distance.
  //
  // WHY NOT JUST A COOKIE-PRESENCE CHECK: this call is also the session
  // REFRESH mechanism. auth-js refreshes inside a 90s expiry margin
  // (EXPIRY_MARGIN_MS = AUTO_REFRESH_TICK_THRESHOLD * 30_000) and the ssr
  // cookie handler above writes the rotated tokens back. Replace it with a
  // presence check and every session silently dies at token expiry.
  //
  // getSession() keeps that refresh and drops the round trip: __loadSession
  // returns the stored session with NO network call while the access token is
  // still valid, and only calls _callRefreshToken (network) inside the same
  // 90s margin. So the refresh behaviour is unchanged; the redundant
  // verification is what goes away.
  //
  // The session it returns is NOT verified — it is decoded from the cookie.
  // That is sound here because middleware only ever REDIRECTS on it, and the
  // pages it redirects to re-validate with a real getUser() before rendering
  // anything. A forged cookie gets you as far as /trips, which then bounces
  // you to /auth/login. It is NOT sound for /admin, where isAdmin() reads
  // user.email to make an authorization decision — that branch still verifies.
  // Strip locale prefix for path matching. Computed here, before the auth
  // call, because which paths need a VERIFIED user decides which call we make.
  const locales = ["en", "es", "it", "pt"];
  let pathWithoutLocale = request.nextUrl.pathname;
  for (const locale of locales) {
    if (pathWithoutLocale.startsWith(`/${locale}/`)) {
      pathWithoutLocale = pathWithoutLocale.slice(locale.length + 1);
      break;
    } else if (pathWithoutLocale === `/${locale}`) {
      pathWithoutLocale = "/";
      break;
    }
  }

  const isAdminPath = request.nextUrl.pathname.startsWith("/admin");
  const authPaths = ["/auth/login", "/auth/signup"];
  const isAuthPath = authPaths.some((path) => pathWithoutLocale.startsWith(path));

  let user: { id: string; email?: string } | null = null;

  // /auth/* MUST verify, and this is not a theoretical nicety - it was caught
  // by scripts/probe-single-auth-verification.mjs as ERR_TOO_MANY_REDIRECTS.
  // The auth-path rule below redirects a signed-in visitor away to /trips. If
  // that fires on an UNVERIFIED session, a cookie that parses locally but the
  // server rejects (revoked session, deleted user, rotated JWT secret, a token
  // from another project) loops forever: /auth/login -> /trips -> the page's
  // real getUser() rejects it -> /auth/login. That is a login lockout for a
  // real user, not just a forged cookie.
  //
  // The cost is close to nothing: visitors to /auth/login are overwhelmingly
  // signed OUT, and getUser() makes no network call without a session cookie.
  if (isAdminPath || isAuthPath) {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } else {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    // Read the id from the access token rather than session.user: on the
    // server auth-js wraps session.user in a proxy that console.warns on first
    // property access, which would be a log line on every signed-in request.
    user = session ? { id: subjectFromAccessToken(session.access_token) ?? "" } : null;
    if (user && !user.id) user = null;
  }

  // Track page view with geo data (non-blocking).
  // Returns the session_id (existing-or-fresh) so we can persist it as a cookie
  // for subsequent requests in the same session. 30-day sliding expiry.
  const sessionId = trackPageView(request, user?.id);
  if (sessionId && !request.cookies.get("mt_session_id")) {
    supabaseResponse.cookies.set("mt_session_id", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }

  // Protected routes - redirect to login if not authenticated
  // Note: /trips/new is excluded to allow gradual engagement (users can fill form before signup)
  // Note: /trips/template/* is public so curated escapes can drive traffic & conversions
  // Note (2026-06-09): /trips/[uuid] is excluded so the page itself can run its
  //   share_token check first. Google has been indexing /trips/[uuid] URLs (see
  //   today's daily routine — 22 organic clicks/14d landing on these), and the
  //   page-level logic redirects anon visitors to /shared/[token] when the trip
  //   is published. If we redirect them to /auth/login here, those Google
  //   sessions never reach the page logic and drop straight off the site.
  //   The page still requires auth for non-owners of UNPUBLISHED trips
  //   (notFound() fires), so this doesn't expose private data.
  const protectedPaths = ["/trips"];
  const excludedFromProtection = ["/trips/new", "/trips/template"];
  // UUID v4 pattern — 8-4-4-4-12 hex chars. We match this against the path
  // segment AFTER /trips/ to identify trip-detail URLs.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const isProtectedPath = protectedPaths.some((path) =>
    pathWithoutLocale.startsWith(path)
  );
  const isExcluded = excludedFromProtection.some((path) =>
    pathWithoutLocale.startsWith(path)
  );
  // Check if this is /trips/[uuid] (with optional trailing segments like
  // /trips/[uuid]/edit). Match the first segment after /trips/.
  const tripIdMatch = pathWithoutLocale.match(/^\/trips\/([^/]+)(\/|$)/);
  const isTripDetailUuid = tripIdMatch ? UUID_RE.test(tripIdMatch[1]) : false;

  if (isProtectedPath && !isExcluded && !isTripDetailUuid && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Admin routes - require authentication AND admin email.
  //
  // isAdminPath is computed ABOVE, where it also selects the verified
  // getUser() path. Deliberately one variable and not two: the check below is
  // only safe while `user` came from a real verification, so if these ever
  // drift apart this block starts trusting a cookie-derived email.
  if (isAdminPath) {
    if (!user) {
      // Not logged in - redirect to login
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      url.searchParams.set("redirect", request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }

    if (!isAdmin(user.email)) {
      // Logged in but not an admin - redirect to home
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  // Redirect logged in users away from auth pages.
  //
  // isAuthPath is computed above, where it also forces the verified getUser()
  // path. Same rule as isAdminPath: one variable, because this redirect is
  // only safe on a verified user.
  if (isAuthPath && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/trips";
    return NextResponse.redirect(url);
  }

  // GRADUAL ENGAGEMENT: No forced onboarding redirect
  // Users can explore the app freely. Onboarding preferences are collected
  // inline when they attempt to generate a trip or copy a template.
  // The early-access system handles access control at the generation point.

  return supabaseResponse;
}
