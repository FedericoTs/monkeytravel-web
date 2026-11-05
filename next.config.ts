import type { NextConfig } from "next";
import { withSentryConfig, type SentryBuildOptions } from "@sentry/nextjs/config";
import createNextIntlPlugin from "next-intl/plugin";

// Security headers for production (CSP is set per-request in middleware.ts
// with a nonce, so it's deliberately omitted from this static list — see
// lib/security/csp.ts).
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  // X-Frame-Options is deliberately NOT here. It used to be a blanket
  // 'SAMEORIGIN' on '/:path*', which silently overruled the CSP: browsers
  // enforce XFO independently of frame-ancestors, so BuildHop's embed of the
  // homepage stayed blocked even after frame-ancestors allowed it. Framing
  // policy is now decided in exactly one place — middleware.ts, from
  // allowsThirdPartyFraming() in lib/security/csp.ts — so the two headers
  // cannot disagree again.
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self)'
  },
];

const nextConfig: NextConfig = {
  // Drop `X-Powered-By: Next.js`. Next sets it by default on page responses. It
  // leaks the framework, which narrows an attacker's search for version-specific
  // exploits and buys nothing.
  //
  // Server-side by construction — Next omits the header at the origin, so there
  // is no client-side check to bypass.
  poweredByHeader: false,

  // Enforce no trailing slashes — prevents /about vs /about/ duplication
  trailingSlash: false,

  // Force synchronous metadata rendering for search engine crawlers.
  // Without this, generateMetadata() streams <link rel="canonical"> and hreflang
  // tags asynchronously — Googlebot may not see them, causing
  // "Duplicate without user-selected canonical" in Search Console.
  htmlLimitedBots: /Googlebot|Google-InspectionTool|Bingbot|Yandex|Baiduspider|DuckDuckBot|Slurp|Twitterbot|facebookexternalhit|LinkedInBot|WhatsApp|Applebot/i,

  // 301 redirects for the blog consolidation: thin and duplicate posts collapsed
  // into pillars, against the "Discovered – currently not indexed" pile-up in
  // Search Console.
  // Each rule covers all 3 locales (en is the default, no prefix).
  async redirects() {
    const redirectMap: Array<[string, string]> = [
      // No month redirects to the travel calendar pillar: a standalone post for
      // each one (content/blog/where-to-go-in-<month>.md) serves those queries with
      // a real 200, which an anchor on the calendar can't rank for. A month's post
      // has to exist well ahead of its season to be ranking when the queries come.
      // 3 summer-season dupes → spring/summer pillar
      ["best-summer-destinations-2026",  "spring-summer-travel-guide"],
      ["spring-break-destinations-2026", "spring-summer-travel-guide"],
      ["coolcation-destinations-2026",   "spring-summer-travel-guide"],
      // 1 honeymoon dupe → honeymoon pillar
      // best-honeymoon-destinations-2026 is not redirected: its own post serves
      // the destination-intent queries, and the planning guide stays the process
      // pillar.
      ["honeymoon-on-a-budget-2026",       "honeymoon-planning-guide"],
    ];

    const rules: Array<{ source: string; destination: string; permanent: true }> = [];
    for (const [from, to] of redirectMap) {
      // Default locale (no prefix)
      rules.push({ source: `/blog/${from}`, destination: `/blog/${to}`, permanent: true });
      // Non-default locales
      for (const locale of ["es", "it"]) {
        rules.push({ source: `/${locale}/blog/${from}`, destination: `/${locale}/blog/${to}`, permanent: true });
      }
    }

    // English has no prefix, and next-intl answers /en with a temporary
    // redirect; these run first and make it permanent.
    rules.push({ source: "/en", destination: "/", permanent: true });
    rules.push({ source: "/en/:path*", destination: "/:path*", permanent: true });

    // Natural-language destination slug aliases. lib/destinations/data.ts keys
    // every destination by its English slug ("rome"), so the local-language name
    // (e.g. /it/destinations/roma) would be a 404. Rather than thread an
    // alias map through generateStaticParams + getDestinationBySlug
    // (which would cascade into hreflang, sitemap, canonical URL logic),
    // 301 the locale-native alias to the canonical English slug.
    // Each tuple is [locale, alias, canonical-english-slug].
    const destinationAliases: Array<[string, string, string]> = [
      // Italian aliases
      ["it", "roma",    "rome"],
      ["it", "parigi",  "paris"],
      ["it", "londra",  "london"],
      ["it", "praga",   "prague"],
      ["it", "lisbona", "lisbon"],
      ["it", "berlino", "berlin"],
      ["it", "seul",    "seoul"],
      // Spanish aliases
      ["es", "tokio",     "tokyo"],
      ["es", "nueva-york","new-york"],
      ["es", "londres",   "london"],
      ["es", "viena",     "vienna"],
      ["es", "seul",      "seoul"],
      ["es", "singapur",  "singapore"],
      ["es", "estambul",  "istanbul"],
      ["es", "lisboa",    "lisbon"],
      ["es", "praga",     "prague"],
    ];
    for (const [locale, alias, canonical] of destinationAliases) {
      rules.push({
        source: `/${locale}/destinations/${alias}`,
        destination: `/${locale}/destinations/${canonical}`,
        permanent: true,
      });
    }

    // /multi-city vanity path → multi-city landing page, for every locale
    // (en is the default, no prefix).
    rules.push({
      source: `/multi-city`,
      destination: `/multi-city-trip-planner`,
      permanent: true,
    });
    for (const locale of ["es", "it", "pt"]) {
      rules.push({
        source: `/${locale}/multi-city`,
        destination: `/${locale}/multi-city-trip-planner`,
        permanent: true,
      });
    }

    // The visa-requirements-2026 post duplicated visa-requirements-us-citizens'
    // intent and split its rankings. Its content is gone; the 301 keeps what it
    // earned on the stronger page.
    rules.push({
      source: `/blog/visa-requirements-2026`,
      destination: `/blog/visa-requirements-us-citizens`,
      permanent: true,
    });
    for (const locale of ["es", "it", "pt"]) {
      rules.push({
        source: `/${locale}/blog/visa-requirements-2026`,
        destination: `/${locale}/blog/visa-requirements-us-citizens`,
        permanent: true,
      });
    }

    // Contact-intent aliases: Google sends people to /contact-us and
    // /get-in-touch, and only /contact serves a 200. A 404 on a contact-intent
    // query is a lost business or support conversation, not a lost pageview.
    //
    // NOT redirected here: /about and /about-us, which also 404. There is no
    // about page to point them at — app/[locale]/about/ contains only
    // authors/[slug]/. Pointing them at /contact would be a wrong answer to
    // an informational query.
    for (const alias of ["contact-us", "get-in-touch"]) {
      rules.push({
        source: `/${alias}`,
        destination: `/contact`,
        permanent: true,
      });
      for (const locale of ["es", "it", "pt"]) {
        rules.push({
          source: `/${locale}/${alias}`,
          destination: `/${locale}/contact`,
          permanent: true,
        });
      }
    }

    return rules;
  },

  // Security + caching headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // Signed day links (/day/<trip>/<date>?k=...) carry their key in the URL:
      // never send it on as a Referer, never index the page.
      ...['/day/:path*', '/:locale(es|it|pt)/day/:path*'].map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      })),
      // Aggressive caching for static images (blog heroes, destinations)
      {
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // Vendored world-map geometry (scripts/vendor-world-map.mjs). Fetched once
      // by the passport pages and reused across all 80 of them, which is the
      // whole reason it is a static asset rather than inlined.
      //
      // A day, with a week of stale-while-revalidate, rather than the
      // `immutable` used for images: the filename is stable, so `immutable`
      // would strand clients on an old map after a regeneration. A day already
      // captures the case that matters — someone browsing several passports in
      // one session downloads it once.
      {
        source: '/geo/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      // Cache font files
      {
        source: '/:path*.woff2',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // Cache screenshots/video assets
      {
        source: '/screenshots/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // Apple Universal Links — Apple's CDN is strict: the file MUST be
      // served with Content-Type: application/json (NOT application/pkcs7-mime
      // and NOT application/octet-stream, which is what Next.js defaults to
      // for files without extensions). Without this header, the swcd
      // verification daemon silently drops the association and deep
      // links fall back to opening Safari.
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          // Cache aggressively — the file rarely changes; Apple's CDN
          // refreshes on its own schedule anyway.
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
      // Android App Links — Google Play Services fetches this. JSON
      // content-type is recommended; without it Chrome warns in DevTools.
      {
        source: '/.well-known/assetlinks.json',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
    ];
  },

  // Image optimization for Vercel — tuned to reduce transformation count
  images: {
    formats: ['image/avif', 'image/webp'],
    // 1 year cache TTL on the optimized AVIF/WebP variants. Static
    // destination/blog images don't change between deploys; bumping
    // from 30d → 1y cuts the per-variant transformation count by ~12×
    // since each cached variant lives until invalidated by a new build.
    minimumCacheTTL: 31536000, // 1 year
    deviceSizes: [640, 828, 1200],  // 3 sizes instead of default 6
    imageSizes: [128, 256, 384],    // 3 sizes instead of default 4
    // Same-origin (local) image srcs with query strings. Next 15 blocks these
    // by default (SSRF hardening) — a missing allowlist here 500s ANY page that
    // renders a trip cover / activity photo whose URL is our Places-photo proxy
    // (/api/places/photo?name=…). That regressed /explore + would break the new
    // /trip/[slug] pages. `search` omitted → any query string allowed.
    localPatterns: [
      // CRITICAL: setting localPatterns REPLACES Next 15's implicit default
      // (all same-origin images, no query string), it does not merge with it.
      // Without this first entry, every local static image — the logo,
      // /images/**, favicons — 404s through the optimizer. This re-declares
      // that default.
      { pathname: '/**', search: '' },
      // The Places-photo proxy's src carries a query string (?name=…).
      // `search` omitted → any query string allowed.
      { pathname: '/api/places/**' },
      // Stored Wikimedia photos carry their credit in the query string.
      { pathname: '/api/images/wikimedia/**' },
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'places.googleapis.com',
        pathname: '/v1/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'maps.googleapis.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
        pathname: '/photos/**',
      },
      {
        protocol: 'https',
        hostname: 'flagcdn.com',
        pathname: '/**',
      },
    ],
  },

  // Turbopack root directory (fixes workspace warning)
  turbopack: {
    root: __dirname,
  },

  // Tree-shake barrel exports from heavy packages. Next rewrites
  // `import { Foo } from 'pkg'` → deep imports at build time, saving
  // ~30-60KB gz per route that touches these.
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'framer-motion',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
    ],
  },
};

// Sentry configuration options
const sentryConfig: SentryBuildOptions = {
  // Organization and project for source maps
  org: "monkeytravelapp-u6",
  project: "javascript-nextjs",

  // Auth token for source maps upload (from environment)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Silence all Sentry build output
  silent: true,

  // Upload source maps for better error stack traces
  widenClientFileUpload: true,

  // The browser SDK ships only what runs for everyone: no tracing, and no
  // replay code (fetched on demand when session recording was agreed to;
  // see instrumentation-client.ts).
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },

  // Disable Sentry telemetry
  telemetry: false,

  // Tunneling (disabled - use default Sentry endpoints)
  tunnelRoute: undefined,

  // Source map upload. On, including on Vercel: without the maps Sentry can't
  // symbolicate anything, and every frame reads like
  //
  //   app:///_next/static/chunks/05nok7-~2rps7.js:1:133736 (ud)
  //
  // An upload can time out, so the errorHandler below makes that non-fatal: if it
  // times out, errors, or SENTRY_AUTH_TOKEN is absent, the build logs a warning and
  // continues. Worst case is minified stacks, never a broken deploy.
  sourcemaps: {
    disable: false,
  },

  // Never fail a production build over telemetry. Without this, the Sentry
  // plugin throws on upload problems and takes the whole deploy with it.
  errorHandler: (err: Error) => {
    console.warn(
      "[sentry] source map upload did not complete — stacks will stay minified. " +
        "Build continues.",
      err?.message ?? err
    );
  },
};

// Create next-intl plugin
const withNextIntl = createNextIntlPlugin("./i18n.ts");

// Export with next-intl and Sentry wrappers
export default withSentryConfig(withNextIntl(nextConfig), sentryConfig);
