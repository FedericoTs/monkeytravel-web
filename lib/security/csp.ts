/**
 * Content-Security-Policy header builder.
 *
 * Single source of truth for the CSP string we send. Called from
 * `middleware.ts` per request. Two script policies, one per rendering mode:
 *
 * - Pages rendered per request get a fresh nonce plus 'strict-dynamic'.
 *   Next stamps the nonce on its own scripts, and trust flows from those to
 *   whatever they load, so no host allowlist is needed on modern browsers.
 * - Prerendered pages are served from the CDN, where no per-request nonce
 *   can exist. Every inline script in their HTML is pinned by its SHA-256
 *   (computed from the built HTML by scripts/csp-manifest.mjs) and external
 *   scripts must come from 'self' or a listed host.
 *
 * Neither policy carries 'unsafe-inline' or 'unsafe-eval' for scripts.
 *
 * Design notes:
 * - style-src keeps 'unsafe-inline' because Next + Tailwind + framer-motion
 *   inject computed inline styles all over the place (style={{...}} and
 *   animated styles). Removing this would be a much larger refactor than
 *   the CSP migration. Pragmatic compromise — styles can't `<script>`-XSS.
 * - connect-src enumerates every backend the app talks to (Supabase auth +
 *   storage, Sentry ingest, PostHog, Vercel Insights, frankfurter FX,
 *   Pexels, Stripe, Google Maps APIs, open-meteo weather).
 * - dev mode (NODE_ENV !== "production"): shouldEnforceCsp() is false, so
 *   middleware attaches no header. React Refresh + Turbopack rely on
 *   `eval()` and `new Function()` which would be blocked.
 */

import { gaConsentDefaultScriptProps } from "@/lib/analytics/ga-consent";

/**
 * The four locale homepages (`localePrefix: "as-needed"` — see
 * lib/i18n/routing.ts — means the default "en" locale carries no prefix).
 * This is deliberately an EXACT-match set, not a prefix check: a prefix
 * match on "/es" would also catch "/es/blog/...", handing every Spanish
 * page the same relaxed frame-ancestors as the homepage.
 */
const LANDING_PAGE_PATHS = new Set(["/", "/es", "/it", "/pt"]);

/**
 * Whether this path is one BuildHop is allowed to frame.
 *
 * Exported because X-Frame-Options has to agree with frame-ancestors, and the
 * two used to live in different files: frame-ancestors here, and a blanket
 * `X-Frame-Options: SAMEORIGIN` on '/:path*' in next.config.ts. XFO is the
 * older, cruder header and browsers enforce it independently, so the static
 * one silently overruled this policy and BuildHop's embed stayed blocked even
 * though the CSP allowed it. Both now derive from this single predicate.
 */
export function allowsThirdPartyFraming(pathname: string): boolean {
  return LANDING_PAGE_PATHS.has(pathname);
}

/**
 * BuildHop (a launch-directory site) needs to embed the homepage in a
 * live iframe preview for its listing. Scoped to the homepage only —
 * every other route (trips, auth, admin, blog, ...) keeps the default
 * 'self'-only value, so this does not enlarge the clickjacking surface
 * on anything that isn't the marketing pitch page.
 */
const BUILDHOP_FRAME_ANCESTORS = ["https://buildhop.io", "https://www.buildhop.io"];

/**
 * Hosts external scripts may load from. The only script source for
 * prerendered pages; on nonce pages a fallback for browsers without
 * 'strict-dynamic' support (Safari < 15.4), which modern browsers ignore.
 */
const SCRIPT_HOSTS = [
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
  // BuildHop feedback widget — see components/BuildHopFeedbackWidget.tsx.
  "https://buildhop.io",
];

/** Which scripts a response may run: a per-request nonce, or the hashes of its inline scripts. */
export type ScriptPolicy =
  | { nonce: string; hashes?: readonly string[] }
  | { nonce?: undefined; hashes: readonly string[] };

function scriptSrc(scripts: ScriptPolicy): string[] {
  const hashes = (scripts.hashes ?? []).map((h) => `'${h}'`);
  if (scripts.nonce) {
    // 'strict-dynamic' lets nonce-trusted scripts (Next's bootstrap) load
    // additional scripts without each needing the nonce or being in an
    // allowlist. Hashed inline scripts are trusted the same way.
    return ["'self'", `'nonce-${scripts.nonce}'`, "'strict-dynamic'", ...hashes, ...SCRIPT_HOSTS];
  }
  return ["'self'", ...hashes, ...SCRIPT_HOSTS];
}

export function buildCspHeader(pathname: string, scripts: ScriptPolicy): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc(scripts),
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
      // we silently lose GA measurement.
      "https://analytics.google.com",
      // ...and GA4 routes EU/UK traffic through REGIONAL subdomains
      // (region1.analytics.google.com, region2., ...), which the apex entry
      // above does not cover — a CSP `*.host` wildcard matches subdomains
      // only, and a bare `host` matches only the apex, so BOTH are required.
      "https://*.analytics.google.com",
      "https://stats.g.doubleclick.net",
      "https://www.google.com",
      "https://*.vercel-insights.com",
      // Google APIs (Maps Geocoding/Places/Distance, Places New)
      "https://*.googleapis.com",
      // Weather
      "https://*.open-meteo.com",
      // FX rates (in-app currency converter)
      "https://api.frankfurter.dev",
      // Stripe (Checkout / Elements XHR — kept allowlisted for the
      // upcoming payments work even though no inline Stripe script ships
      // today).
      "https://api.stripe.com",
      // Travelpayouts/Emerald affiliate loader. Its script is already trusted
      // in script-src, but it fetches https://emrldco.com/entrypoint_config
      // before it will render any affiliate link; without this entry the
      // script loads, fails with "config is not valid" and produces nothing.
      //
      // Deliberately NOT allowing sentry.avs.io: that is the affiliate
      // script's own error reporting to a third party, it is not needed for
      // affiliate links to work, and it would ship page URLs off-site.
      "https://emrldco.com",
      // BuildHop feedback widget's own submit/config calls. script-src alone
      // is exactly the emrldco.com bug above: the script loads and runs, but
      // any fetch() it makes gets silently refused without a matching
      // connect-src entry, and the failure is invisible from the server.
      "https://buildhop.io",
    ],
    "frame-src": [
      "'self'",
      "https://accounts.google.com",
      "https://js.stripe.com",
      // The BuildHop widget's launcher is only the visible half. Clicking it
      // injects an iframe at buildhop.io/embed/feedback/<id> — a THIRD
      // directive this one integration needs, after script-src (load the
      // script) and connect-src (its session POST). Without this the launcher
      // renders, the click registers, and the panel opens blank.
      "https://buildhop.io",
    ],
    "frame-ancestors": allowsThirdPartyFraming(pathname)
      ? ["'self'", ...BUILDHOP_FRAME_ANCESTORS]
      : ["'self'"],
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

export async function sha256Source(script: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

let layoutScriptHashes: Promise<readonly string[]> | undefined;

/**
 * Hashes of the inline scripts the layout renders on every page (today: the
 * GA consent default). They carry no nonce, so the nonce policy admits them
 * by hash; prerendered pages get them from the manifest instead.
 */
export function layoutInlineScriptHashes(): Promise<readonly string[]> {
  if (!layoutScriptHashes) {
    const consent = gaConsentDefaultScriptProps();
    layoutScriptHashes = consent
      ? sha256Source(consent.dangerouslySetInnerHTML.__html).then((h) => [h])
      : Promise.resolve([]);
  }
  return layoutScriptHashes;
}
