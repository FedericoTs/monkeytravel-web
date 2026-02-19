import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { geolocation } from "@vercel/functions";

// Track page views with geo data (non-blocking)
async function trackPageView(request: NextRequest, userId?: string) {
  // Skip tracking for API routes, static assets, and admin pages
  const path = request.nextUrl.pathname;
  if (
    path.startsWith("/api/") ||
    path.startsWith("/_next/") ||
    path.startsWith("/admin") ||
    path.includes(".")
  ) {
    return;
  }

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
      session_id: request.cookies.get("session_id")?.value || null,
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

  // Refresh session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Track page view with geo data (non-blocking)
  trackPageView(request, user?.id);

  // Protected routes - redirect to login if not authenticated
  // Note: /trips/new is excluded to allow gradual engagement (users can fill form before signup)
  // Note: /trips/template/* is public so curated escapes can drive traffic & conversions
  const protectedPaths = ["/trips"];
  const excludedFromProtection = ["/trips/new", "/trips/template"];

  // Strip locale prefix from pathname for path matching
  const locales = ["en", "es", "it"];
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

  const isProtectedPath = protectedPaths.some((path) =>
    pathWithoutLocale.startsWith(path)
  );
  const isExcluded = excludedFromProtection.some((path) =>
    pathWithoutLocale.startsWith(path)
  );

  if (isProtectedPath && !isExcluded && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Admin routes - require authentication AND admin email
  const isAdminPath = request.nextUrl.pathname.startsWith("/admin");

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

  // Redirect logged in users away from auth pages
  const authPaths = ["/auth/login", "/auth/signup"];
  const isAuthPath = authPaths.some((path) =>
    pathWithoutLocale.startsWith(path)
  );

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
