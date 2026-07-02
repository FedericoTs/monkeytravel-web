/**
 * Content-Security-Policy header builder.
 *
 * Single source of truth for the CSP string we send. Called from
 * `middleware.ts` per request with a freshly-generated nonce.
 *
 * Design notes:
 * - script-src uses nonce + 'strict-dynamic' so Next.js's framework
 *   scripts (RSC payloads, route prefetch, hydration) inherit trust from
 *   the nonce-tagged bootstrap script. This lets us drop `'unsafe-inline'`
 *   and `'unsafe-eval'` in production without breaking Next's runtime.
 *   See https://web.dev/articles/strict-csp.
 * - style-src keeps 'unsafe-inline' because Next + Tailwind + framer-motion
 *   inject computed inline styles all over the place (style={{...}} and
 *   animated styles). Removing this would be a much larger refactor than
 *   the CSP migration. Pragmatic compromise — styles can't `<script>`-XSS.
 * - connect-src enumerates every backend the app talks to (Supabase auth +
 *   storage, Sentry ingest, PostHog, Vercel Insights, frankfurter FX,
 *   Pexels, Amadeus, Stripe, Google Maps APIs, open-meteo weather).
 * - dev mode (NODE_ENV !== "production") returns `null` so middleware
 *   doesn't attach the header at all. React Refresh + Turbopack rely on
 *   `eval()` and `new Function()` which would be blocked.
 */

export function buildCspHeader(nonce: string): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      // 'strict-dynamic' lets nonce-trusted scripts (Next's bootstrap)
      // load additional scripts without each needing the nonce or being
      // in an allowlist. Modern browsers ignore the host allowlist when
      // 'strict-dynamic' is present.
      "'strict-dynamic'",
      // Fallback host allowlist for browsers without 'strict-dynamic'
      // support (Safari < 15.4). Modern Chrome / Firefox / Safari ignore
      // these in favor of nonce + strict-dynamic.
      "https://*.posthog.com",
      "https://*.google-analytics.com",
      "https://*.googletagmanager.com",
      "https://*.sentry.io",
      "https://*.vercel-scripts.com",
      "https://*.vercel-insights.com",
      "https://www.googleadservices.com",
      "https://cdn.travelpayouts.com",
      "https://emrldco.com",
      "https://maps.googleapis.com",
      "https://maps.gstatic.com",
      "https://js.stripe.com",
    ],
    "style-src": [
      "'self'",
      // Required for inline styles emitted by Tailwind, framer-motion,
      // Next's font CSS, etc. Pragmatic compromise — see top comment.
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
    ],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "connect-src": [
      "'self'",
      // Supabase REST + Realtime (auth, db, storage)
      "https://*.supabase.co",
      "wss://*.supabase.co",
      // Analytics + monitoring
      "https://*.posthog.com",
      "https://*.sentry.io",
      "https://*.google-analytics.com",
      // GA4 with Google Signals beacons page_view/events to these hosts
      // too — NOT covered by *.google-analytics.com. Without them the CSP
      // blocks the core collect call (analytics.google.com/g/collect) and
      // we silently lose GA measurement. Verified blocked in prod 2026-07-02.
      "https://analytics.google.com",
      "https://stats.g.doubleclick.net",
      "https://www.google.com",
      "https://*.vercel-insights.com",
      // Google APIs (Maps Geocoding/Places/Distance, Places New)
      "https://*.googleapis.com",
      // Weather
      "https://*.open-meteo.com",
      // FX rates (in-app currency converter — see prior CSP comment about
      // "Failed to fetch" on /it/trips, 2026-05-28)
      "https://api.frankfurter.dev",
      // Stripe (Checkout / Elements XHR — kept allowlisted for the
      // upcoming payments work even though no inline Stripe script ships
      // today).
      "https://api.stripe.com",
    ],
    "frame-src": [
      "'self'",
      "https://accounts.google.com",
      "https://js.stripe.com",
    ],
    "frame-ancestors": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };

  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
}

/**
 * Should CSP be enforced for this request?
 *
 * Returns `false` in dev (React Fast Refresh needs `unsafe-eval`) and
 * for Next.js internal asset paths that don't render React (and would
 * fail CSP because their static responses don't have the nonce baked in).
 */
export function shouldEnforceCsp(pathname: string): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  // _next/static is served by Vercel's CDN with its own caching — no
  // point attaching a per-request nonce'd CSP to immutable assets.
  if (pathname.startsWith("/_next/static")) return false;
  if (pathname.startsWith("/_next/image")) return false;
  return true;
}
