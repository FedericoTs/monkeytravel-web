import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { updateSession } from "@/lib/supabase/middleware";
import { routing } from "@/lib/i18n/routing";

// Create the i18n middleware
const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  // Redirect www to non-www (canonical domain consolidation for SEO)
  const host = request.headers.get("host") || "";
  if (host.startsWith("www.")) {
    const url = request.nextUrl.clone();
    url.host = host.replace("www.", "");
    return NextResponse.redirect(url, 301);
  }

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

  // For normal responses, chain Supabase session handling
  // Pass the modified request from intl middleware (with locale info)
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
