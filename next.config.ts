import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

// Security headers for production
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
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
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.posthog.com https://*.google-analytics.com https://*.googletagmanager.com https://*.sentry.io https://*.vercel-scripts.com https://*.vercel-insights.com https://www.googleadservices.com https://cdn.travelpayouts.com https://emrldco.com https://maps.googleapis.com https://maps.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.posthog.com https://*.sentry.io https://*.google-analytics.com https://*.googleapis.com https://*.vercel-insights.com https://*.open-meteo.com",
      "frame-src 'self' https://accounts.google.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Enforce no trailing slashes — prevents /about vs /about/ duplication
  trailingSlash: false,

  // Force synchronous metadata rendering for search engine crawlers.
  // Without this, generateMetadata() streams <link rel="canonical"> and hreflang
  // tags asynchronously — Googlebot may not see them, causing
  // "Duplicate without user-selected canonical" in Search Console.
  htmlLimitedBots: /Googlebot|Google-InspectionTool|Bingbot|Yandex|Baiduspider|DuckDuckBot|Slurp|Twitterbot|facebookexternalhit|LinkedInBot|WhatsApp|Applebot/i,

  // 301 redirects for the blog consolidation done 2026-05-06.
  // 17 thin/duplicate posts collapsed into 3 pillars to fix the
  // "Discovered – currently not indexed" pile-up in Search Console.
  // Each rule covers all 3 locales (en is the default, no prefix).
  async redirects() {
    const redirectMap: Array<[string, string]> = [
      // 12 monthly listicles → 2026 travel calendar pillar (anchored per month)
      ["where-to-go-in-january",   "2026-travel-calendar#january"],
      ["where-to-go-in-february",  "2026-travel-calendar#february"],
      ["where-to-go-in-march",     "2026-travel-calendar#march"],
      ["where-to-go-in-april",     "2026-travel-calendar#april"],
      ["where-to-go-in-may",       "2026-travel-calendar#may"],
      ["where-to-go-in-june",      "2026-travel-calendar#june"],
      ["where-to-go-in-july",      "2026-travel-calendar#july"],
      ["where-to-go-in-august",    "2026-travel-calendar#august"],
      ["where-to-go-in-september", "2026-travel-calendar#september"],
      ["where-to-go-in-october",   "2026-travel-calendar#october"],
      ["where-to-go-in-november",  "2026-travel-calendar#november"],
      ["where-to-go-in-december",  "2026-travel-calendar#december"],
      // 3 summer-season dupes → spring/summer pillar
      ["best-summer-destinations-2026",  "spring-summer-travel-guide"],
      ["spring-break-destinations-2026", "spring-summer-travel-guide"],
      ["coolcation-destinations-2026",   "spring-summer-travel-guide"],
      // 2 honeymoon dupes → honeymoon pillar
      ["best-honeymoon-destinations-2026", "honeymoon-planning-guide"],
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
    return rules;
  },

  // Security + caching headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
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
};

// Sentry configuration options
const sentryConfig = {
  // Organization and project for source maps
  org: "monkeytravelapp-u6",
  project: "javascript-nextjs",

  // Auth token for source maps upload (from environment)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Silence all Sentry build output
  silent: true,

  // Upload source maps for better error stack traces
  widenClientFileUpload: true,

  // Disable Sentry telemetry
  telemetry: false,

  // Automatically tree-shake Sentry logger statements
  disableLogger: true,

  // Hide source maps from clients (security)
  hideSourceMaps: true,

  // Tunneling (disabled - use default Sentry endpoints)
  tunnelRoute: undefined,

  // Disable source map upload in CI to prevent timeouts
  sourcemaps: {
    disable: !!process.env.VERCEL,
  },
};

// Create next-intl plugin
const withNextIntl = createNextIntlPlugin("./i18n.ts");

// Export with next-intl and Sentry wrappers
export default withSentryConfig(withNextIntl(nextConfig), sentryConfig);
